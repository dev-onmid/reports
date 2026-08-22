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
 *  2. telefone (chaveTelefone sobre numero E phone), padrão da planilha.
 *
 * ⚠️ Negócio SEM telefone ENTRA mesmo assim (diferente do Datalytics): o
 * Agendor referencia a pessoa sem contato no payload, e descartar seria
 * perder fechamentos reais do Funil de Performance. Sem telefone só não há
 * casamento com conversas do WhatsApp nem disparo de conversão.
 */

import type { Pool } from 'pg';
import type { FiltrosImportacao, NegocioAgendor, PessoaAgendor } from '@/lib/agendor';
import { normalizarNegocio, normalizarPessoa, parseFiltro, passaFiltros } from '@/lib/agendor';
import { agendorFetch, AGENDOR_API, type ConexaoAgendor, registrarLogAgendor } from '@/lib/agendor-server';
import { chaveTelefone, sinaisDoStatus } from '@/lib/importacao-origem';
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
      ADD COLUMN IF NOT EXISTS external_id TEXT
  `).catch(() => {});
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
export async function buscarOrganizacaoAgendor(
  apiToken: string, orgId: string,
): Promise<PessoaAgendor | null> {
  try {
    const r = await agendorFetch<{ data?: Record<string, unknown> }>(
      apiToken, `${AGENDOR_API}/organizations/${encodeURIComponent(orgId)}`);
    return r?.data ? normalizarPessoa(r.data) : null;
  } catch {
    return null;
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
  if (
    filtros.origens && filtros.origens.length > 0 &&
    !p?.origemLeadId && n.organizacaoId && conn.api_token
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

export async function ingerirNegocioAgendor(
  pool: Pool, clientId: string, negocio: NegocioAgendor, pessoa: PessoaAgendor | null,
): Promise<ResultadoIngestao> {
  await ensureColunasLead(pool);

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

  await pool.query('BEGIN');
  try {
    await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agendor:${clientId}:${negocio.idExterno}`]);
    const funnelId = await ensureDefaultFunnel(pool, clientId);

    const { rows: existentes } = await pool.query<{
      id: string; numero: string | null; phone: string | null;
      status: string | null; funnel_id: string | null; external_id: string | null;
    }>(
      `SELECT id, numero, phone, status, funnel_id, external_id
         FROM public.crm_leads WHERE client_id = $1`,
      [clientId],
    );
    let match =
      existentes.find(e => e.external_id === externalId) ??
      (telefone
        ? existentes.find(e => chaveTelefone(e.numero) === telefone || chaveTelefone(e.phone) === telefone)
        : undefined) ??
      // Número INTERNACIONAL (+351, +44, +1…): chaveTelefone é BR e devolve
      // null, o casamento por chave não acontece e o 2º negócio da mesma
      // pessoa estourava a unique (client_id, numero) de produção — visto ao
      // vivo na Londrigifts. Igualdade de texto cru cobre esse caso.
      (pessoa?.telefoneBruto
        ? existentes.find(e => e.numero === pessoa.telefoneBruto)
        : undefined) ?? null;

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
           nome = COALESCE(NULLIF(nome, ''), $7),
           email = COALESCE(NULLIF(email, ''), $8),
           numero = COALESCE(NULLIF(numero, ''), $9),
           observacao = COALESCE(NULLIF(observacao, ''), $10),
           external_id = COALESCE(external_id, $11),
           funnel_id = COALESCE(funnel_id, $12),
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          match.id, labelEtapa, sinais.agendou, sinais.compareceu, fechou,
          valorVenda, pessoa?.nome ?? negocio.pessoa.nome ?? negocio.titulo,
          pessoa?.email ?? negocio.pessoa.email, pessoa?.telefoneBruto,
          observacao, externalId, funnelId, fechadoEm,
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
          funnel_id, email, valor_rs, revenue, agendou, compareceu, fechou, fechado_em, external_id)
       VALUES ($1, $2, $3, $4, $5, 'agendor', 'Agendor', $6, $7, $8, $9, $10, $10, $11, $12, $13, $14::date, $15)
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
  const regiao = regiaoFromPhone(pessoa?.telefoneBruto ?? null);
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
