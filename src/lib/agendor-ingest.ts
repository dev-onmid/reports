/**
 * Agendor — ingestão de um negócio no CRM.
 *
 * UMA função serve os três caminhos (webhook em tempo real, backfill inicial
 * e reconciliação periódica): três cópias divergiriam no primeiro ajuste — a
 * lição das 3 listas de STATUS_OPTIONS e das 3 cópias de truncateCaption.
 *
 * Identidade do lead, em ordem de força:
 *  1. `external_id = agendor:{id do negócio}` — sobrevive a troca de telefone
 *     e é o dedupe natural do backfill (rodar 2x não duplica);
 *  2. telefone (régua única de lead-identity.ts: BR e estrangeiro), depois e-mail.
 *
 * ⚠️ Negócio SEM telefone ENTRA mesmo assim (diferente do Datalytics): o
 * Agendor referencia a pessoa sem contato no payload, e descartar seria
 * perder fechamentos reais do Funil de Performance. Sem telefone só não há
 * casamento com conversas do WhatsApp nem disparo de conversão.
 */

import type { Pool } from 'pg';
import type { FiltrosImportacao, NegocioAgendor, PessoaAgendor } from '@/lib/agendor';
import { resolverLeadExistente, vincularAoLeadDeOrigem } from '@/lib/lead-identity';
import { normalizarNegocio, normalizarPessoa, parseFiltro, passaFiltros } from '@/lib/agendor';
import { agendorFetch, AGENDOR_API, type ConexaoAgendor, registrarLogAgendor } from '@/lib/agendor-server';
import { sinaisDoStatus } from '@/lib/importacao-origem';
import { classificarEtapa, normalizarEtiqueta } from '@/lib/funil-etapas';
import { ensureDefaultFunnel, getFirstFunnelStageLabel } from '@/lib/crm-conversation-sync';
import { applyLeadAttribution, recordTrackingEvent } from '@/lib/lead-tracking';
import { regiaoFromPhone } from '@/lib/ddd-regioes';
import { dispararEventosPorStatus } from '@/lib/conversions';

async function ensureColunasLead(pool: Pool) {
  await pool.query(`
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS observacao TEXT,
      ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
      ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS agendou BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS compareceu BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS fechado_em DATE,
      ADD COLUMN IF NOT EXISTS perdido_em DATE,
      ADD COLUMN IF NOT EXISTS responsavel TEXT,
      -- ⚠️ Valor ESTIMADO do negócio, longe de valor_rs. Ver NegocioAgendor.
      ADD COLUMN IF NOT EXISTS valor_negocio NUMERIC,
      ADD COLUMN IF NOT EXISTS produtos JSONB,
      ADD COLUMN IF NOT EXISTS link_externo TEXT,
      ADD COLUMN IF NOT EXISTS external_id TEXT
  `).catch(() => {});
  await pool.query(
    `CREATE INDEX IF NOT EXISTS crm_leads_responsavel_idx
       ON public.crm_leads (client_id, responsavel) WHERE responsavel IS NOT NULL`,
  ).catch(() => {});
}

/** Espelho de etapa no Kanban — mesma regra do Datalytics. */
async function espelharEtapa(pool: Pool, clientId: string, funnelId: string, label: string) {
  const { rows } = await pool.query<{ label: string }>(
    `SELECT label FROM public.crm_stages WHERE funnel_id = $1`, [funnelId]);
  const alvo = normalizarEtiqueta(label);
  if (rows.some(r => normalizarEtiqueta(r.label) === alvo)) return;
  await pool.query(
    `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
     SELECT $1, $2, $3, '#94a3b8', COALESCE(MAX(position), -1) + 1, $4
       FROM public.crm_stages WHERE funnel_id = $1`,
    [funnelId, clientId, label, classificarEtapa(label)],
  );
}

/**
 * Busca a pessoa completa no Agendor (o negócio só traz id/nome/email). Cache
 * por execução no chamador; falha vira null — telefone é desejável, não
 * obrigatório.
 */
