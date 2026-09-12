/**
 * VOLTA: SULTS → reports. Varredura do funil + diff contra o snapshot anterior.
 *
 * ⚠️ É varredura porque NÃO HÁ ALTERNATIVA: a API de Expansão não publica
 * webhook de saída, e a listagem de negócios não aceita filtro por data de
 * alteração (`GET /expansao/negocio` só filtra id, título, responsável, etapa e
 * funil). Então cada rodada lê o funil inteiro, 100 por página, e compara.
 *
 * ⚠️ A movimentação NÃO é escrita em `crm_leads.status`. O funil interno tem
 * dono — o Kanban, o motor de follow-up, a análise de IA e o disparo de
 * conversão por status leem e escrevem nele. Sobrescrever com a etapa do SULTS
 * faria dois sistemas brigarem pela mesma coluna de texto livre, e já existe
 * histórico de lead sumindo do Kanban por status órfão (IA do Kanban,
 * 2026-07-17). A etapa do cliente vive em tabela própria, ao lado, e quem
 * quiser cruzar faz JOIN por `lead_id`.
 */

import type { Pool } from 'pg';
import {
  diffNegocio, normalizarNegocio, type NegocioRemoto, type SnapshotNegocio,
} from '@/lib/sults';
import {
  ensureSultsSchema, listarConexoesSultsVolta, sultsFetch, SULTS_API,
  type ConexaoSults,
} from '@/lib/sults-server';
import { ingerirNegocioSults } from '@/lib/sults-ingest';
import { ensureDefaultFunnel } from '@/lib/crm-conversation-sync';
import { aplicarFunilExterno } from '@/lib/funil-externo-server';
import type { CatalogoSults } from '@/lib/sults';

const POR_PAGINA = 100; // teto da API
const MAX_PAGINAS = 60; // 6.000 negócios por rodada

let schemaVoltaOk: Promise<void> | null = null;

export function ensureSultsSyncSchema(pool: Pool): Promise<void> {
  if (!schemaVoltaOk) {
    schemaVoltaOk = (async () => {
      await ensureSultsSchema(pool);
      await pool.query(`
        ALTER TABLE public.sults_connections
          ADD COLUMN IF NOT EXISTS funil_id INT,
          ADD COLUMN IF NOT EXISTS sync_ativo BOOLEAN NOT NULL DEFAULT TRUE,
          -- Cursor retomável: rodada que estoura o orçamento continua da página
          -- onde parou, em vez de recomeçar do zero e nunca chegar ao fim num
          -- funil grande (mesma lição do backfill do Agendor).
          ADD COLUMN IF NOT EXISTS sync_pagina INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS ultima_volta_em TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS ultimo_erro_volta TEXT,
          -- Trazer o negócio para a tabela de leads (dashboard, funil e
          -- Performance Comercial) é opcional: só faz sentido para
          -- cliente que qualifica DENTRO do SULTS.
          ADD COLUMN IF NOT EXISTS ingerir_crm BOOLEAN NOT NULL DEFAULT FALSE,
          -- Catálogo (funis/etapas/responsáveis/origens) deduzido da API e
          -- GUARDADO. Sem isso a tela abria com todos os menus vazios: o
          -- catálogo só existia depois de clicar em "Reler funil", e select
          -- cujo valor não está nas opções renderiza em branco — a integração
          -- parecia desconectada mesmo estando salva e varrendo.
          ADD COLUMN IF NOT EXISTS catalogo JSONB,
          ADD COLUMN IF NOT EXISTS catalogo_em TIMESTAMPTZ
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.sults_negocios (
          client_id TEXT NOT NULL,
          negocio_id BIGINT NOT NULL,
          lead_id UUID,
          titulo TEXT,
          funil_id INT,
          funil_nome TEXT,
          etapa_id INT,
          etapa_nome TEXT,
          situacao_id INT,
          situacao_nome TEXT,
          responsavel_nome TEXT,
          origem_nome TEXT,
          campanha_nome TEXT,
          motivo_perda TEXT,
          valor NUMERIC,
          dt_cadastro TIMESTAMPTZ,
          dt_conclusao TIMESTAMPTZ,
          entrou_na_etapa_em TIMESTAMPTZ,
          duracao_etapas JSONB,
          cidade TEXT,
          uf TEXT,
          temperatura TEXT,
          contato_nome TEXT,
          contato_telefone TEXT,
          contato_email TEXT,
          primeira_vez_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          visto_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (client_id, negocio_id)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.sults_movimentos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL,
          negocio_id BIGINT NOT NULL,
          lead_id UUID,
          etapa_de_id INT,
          etapa_de_nome TEXT,
          etapa_para_id INT,
          etapa_para_nome TEXT,
          situacao_de_id INT,
          situacao_de_nome TEXT,
          situacao_para_id INT,
          situacao_para_nome TEXT,
          ocorrido_em TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Um movimento por (negócio, etapa de→para, momento). A varredura relê o
      // mesmo negócio a cada rodada; sem isso, um negócio parado numa etapa
      // geraria linha repetida toda vez que qualquer outro campo oscilasse.
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS sults_movimentos_uk
          ON public.sults_movimentos
             (client_id, negocio_id, ocorrido_em,
              COALESCE(etapa_de_id, -1), COALESCE(etapa_para_id, -1),
              COALESCE(situacao_para_id, -1))
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS sults_movimentos_lead_idx
          ON public.sults_movimentos (client_id, lead_id, ocorrido_em DESC)
      `);
      // Instalação que já tinha a tabela antes do contato existir.
      await pool.query(`
        ALTER TABLE public.sults_negocios
          ADD COLUMN IF NOT EXISTS cidade TEXT,
          ADD COLUMN IF NOT EXISTS uf TEXT,
          ADD COLUMN IF NOT EXISTS temperatura TEXT,
          ADD COLUMN IF NOT EXISTS contato_nome TEXT,
          ADD COLUMN IF NOT EXISTS contato_telefone TEXT,
          ADD COLUMN IF NOT EXISTS contato_email TEXT
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS sults_negocios_lead_idx
          ON public.sults_negocios (client_id, lead_id)
      `);
    })().catch(err => { schemaVoltaOk = null; throw err; });
  }
  return schemaVoltaOk;
}