export async function buscarPessoaAgendor(
  apiToken: string, pessoaId: string,
): Promise<PessoaAgendor | null> {
  // O catálogo em lote já traz a ficha inteira (origem + telefone) — consultar
  // aqui evita a requisição individual que estourava o limite do Agendor.
  const cat = catalogos.get(apiToken.slice(0, 12));
  if (cat && Date.now() - cat.em < TTL_CATALOGO_MS) {
    const ficha = cat.pessoas.get(pessoaId);
    if (ficha) return ficha;
    if (cat.completo) return null;   // catálogo íntegro e não tem: pessoa não existe
  }
  try {
    const r = await agendorFetch<{ data?: Record<string, unknown> }>(
      apiToken, `${AGENDOR_API}/people/${encodeURIComponent(pessoaId)}`);
    return r?.data ? normalizarPessoa(r.data) : null;
  } catch {
    return null;
  }
}

/**
 * Ficha da EMPRESA (organização) do negócio. O shape do OrganizationEntity é
 * o mesmo vocabulário da pessoa (name/contact/leadOrigin/address), então o
 * normalizador é reaproveitado. Falha → null.
 */
/**
 * Catálogo de origens carregado em LOTE.
 *
 * ⚠️ Motivo: buscar a origem negócio a negócio (`/people/{id}`) custa 1
 * requisição por negócio — com ~3.600 negócios a conta batia no limite do
 * Agendor e a importação parava com 429 já na primeira chamada. A listagem
 * paginada devolve 100 fichas por requisição, então o mesmo trabalho cai de
 * ~3.600 para ~40 requisições. Carregado uma vez por token e reaproveitado.
 */
type Catalogo = { em: number; pessoas: Map<string, PessoaAgendor>; orgs: Map<string, PessoaAgendor>; completo: boolean };
const catalogos = new Map<string, Catalogo>();
const TTL_CATALOGO_MS = 30 * 60_000;
const MAX_PAGINAS_CATALOGO = 60;   // 6.000 fichas por tipo — teto de segurança

async function carregarCatalogo(apiToken: string): Promise<Catalogo> {
  const chave = apiToken.slice(0, 12);
  const atual = catalogos.get(chave);
  if (atual && Date.now() - atual.em < TTL_CATALOGO_MS) return atual;

  const cat: Catalogo = { em: Date.now(), pessoas: new Map(), orgs: new Map(), completo: true };
  for (const [recurso, destino] of [['people', cat.pessoas], ['organizations', cat.orgs]] as const) {
    for (let pagina = 1; pagina <= MAX_PAGINAS_CATALOGO; pagina++) {
      let lote: Record<string, unknown>[] = [];
      try {
        const r = await agendorFetch<{ data?: Record<string, unknown>[] }>(
          apiToken, `${AGENDOR_API}/${recurso}?page=${pagina}&per_page=100`);
        lote = r?.data ?? [];
      } catch {
        cat.completo = false;   // catálogo parcial: quem faltar cai na busca individual
        break;
      }
      for (const bruto of lote) {
        const f = normalizarPessoa(bruto);
        if (f.id) destino.set(f.id, f);   // ficha completa: origem E telefone
      }
      if (lote.length < 100) break;
      await new Promise(res => setTimeout(res, 400));
    }
  }
  catalogos.set(chave, cat);
  return cat;
}

/**
 * Cache de empresas por processo. Duas coisas o justificam: a MESMA empresa
 * aparece em vários negócios, e Incorpast/Londrigifts usam o MESMO token do
 * Agendor — sem cache, a conta leva o dobro de consultas e toma 429.
 * TTL curto: origem de lead praticamente não muda dentro de uma execução.
 */
const cacheOrgs = new Map<string, { em: number; valor: PessoaAgendor | null }>();
const TTL_ORG_MS = 10 * 60_000;

export async function buscarOrganizacaoAgendor(
  apiToken: string, orgId: string,
): Promise<PessoaAgendor | null> {
  const chave = `${apiToken.slice(0, 8)}:${orgId}`;
  const cache = cacheOrgs.get(chave);
  if (cache && Date.now() - cache.em < TTL_ORG_MS) return cache.valor;
  // Mesmo ritmo da busca de pessoa (~100 req/min): sem isto, o fallback de
  // empresa dobrava a cadência e derrubava a importação inteira com 429.
  await new Promise(res => setTimeout(res, 600));
  try {
    const r = await agendorFetch<{ data?: Record<string, unknown> }>(
      apiToken, `${AGENDOR_API}/organizations/${encodeURIComponent(orgId)}`);
    const valor = r?.data ? normalizarPessoa(r.data) : null;
    cacheOrgs.set(chave, { em: Date.now(), valor });
    return valor;
  } catch {
    return null;   // falha NÃO entra no cache: a próxima passada tenta de novo
  }
}

/** Filtros salvos na conexão, prontos pra `passaFiltros`. */
export function filtrosDaConexao(conn: ConexaoAgendor): FiltrosImportacao {
  return { funis: parseFiltro(conn.filtro_funis), origens: parseFiltro(conn.filtro_origens) };
}

/**
 * Aplica os filtros de importação; devolve null (com motivo) quando o negócio
 * NÃO deve entrar. Se o filtro de funil está ligado e o payload veio sem o
 * funil (webhook às vezes manda a etapa como texto solto), busca o negócio
 * completo na API antes de decidir — melhor uma chamada a mais que barrar ou
 * deixar passar no escuro.
 */
export async function conferirFiltros(
  conn: ConexaoAgendor, negocio: NegocioAgendor, pessoa: PessoaAgendor | null,
  pessoaFalhou = false,
): Promise<{ negocio: NegocioAgendor; bloqueado: string | null; pessoa: PessoaAgendor | null }> {
  const filtros = filtrosDaConexao(conn);
  let n = negocio;
  if (filtros.funis && filtros.funis.length > 0 && n.funilId === null && conn.api_token) {
    try {
      const r = await agendorFetch<{ data?: Record<string, unknown> }>(
        conn.api_token, `${AGENDOR_API}/deals/${encodeURIComponent(n.idExterno)}`);
      const completo = r?.data ? normalizarNegocio(r.data) : null;
      if (completo?.funilId) n = { ...n, funilId: completo.funilId, funilNome: completo.funilNome };
    } catch { /* segue com o que tem — passaFiltros é permissivo no desconhecido */ }
  }
  // ⚠️ B2B (caso Incorpast): o negócio fica pendurado na EMPRESA, sem pessoa —
  // e a origem (Google/Instagram/...) mora na ficha da ORGANIZAÇÃO. Sem este
  // fallback, todo negócio de empresa era "sem origem" e o filtro barrava o
  // funil inteiro. Só busca quando o filtro de origem realmente precisa.
  let p = pessoa;
  let origemDesconhecida = pessoaFalhou;

  // 1) catálogo em lote — resolve a origem sem gastar uma requisição por negócio
  if (filtros.origens && filtros.origens.length > 0 && !p?.origemLeadId && conn.api_token) {
    const cat = await carregarCatalogo(conn.api_token);
    const ficha = (n.pessoa.id ? cat.pessoas.get(n.pessoa.id) : null)
      ?? (n.organizacaoId ? cat.orgs.get(n.organizacaoId) : null);
    if (ficha?.origemLeadId) {
      // ⚠️ Telefone da EMPRESA nunca vira telefone do lead (o upsert casa por
      // telefone e fundiria todos os negócios dela num lead só).
      p = p
        ? { ...p, origemLead: ficha.origemLead, origemLeadId: ficha.origemLeadId }
        : { ...ficha, telefone: null, telefoneBruto: null };
      origemDesconhecida = false;
    } else if (cat.completo && (n.pessoa.id || n.organizacaoId)) {
      // catálogo íntegro e a ficha não tem origem → é ausência de verdade,
      // não falha de rede: decide agora, sem gastar requisição.
      origemDesconhecida = false;
    }
  }

  // 2) fallback individual (catálogo parcial ou ficha ausente)
  if (
    filtros.origens && filtros.origens.length > 0 &&
    !p?.origemLeadId && origemDesconhecida !== false && n.organizacaoId && conn.api_token
  ) {
    const org = await buscarOrganizacaoAgendor(conn.api_token, n.organizacaoId);
    if (org?.origemLeadId) {
      // Telefone da empresa NÃO entra: o upsert casa lead por telefone, e o
      // número da empresa fundiria todos os negócios dela num lead só.
      p = p
        ? { ...p, origemLead: org.origemLead, origemLeadId: org.origemLeadId }
        : { ...org, telefone: null, telefoneBruto: null };
    } else if (org === null) {
      origemDesconhecida = true; // fetch falhou (429?) — desconhecido passa
    }
  }
  const { passa, motivo } = passaFiltros(filtros, n, p, { origemDesconhecida });
  return { negocio: n, bloqueado: passa ? null : motivo, pessoa: p };
}