type Pagina = { negocios: NegocioRemoto[]; totalPage: number | null };

async function buscarPagina(
  conn: ConexaoSults, start: number,
): Promise<Pagina> {
  const params = new URLSearchParams({ start: String(start), limit: String(POR_PAGINA) });
  if (conn.funil_id) params.set('funil', String(conn.funil_id));
  const r = await sultsFetch<{ data?: NegocioRemoto[]; totalPage?: number }>(
    conn.api_token as string, `${SULTS_API}/expansao/negocio?${params}`,
  );
  return {
    negocios: Array.isArray(r?.data) ? r.data : [],
    totalPage: Number.isFinite(r?.totalPage) ? Number(r?.totalPage) : null,
  };
}

export type ResultadoVolta = {
  client_id: string;
  lidos: number;
  novos: number;
  movimentos: number;
  paginas: number;
  varreduraCompleta: boolean;
  leadsCriados: number;
  leadsAtualizados: number;
  errosCrm: number;
  funil?: { modo: string; criadas: number; removidas: number; reordenadas: number; preservadas: { label: string; leads: number; gatilhos: number }[] };
  erro?: string;
};

async function sincronizarCliente(
  pool: Pool, conn: ConexaoSults, fim: number,
): Promise<ResultadoVolta> {
  const r: ResultadoVolta = {
    client_id: conn.client_id, lidos: 0, novos: 0, movimentos: 0,
    paginas: 0, varreduraCompleta: false,
    leadsCriados: 0, leadsAtualizados: 0, errosCrm: 0,
  };

  /**
   * ⚠️ O `start` da API é documentado como "número da página", mas o mesmo
   * parâmetro aparece como offset em outros endpoints da doc. Se estivermos
   * errados, a página 1 devolveria as linhas 1..100 — quase tudo repetido — e
   * a varredura levaria uma requisição por negócio para terminar. Em vez de
   * apostar, a primeira página seguinte é medida: sobreposição alta significa
   * offset, e o passo vira `POR_PAGINA`.
   */
  let passo = 1;
  let adaptado = false;
  let start = conn.sync_pagina ?? 0;
  const vistos = new Set<number>();
  const agora = new Date().toISOString();

  /**
   * Antes de ingerir: o funil daqui passa a refletir o de lá.
   *
   * ⚠️ Uma vez por varredura, não por negócio. E a ORDEM vem do catálogo
   * guardado (etapas ordenadas pelo id, que é a ordem do funil no SULTS) —
   * anexar na ordem em que os negócios aparecem punha "Perca" antes de
   * "Abordagem D1" no board.
   */
  if (conn.ingerir_crm) {
    try {
      const cat = conn.catalogo as CatalogoSults | null;
      const funis = cat?.funis ?? [];
      const escolhidos = conn.funil_id ? funis.filter(f => f.id === conn.funil_id) : funis;
      const etapas = escolhidos.flatMap(f => f.etapas.map(e => e.nome)).filter(Boolean);
      if (etapas.length) {
        const funnelId = await ensureDefaultFunnel(pool, conn.client_id);
        r.funil = await aplicarFunilExterno(pool, conn.client_id, funnelId, etapas);
      }
    } catch (err) {
      r.erro = `funil: ${(err as Error).message}`;
    }
  }

  let estado: EstadoAnterior;
  try {
    estado = await carregarEstado(pool, conn.client_id);
  } catch (err) {
    r.erro = `estado anterior: ${(err as Error).message}`;
    return r;
  }

  try {
    for (let i = 0; i < MAX_PAGINAS; i++) {
      if (Date.now() >= fim) break;

      const { negocios, totalPage } = await buscarPagina(conn, start);
      r.paginas++;
      if (negocios.length === 0) { r.varreduraCompleta = true; break; }

      const snaps = negocios
        .map(normalizarNegocio)
        .filter((s): s is SnapshotNegocio => s !== null);

      const repetidos = snaps.filter(s => vistos.has(s.negocioId)).length;
      if (!adaptado && start > (conn.sync_pagina ?? 0) && repetidos > snaps.length / 2) {
        adaptado = true;
        passo = POR_PAGINA;
        start = (conn.sync_pagina ?? 0) + POR_PAGINA;
        continue;
      }
      adaptado = true; // a partir da 2ª página o passo está decidido

      const paginaNova = snaps.filter(s => !vistos.has(s.negocioId));
      for (const s of paginaNova) vistos.add(s.negocioId);
      r.lidos += paginaNova.length;

      const efeito = await gravarPagina(pool, conn.client_id, paginaNova, estado, agora);
      r.novos += efeito.novos;
      r.movimentos += efeito.movimentos;

      // O espelho já está gravado; a ingestão no CRM é best-effort por negócio.
      // ⚠️ Um negócio problemático não pode derrubar a varredura inteira — o
      // espelho é a fonte, e a próxima rodada tenta de novo o que faltou.
      if (conn.ingerir_crm) {
        for (const s of efeito.paraCrm) {
          if (Date.now() >= fim) break;
          try {
            const res = await ingerirNegocioSults(pool, conn.client_id, s);
            if (res) {
              if (res.criado) r.leadsCriados++; else r.leadsAtualizados++;
              // ⚠️ Grava o vínculo no espelho: é o que marca "já ingerido" para
              // a próxima varredura, e é a chave que liga `sults_negocios` a
              // `crm_leads` em qualquer relatório.
              estado.ingeridos.add(s.negocioId);
              await pool.query(
                `UPDATE public.sults_negocios SET lead_id = $3::uuid
                  WHERE client_id = $1 AND negocio_id = $2`,
                [conn.client_id, s.negocioId, res.leadId],
              ).catch(() => null);
            }
          } catch (err) {
            r.errosCrm++;
            if (!r.erro) r.erro = `CRM (negócio ${s.negocioId}): ${(err as Error).message}`;
          }
        }
      }

      start += passo;
      if (negocios.length < POR_PAGINA) { r.varreduraCompleta = true; break; }
      if (totalPage !== null && passo === 1 && start >= totalPage) { r.varreduraCompleta = true; break; }
    }
  } catch (err) {
    r.erro = (err as Error).message;
  }

  // Cursor volta a zero só quando a passada fechou — senão retoma de onde parou.
  await pool.query(
    `UPDATE public.sults_connections
        SET sync_pagina = $2, ultima_volta_em = NOW(), ultimo_erro_volta = $3
      WHERE id = $1`,
    [conn.id, r.varreduraCompleta ? 0 : start, r.erro ?? null],
  );
  return r;
}