export type ResultadoIngestao = {
  leadId: string;
  criado: boolean;
  statusAnterior: string | null;
  statusNovo: string;
  telefone: string | null;
};

/**
 * Ficha da empresa que JÁ está no catálogo em memória (carregado pelo filtro).
 * Não faz requisição: é só para o lead B2B não ficar sem nome nem origem —
 * nesses negócios o Agendor não vincula pessoa, só organização.
 */
/**
 * Telefone de contato da EMPRESA, cru — só para ACHAR a conversa que originou
 * o negócio, nunca para gravar em `numero`.
 *
 * ⚠️ Medido na API da Incorpast (2026-08-24): **100 de 100** organizações têm
 * telefone, no formato `+5543988619300`. O dado sempre esteve disponível e o
 * sistema sempre o baixou — era descartado por medo de fundir os negócios da
 * mesma empresa num lead só. O medo era certo para a GRAVAÇÃO; para o VÍNCULO
 * (`vincularAoLeadDeOrigem`, que mantém as linhas separadas) não se aplica.
 */
function telefoneDaEmpresaEmMemoria(apiToken: string | null, orgId: string | null): string | null {
  if (!apiToken || !orgId) return null;
  const cat = catalogos.get(apiToken.slice(0, 12));
  if (!cat || Date.now() - cat.em >= TTL_CATALOGO_MS) return null;
  return cat.orgs.get(orgId)?.telefoneBruto ?? null;
}

function fichaDaEmpresaEmMemoria(apiToken: string | null, orgId: string | null): PessoaAgendor | null {
  if (!apiToken || !orgId) return null;
  const cat = catalogos.get(apiToken.slice(0, 12));
  if (!cat || Date.now() - cat.em >= TTL_CATALOGO_MS) return null;
  const ficha = cat.orgs.get(orgId);
  // Telefone da empresa NUNCA entra: o upsert casa por telefone e fundiria
  // todos os negócios dela num lead só.
  return ficha ? { ...ficha, telefone: null, telefoneBruto: null } : null;
}