type EstadoAnterior = {
  etapas: Map<number, { etapaId: number | null; etapaNome: string | null;
                        situacaoId: number | null; situacaoNome: string | null }>;
  leads: Map<number, string>;
  /**
   * Negócios que JÁ viraram lead no CRM daqui.
   *
   * ⚠️ É o que conserta o acervo órfão: a fila do CRM era "novo ou mudou de
   * etapa", então ligar a ingestão DEPOIS do espelho pronto deixava os 1.833
   * já espelhados de fora para sempre — não eram novos e não tinham mudado.
   * Agora a pergunta é "já virou lead?", que é a pergunta certa.
   */
  ingeridos: Set<number>;
};

/**
 * Estado anterior do cliente inteiro, em DUAS consultas.
 *
 * ⚠️ Medido antes de existir: a versão anterior consultava o banco 3× POR
 * NEGÓCIO (estado anterior, lead vinculado, upsert). No funil do CondoStore —
 * 2.644 negócios — isso era ~8 mil consultas a cada varredura, de 10 em 10
 * minutos, para descobrir que quase nada mudou. Carregar tudo de uma vez e
 * comparar em memória troca isso por 2 consultas + uma gravação por página.
 */
async function carregarEstado(pool: Pool, clientId: string): Promise<EstadoAnterior> {
  const { rows: negs } = await pool.query<{
    negocio_id: string; etapa_id: number | null; etapa_nome: string | null;
    situacao_id: number | null; situacao_nome: string | null; lead_id: string | null;
  }>(
    `SELECT negocio_id, etapa_id, etapa_nome, situacao_id, situacao_nome, lead_id
       FROM public.sults_negocios WHERE client_id = $1`, [clientId],
  );
  // O elo com o lead do reports: quem criamos pelo worker de ida tem linha em
  // `sults_envios`. Negócio cadastrado à mão no SULTS não tem — e entra assim
  // mesmo, com lead_id null, para o funil do cliente aparecer inteiro.
  const { rows: envs } = await pool.query<{ negocio_id: string; lead_id: string }>(
    `SELECT negocio_id, lead_id FROM public.sults_envios
      WHERE client_id = $1 AND negocio_id IS NOT NULL`, [clientId],
  );
  return {
    etapas: new Map(negs.map(n => [Number(n.negocio_id), {
      etapaId: n.etapa_id, etapaNome: n.etapa_nome,
      situacaoId: n.situacao_id, situacaoNome: n.situacao_nome,
    }])),
    leads: new Map(envs.map(e => [Number(e.negocio_id), e.lead_id])),
    ingeridos: new Set(negs.filter(n => n.lead_id).map(n => Number(n.negocio_id))),
  };
}