export async function ingerirNegocioAgendor(
  pool: Pool, clientId: string, negocio: NegocioAgendor, pessoa: PessoaAgendor | null,
  opts?: { apiToken?: string | null },
): Promise<ResultadoIngestao> {
  await ensureColunasLead(pool);
  // Negócio B2B (sem pessoa): usa a ficha da empresa para nome e origem.
  pessoa = pessoa ?? fichaDaEmpresaEmMemoria(opts?.apiToken ?? null, negocio.organizacaoId);

  const externalId = `agendor:${negocio.idExterno}`;
  const telefone = pessoa?.telefone ?? null;

  // O rótulo que o board mostra: a etapa do Agendor; ganho sem etapa cai no
  // rótulo canônico de venda do sistema ('Fechado' — o que a importação grava).
  const labelEtapa = negocio.etapa ?? (negocio.status === 'ganho' ? 'Fechado' : null);
  const ganhou = negocio.status === 'ganho';
  // ⚠️ Valor SÓ entra quando o negócio é GANHO. No Agendor todo negócio aberto
  // carrega valor estimado; gravar isso em valor_rs quebra o invariante do
  // sistema inteiro ("tem valor = vendeu") e inflava Faturamento/Funil com
  // pipeline aberto. fechado_em é a data do ganho — é a régua do Faturamento.
  const valorVenda = ganhou ? negocio.valor : null;
  const fechadoEm = ganhou
    ? ((negocio.ganhoEm ?? new Date().toISOString()).slice(0, 10))
    : null;
  const perdidoEm = negocio.status === 'perdido'
    ? ((negocio.perdidoEm ?? new Date().toISOString()).slice(0, 10))
    : null;
  // Alimenta o painel "quem vendeu mais" (ganhos, perdidos E novos). Fica em
  // coluna própria justamente para não encostar na receita — ver NegocioAgendor.
  const produtosJson = negocio.produtos.length > 0 ? JSON.stringify(negocio.produtos) : null;

  // ⚠️ `canal` guarda a ORIGEM DO NEGÓCIO ("Google", "Instagram", "Indicação"),
  // não a porta de entrada. Gravar 'agendor' aqui — como era antes — fazia o
  // gráfico de Faturamento por Canal mostrar 84% "sem canal registrado" mesmo
  // com o Agendor tendo a origem preenchida (o canal ficava só num texto na
  // observação). Sem origem, 'agendor' continua como marca da fonte.
  const canalDoLead = pessoa?.origemLead?.trim() || 'agendor';

  await pool.query('BEGIN');
  try {
    await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agendor:${clientId}:${negocio.idExterno}`]);
    const funnelId = await ensureDefaultFunnel(pool, clientId);

    // Régua ÚNICA de identidade (lead-identity.ts): id do negócio no Agendor,
    // telefone (BR e estrangeiro — número internacional já estourou a unique de
    // produção na Londrigifts) e e-mail.
    // ⚠️ Antes isto carregava TODOS os leads do cliente pra memória a cada
    // negócio ingerido.
    const achado = await resolverLeadExistente(pool, clientId, {
      externalId,
      telefone: pessoa?.telefoneBruto ?? telefone,
      email: pessoa?.email,
    });
    let match: { id: string; status: string | null; funnel_id: string | null; external_id: string | null } | null = null;
    if (achado) {
      const { rows: [row] } = await pool.query<{
        id: string; status: string | null; funnel_id: string | null; external_id: string | null;
      }>(`SELECT id, status, funnel_id, external_id FROM public.crm_leads WHERE id = $1`, [achado.id]);
      match = row ?? null;
    }

    // sinais monotônicos: etapa dá agendou/compareceu; ganho dá fechou.
    const sinais = sinaisDoStatus(labelEtapa ?? '');
    const fechou = sinais.fechou || ganhou;
    const observacao = [
      negocio.descricao,
      pessoa?.origemLead ? `Origem no Agendor: ${pessoa.origemLead}` : null,
      negocio.status === 'perdido' && negocio.motivoPerda ? `Perdido: ${negocio.motivoPerda}` : null,
    ].filter(Boolean).join(' · ') || null;

    if (match) {
      const statusNovo = labelEtapa ?? match.status ?? '';
      const leadFunnel = match.funnel_id ?? funnelId;
      await pool.query(
        `UPDATE public.crm_leads SET
           status = COALESCE($2, status),
           agendou = COALESCE(agendou, FALSE) OR $3,
           compareceu = COALESCE(compareceu, FALSE) OR $4,
           fechou = COALESCE(fechou, FALSE) OR $5,
           valor_rs = COALESCE($6, valor_rs),
           revenue = COALESCE($6, revenue),
           fechado_em = COALESCE(fechado_em, $13::date),
           perdido_em = COALESCE(perdido_em, $15::date),
           -- Responsável, valor estimado e produtos: o Agendor é a fonte, então
           -- sobrescrevem (mudar de vendedor ou de itens é evento normal).
           responsavel = COALESCE($16, responsavel),
           valor_negocio = COALESCE($17, valor_negocio),
           produtos = COALESCE($18::jsonb, produtos),
           link_externo = COALESCE($19, link_externo),
           nome = COALESCE(NULLIF(nome, ''), $7),
           email = COALESCE(NULLIF(email, ''), $8),
           numero = COALESCE(NULLIF(numero, ''), $9),
           observacao = COALESCE(NULLIF(observacao, ''), $10),
           -- canal só é sobrescrito enquanto for a porta de entrada: canal
           -- digitado pelo gestor (ou vindo de outra fonte) nunca é perdido.
           canal = CASE
             WHEN $14 <> 'agendor' AND (canal IS NULL OR lower(btrim(canal)) IN ('', 'agendor'))
               THEN $14 ELSE canal END,
           external_id = COALESCE(external_id, $11),
           funnel_id = COALESCE(funnel_id, $12),
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          match.id, labelEtapa, sinais.agendou, sinais.compareceu, fechou,
          valorVenda, pessoa?.nome ?? negocio.pessoa.nome ?? negocio.titulo,
          pessoa?.email ?? negocio.pessoa.email, pessoa?.telefoneBruto,
          observacao, externalId, funnelId, fechadoEm, canalDoLead,
          perdidoEm, negocio.responsavel, negocio.valorEstimado, produtosJson,
          negocio.linkExterno,
        ],
      );
      if (labelEtapa) await espelharEtapa(pool, clientId, leadFunnel, labelEtapa);
      await pool.query('COMMIT');
      return { leadId: match.id, criado: false, statusAnterior: match.status, statusNovo, telefone };
    }

    const status = labelEtapa ?? await getFirstFunnelStageLabel(pool, funnelId);
    const s2 = sinaisDoStatus(status);
    const now = new Date();
    // Data do lead: a criação no AGENDOR, não a de hoje — no backfill é isso
    // que põe o fechamento antigo no mês certo do funil.
    const dataLead = (negocio.criadoEm ?? now.toISOString()).slice(0, 10);
    const { rows: [novo] } = await pool.query<{ id: string }>(
      `INSERT INTO public.crm_leads
         (client_id, mes, data, nome, numero, canal, origin, observacao, status,
          funnel_id, email, valor_rs, revenue, agendou, compareceu, fechou, fechado_em, external_id,
          perdido_em, responsavel, valor_negocio, produtos, link_externo)
       VALUES ($1, $2, $3, $4, $5, $16, 'Agendor', $6, $7, $8, $9, $10, $10, $11, $12, $13, $14::date, $15,
               $17::date, $18, $19, $20::jsonb, $21)
       RETURNING id`,
      [
        clientId,
        `${new Date(dataLead).toLocaleString('pt-BR', { month: 'short' })}/${dataLead.slice(0, 4)}`,
        dataLead,
        pessoa?.nome ?? negocio.pessoa.nome ?? negocio.titulo,
        pessoa?.telefoneBruto,
        observacao,
        status,
        funnelId,
        pessoa?.email ?? negocio.pessoa.email,
        valorVenda,
        s2.agendou,
        s2.compareceu,
        s2.fechou || ganhou,
        fechadoEm,
        externalId,
        canalDoLead,
        perdidoEm,
        negocio.responsavel,
        negocio.valorEstimado,
        produtosJson,
        negocio.linkExterno,
      ],
    );
    if (labelEtapa) await espelharEtapa(pool, clientId, funnelId, labelEtapa);
    await pool.query('COMMIT');
    return { leadId: novo.id, criado: true, statusAnterior: null, statusNovo: status, telefone };
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Pós-processamento (fora da transação, best-effort): região por DDD, evento
 * de rastreio (dedupado por negócio+etapa+dia) e conversões quando o status
 * mudou. `origemDoLog` distingue webhook de backfill no agendor_log.
 */
export async function posProcessarIngestao(
  pool: Pool, conn: ConexaoAgendor, negocio: NegocioAgendor, pessoa: PessoaAgendor | null,
  r: ResultadoIngestao, raw: unknown, origemDoLog: 'criado' | 'atualizado' | 'backfill',
): Promise<void> {
  // ⚠️ B2B: o negócio não tem telefone próprio (está pendurado na empresa), mas
  // a conversa de WhatsApp que o originou tem. Liga um ao outro SEM fundir as
  // linhas — a mesma empresa tem vários negócios e uma conversa só.
  const telContato = pessoa?.telefoneBruto
    ?? telefoneDaEmpresaEmMemoria(conn.api_token, negocio.organizacaoId);
  if (telContato || pessoa?.email) {
    await vincularAoLeadDeOrigem(pool, conn.client_id, r.leadId, {
      telefone: telContato, email: pessoa?.email,
    }).catch(err => { console.error('[agendor vincular]', err?.message ?? err); return false; });
  }

  const regiao = regiaoFromPhone(pessoa?.telefoneBruto ?? telContato ?? null);
  await applyLeadAttribution(pool, r.leadId, {
    tracking: {},
    ddd: regiao?.ddd ?? null,
    regiaoUf: pessoa?.estado ?? regiao?.uf ?? null,
    regiaoCidade: pessoa?.cidade ?? regiao?.regiao ?? null,
    regiaoFonte: pessoa?.estado || pessoa?.cidade ? 'form' : regiao ? 'ddd' : null,
    email: pessoa?.email ?? null,
    hasClickMatch: false,
  }).catch(() => {});

  await recordTrackingEvent(pool, {
    leadId: r.leadId,
    clientId: conn.client_id,
    eventType: 'agendor',
    origin: null,
    canal: 'agendor',
    externalId: `ag:${negocio.idExterno}:${r.statusNovo}:${new Date().toISOString().slice(0, 10)}`,
    tracking: {},
    ddd: regiao?.ddd ?? null,
    regiaoUf: pessoa?.estado ?? regiao?.uf ?? null,
    raw,
  }).catch(err => console.error('[agendor] tracking event', err));

  // Conversão exige telefone (o CAPI/offline casa por identificador) — e no
  // BACKFILL nunca dispara: reenviar venda de meses atrás pra Meta/Google
  // poluiria a otimização com eventos fora de janela.
  if (origemDoLog !== 'backfill' && r.telefone && (r.criado || r.statusNovo !== (r.statusAnterior ?? ''))) {
    await dispararEventosPorStatus(pool, conn.client_id, r.statusNovo, {
      id: r.leadId, phone: pessoa?.telefoneBruto ?? r.telefone,
    }, negocio.valor).catch(err => console.error('[agendor] conversao', err));
  }

  await registrarLogAgendor(pool, {
    clientId: conn.client_id, raw,
    resultado: origemDoLog === 'backfill' ? 'backfill' : (r.criado ? 'criado' : 'atualizado'),
    detalhe: [
      pessoa?.nome ?? negocio.titulo ?? `negócio ${negocio.idExterno}`,
      r.criado ? `entrou em "${r.statusNovo}"` : `"${r.statusAnterior ?? '—'}" → "${r.statusNovo}"`,
      negocio.status === 'ganho' ? `💰 ganho${negocio.valor ? ` (R$ ${negocio.valor})` : ''}` : null,
      r.telefone ? null : 'sem telefone (não casa com WhatsApp)',
    ].filter(Boolean).join(' · '),
    leadId: r.leadId,
  });
}