const COLS_SNAPSHOT = 25;

/** Grava a página inteira: um upsert com todas as linhas, um insert dos movimentos. */
async function gravarPagina(
  pool: Pool, clientId: string, snaps: SnapshotNegocio[], estado: EstadoAnterior, agora: string,
): Promise<{ novos: number; movimentos: number; paraCrm: SnapshotNegocio[] }> {
  if (!snaps.length) return { novos: 0, movimentos: 0, paraCrm: [] };

  const valores: unknown[] = [];
  const linhas: string[] = [];
  const movs: { s: SnapshotNegocio; m: NonNullable<ReturnType<typeof diffNegocio>> }[] = [];
  let novos = 0;

  const paraCrm: SnapshotNegocio[] = [];
  for (const s of snaps) {
    const ant = estado.etapas.get(s.negocioId);
    if (!ant) novos++;
    // Vai para o CRM quem ainda não virou lead, além de quem mexeu. Reingerir
    // os 2.644 a cada 10 minutos seria milhares de transações para nada — mas
    // "nunca foi ingerido" é condição permanente até deixar de ser.
    const mexeu = !ant || ant.etapaId !== s.etapaId || ant.situacaoId !== s.situacaoId;
    if (mexeu || !estado.ingeridos.has(s.negocioId)) paraCrm.push(s);
    const anterior: SnapshotNegocio | null = ant ? { ...s, ...ant } : null;
    const m = diffNegocio(anterior, s, agora);
    if (m) movs.push({ s, m });
    // Mantém o estado em memória coerente: a mesma varredura não pode ver o
    // negócio duas vezes e gerar o movimento de novo.
    estado.etapas.set(s.negocioId, {
      etapaId: s.etapaId, etapaNome: s.etapaNome,
      situacaoId: s.situacaoId, situacaoNome: s.situacaoNome,
    });

    const b = valores.length;
    linhas.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},`
      + `$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},`
      + `$${b + 16}::timestamptz,$${b + 17}::timestamptz,$${b + 18}::timestamptz,$${b + 19}::jsonb,`
      + `$${b + 20},$${b + 21},$${b + 22},$${b + 23},$${b + 24},$${b + 25},NOW())`);
    valores.push(
      clientId, s.negocioId, estado.leads.get(s.negocioId) ?? null, s.titulo,
      s.funilId, s.funilNome, s.etapaId, s.etapaNome, s.situacaoId, s.situacaoNome,
      s.responsavelNome, s.origemNome, s.campanhaNome, s.motivoPerda, s.valor,
      s.dtCadastro, s.dtConclusao, s.entrouNaEtapaEm, JSON.stringify(s.duracaoEtapas),
      s.cidade, s.uf, s.temperatura, s.contatoNome, s.contatoTelefone, s.contatoEmail,
    );
  }

  if (valores.length !== snaps.length * COLS_SNAPSHOT) {
    throw new Error('montagem do upsert inconsistente'); // guarda contra edição futura
  }

  await pool.query(
    `INSERT INTO public.sults_negocios (
       client_id, negocio_id, lead_id, titulo, funil_id, funil_nome,
       etapa_id, etapa_nome, situacao_id, situacao_nome, responsavel_nome,
       origem_nome, campanha_nome, motivo_perda, valor, dt_cadastro,
       dt_conclusao, entrou_na_etapa_em, duracao_etapas,
       cidade, uf, temperatura, contato_nome, contato_telefone, contato_email, visto_em
     ) VALUES ${linhas.join(',')}
     ON CONFLICT (client_id, negocio_id) DO UPDATE SET
       lead_id = COALESCE(public.sults_negocios.lead_id, EXCLUDED.lead_id),
       titulo = EXCLUDED.titulo,
       funil_id = EXCLUDED.funil_id, funil_nome = EXCLUDED.funil_nome,
       etapa_id = EXCLUDED.etapa_id, etapa_nome = EXCLUDED.etapa_nome,
       situacao_id = EXCLUDED.situacao_id, situacao_nome = EXCLUDED.situacao_nome,
       responsavel_nome = EXCLUDED.responsavel_nome,
       origem_nome = EXCLUDED.origem_nome, campanha_nome = EXCLUDED.campanha_nome,
       motivo_perda = EXCLUDED.motivo_perda, valor = EXCLUDED.valor,
       dt_conclusao = EXCLUDED.dt_conclusao,
       entrou_na_etapa_em = EXCLUDED.entrou_na_etapa_em,
       duracao_etapas = EXCLUDED.duracao_etapas,
       cidade = EXCLUDED.cidade, uf = EXCLUDED.uf,
       temperatura = EXCLUDED.temperatura,
       contato_nome = EXCLUDED.contato_nome,
       contato_telefone = EXCLUDED.contato_telefone,
       contato_email = EXCLUDED.contato_email,
       visto_em = NOW()`,
    valores,
  );

  let gravados = 0;
  for (const { s, m } of movs) {
    const { rowCount } = await pool.query(
      `INSERT INTO public.sults_movimentos (
         client_id, negocio_id, lead_id,
         etapa_de_id, etapa_de_nome, etapa_para_id, etapa_para_nome,
         situacao_de_id, situacao_de_nome, situacao_para_id, situacao_para_nome,
         ocorrido_em
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)
       ON CONFLICT DO NOTHING`,
      [
        clientId, m.negocioId, estado.leads.get(s.negocioId) ?? null,
        m.etapaDeId, m.etapaDeNome, m.etapaParaId, m.etapaParaNome,
        m.situacaoDeId, m.situacaoDeNome, m.situacaoParaId, m.situacaoParaNome,
        m.ocorridoEm,
      ],
    );
    gravados += rowCount ?? 0;
  }

  return { novos, movimentos: gravados, paraCrm };
}

export async function sincronizarVoltaSults(
  pool: Pool, opts: { budgetMs?: number; clientId?: string } = {},
): Promise<{ clientes: ResultadoVolta[] }> {
  await ensureSultsSyncSchema(pool);
  const fim = Date.now() + (opts.budgetMs ?? 240_000);

  // `clientId` atende o botão "sincronizar agora" da tela: um cliente só, sem
  // fazer a pessoa esperar a varredura da carteira inteira.
  const conexoes = (await listarConexoesSultsVolta(pool))
    .filter(c => !opts.clientId || c.client_id === opts.clientId);

  const clientes: ResultadoVolta[] = [];
  for (const conn of conexoes) {
    if (Date.now() >= fim) break;
    clientes.push(await sincronizarCliente(pool, conn, fim));
  }
  return { clientes };
}
