/**
 * Persistência e execução da Fidelidade (server-only).
 *
 * Guarda CONFIGURAÇÃO (régua, textos, cupom, cadência, travas) e as LISTAS
 * manuais. O público de um segmento nunca é gravado: é recalculado a cada
 * leitura e a cada disparo (ver o comentário de arquitetura em fidelidade.ts).
 *
 * O que É gravado é o ENVIO — uma linha por pessoa por rodada. Ela sustenta as
 * três coisas que separam fidelização de spam: cooldown entre campanhas,
 * dedupe dentro da rodada e atribuição de receita depois.
 *
 * DDL inline e memoizada, padrão do repo.
 */

import type { Pool } from 'pg';
import {
  MODELOS_FIDELIDADE, ORDEM_MODELOS, limparMensagens, normalizarParams, normalizarTravas,
  normalizarCupom, paramsPadrao, TRAVAS_PADRAO, MODELOS,
  type FonteCampanha, type ModeloId, type ParamsRegua, type Travas,
} from '@/lib/fidelidade';
import { normalizarTelefoneBR } from '@/lib/cardapioweb-recorrencia';

let schemaEnsured = false;

export async function ensureFidelidadeSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    // Travas por CLIENTE, não por campanha: a reputação é do número, então o
    // teto diário precisa somar tudo que sai daquele chip.
    `CREATE TABLE IF NOT EXISTS public.fidelidade_config (
       client_id         TEXT PRIMARY KEY,
       intervalo_min_seg INT NOT NULL DEFAULT 120,
       teto_diario       INT NOT NULL DEFAULT 50,
       janela_inicio     TEXT NOT NULL DEFAULT '09:00',
       janela_fim        TEXT NOT NULL DEFAULT '20:00',
       dias_semana       TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
       cooldown_dias     INT NOT NULL DEFAULT 7,
       optout_ativo      BOOLEAN NOT NULL DEFAULT true,
       criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS public.fidelidade_campanhas (
       id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       client_id     TEXT NOT NULL,
       modelo        TEXT,
       params        JSONB,
       mensagens     JSONB,
       imagem_url    TEXT,
       dias_semana   TEXT,
       hora          TEXT,
       teto_publico  INT,
       ativa         BOOLEAN NOT NULL DEFAULT false,
       criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Campanha de lista manual não tem modelo — a coluna deixou de ser NOT NULL.
    `ALTER TABLE public.fidelidade_campanhas ALTER COLUMN modelo DROP NOT NULL`,
    `ALTER TABLE public.fidelidade_campanhas ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'segmento'`,
    `ALTER TABLE public.fidelidade_campanhas ADD COLUMN IF NOT EXISTS cupom TEXT`,
    `ALTER TABLE public.fidelidade_campanhas ADD COLUMN IF NOT EXISTS lista_id UUID`,
    `ALTER TABLE public.fidelidade_campanhas ADD COLUMN IF NOT EXISTS nome TEXT`,
    `ALTER TABLE public.fidelidade_campanhas ADD COLUMN IF NOT EXISTS proxima_execucao TIMESTAMPTZ`,
    `ALTER TABLE public.fidelidade_campanhas ADD COLUMN IF NOT EXISTS ultima_execucao TIMESTAMPTZ`,
    // ⚠️ A unique passou a ser PARCIAL: um segmento por cliente continua valendo
    // (senão duas campanhas do mesmo público brigariam sob o cooldown), mas
    // listas manuais podem ser quantas forem.
    `DROP INDEX IF EXISTS public.fidelidade_campanhas_cliente_modelo_idx`,
    `CREATE UNIQUE INDEX IF NOT EXISTS fidelidade_campanhas_cliente_segmento_idx
       ON public.fidelidade_campanhas (client_id, modelo) WHERE fonte = 'segmento'`,
    `CREATE INDEX IF NOT EXISTS fidelidade_campanhas_devidas_idx
       ON public.fidelidade_campanhas (ativa, proxima_execucao)`,

    // ── Listas manuais ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS public.fidelidade_listas (
       id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       client_id TEXT NOT NULL,
       nome      TEXT NOT NULL,
       criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS fidelidade_listas_cliente_idx
       ON public.fidelidade_listas (client_id)`,
    // A PK por (lista, chave normalizada) é a idempotência da importação: colar
    // a mesma planilha duas vezes não duplica ninguém.
    `CREATE TABLE IF NOT EXISTS public.fidelidade_lista_contatos (
       lista_id  UUID NOT NULL REFERENCES public.fidelidade_listas(id) ON DELETE CASCADE,
       chave     TEXT NOT NULL,
       telefone  TEXT NOT NULL,
       nome      TEXT,
       criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (lista_id, chave)
     )`,

    // ── Execução ──────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS public.fidelidade_execucoes (
       id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       campanha_id  UUID NOT NULL REFERENCES public.fidelidade_campanhas(id) ON DELETE CASCADE,
       client_id    TEXT NOT NULL,
       iniciada_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       concluida_em TIMESTAMPTZ,
       status       TEXT NOT NULL DEFAULT 'rodando',
       publico      INT NOT NULL DEFAULT 0,
       enviadas     INT NOT NULL DEFAULT 0,
       falhas       INT NOT NULL DEFAULT 0,
       puladas      INT NOT NULL DEFAULT 0,
       erro         TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS fidelidade_execucoes_campanha_idx
       ON public.fidelidade_execucoes (campanha_id, iniciada_em DESC)`,
    `CREATE TABLE IF NOT EXISTS public.fidelidade_envios (
       id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       execucao_id UUID NOT NULL REFERENCES public.fidelidade_execucoes(id) ON DELETE CASCADE,
       campanha_id UUID NOT NULL,
       client_id   TEXT NOT NULL,
       chave       TEXT NOT NULL,
       telefone    TEXT NOT NULL,
       nome        TEXT,
       status      TEXT NOT NULL DEFAULT 'pendente',
       motivo      TEXT,
       variacao    INT,
       cupom       TEXT,
       criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       enviado_em  TIMESTAMPTZ,
       erro        TEXT
     )`,
    // ⚠️ O TEXTO exatamente como foi entregue, já com nome, loja e cupom
    // aplicados. Guardar só o índice da variação obrigaria a RECONSTRUIR a
    // mensagem para mostrar ao gestor — e reconstrução não é registro: se o
    // texto da campanha mudar depois, a reconstrução passa a mentir sobre o
    // que a pessoa recebeu.
    `ALTER TABLE public.fidelidade_envios ADD COLUMN IF NOT EXISTS texto TEXT`,
    // O índice do COOLDOWN — a consulta mais quente do motor.
    `CREATE INDEX IF NOT EXISTS fidelidade_envios_cooldown_idx
       ON public.fidelidade_envios (client_id, chave, enviado_em DESC)
       WHERE status = 'enviada'`,
    `CREATE INDEX IF NOT EXISTS fidelidade_envios_fila_idx
       ON public.fidelidade_envios (execucao_id, status)`,

    // ── Opt-out ───────────────────────────────────────────────────────────
    // Vale para o CLIENTE inteiro, não para a campanha: quem pediu para não
    // receber não quer receber de nenhuma delas.
    `CREATE TABLE IF NOT EXISTS public.fidelidade_optout (
       client_id TEXT NOT NULL,
       chave     TEXT NOT NULL,
       telefone  TEXT,
       motivo    TEXT,
       criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (client_id, chave)
     )`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(err => console.error('[fidelidade schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}

// ─────────────────────────────────────────────────────────────── Campanhas

export type CampanhaFidelidade = {
  id: string | null;
  fonte: FonteCampanha;
  /** Só em fonte 'segmento'. */
  modelo: ModeloId | null;
  /** Só em fonte 'lista'. */
  listaId: string | null;
  nome: string;
  params: ParamsRegua;
  mensagens: string[];
  cupom: string | null;
  imagemUrl: string | null;
  diasSemana: number[];
  hora: string;
  tetoPublico: number | null;
  ativa: boolean;
  /** false = nunca salva; a tela mostra os padrões de fábrica. */
  salva: boolean;
  ultimaExecucao: string | null;
};

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDias(raw: string | null | undefined, padrao: number[]): number[] {
  if (!raw) return padrao;
  const dias = [...new Set(
    raw.split(',').map(s => Number(s.trim())).filter(d => Number.isInteger(d) && d >= 0 && d <= 6),
  )].sort();
  return dias.length > 0 ? dias : padrao;
}

/** Uma campanha de segmento "de fábrica": o que a tela mostra antes de editar. */
export function campanhaPadrao(modelo: ModeloId): CampanhaFidelidade {
  const m = MODELOS_FIDELIDADE[modelo];
  return {
    id: null,
    fonte: 'segmento',
    modelo,
    listaId: null,
    nome: m.nome,
    params: paramsPadrao(modelo),
    mensagens: [...m.mensagensPadrao],
    cupom: null,
    imagemUrl: null,
    diasSemana: [...m.cadenciaPadrao.diasSemana],
    hora: m.cadenciaPadrao.hora,
    tetoPublico: null,
    ativa: false,
    salva: false,
    ultimaExecucao: null,
  };
}

type LinhaCampanha = {
  id: string; fonte: string; modelo: string | null; lista_id: string | null; nome: string | null;
  params: unknown; mensagens: unknown; cupom: string | null; imagem_url: string | null;
  dias_semana: string | null; hora: string | null; teto_publico: number | null;
  ativa: boolean; ultima_execucao: string | Date | null;
};

const COLS_CAMPANHA = `id, fonte, modelo, lista_id, nome, params, mensagens, cupom, imagem_url,
                       dias_semana, hora, teto_publico, ativa, ultima_execucao`;

function linhaParaCampanha(l: LinhaCampanha): CampanhaFidelidade {
  const modelo = (MODELOS as readonly string[]).includes(l.modelo ?? '')
    ? l.modelo as ModeloId : null;
  const fonte: FonteCampanha = l.fonte === 'lista' ? 'lista' : 'segmento';
  const padraoDias = modelo ? MODELOS_FIDELIDADE[modelo].cadenciaPadrao.diasSemana : [2];
  const padraoHora = modelo ? MODELOS_FIDELIDADE[modelo].cadenciaPadrao.hora : '18:00';
  return {
    id: l.id,
    fonte,
    modelo,
    listaId: l.lista_id,
    nome: l.nome?.trim() || (modelo ? MODELOS_FIDELIDADE[modelo].nome : 'Campanha'),
    params: modelo ? normalizarParams(modelo, l.params) : {},
    mensagens: limparMensagens(l.mensagens, modelo),
    cupom: normalizarCupom(l.cupom),
    imagemUrl: l.imagem_url,
    diasSemana: parseDias(l.dias_semana, padraoDias),
    hora: HORA_RE.test(l.hora ?? '') ? l.hora! : padraoHora,
    tetoPublico: l.teto_publico ?? null,
    ativa: l.ativa,
    salva: true,
    ultimaExecucao: l.ultima_execucao
      ? (l.ultima_execucao instanceof Date ? l.ultima_execucao.toISOString() : String(l.ultima_execucao))
      : null,
  };
}

/**
 * Todas as campanhas do cliente: os 5 segmentos (com os padrões de fábrica
 * preenchendo o que ainda não foi salvo) seguidos das campanhas de lista.
 */
export async function listarCampanhas(pool: Pool, clientId: string): Promise<CampanhaFidelidade[]> {
  const { rows } = await pool.query<LinhaCampanha>(
    `SELECT ${COLS_CAMPANHA} FROM public.fidelidade_campanhas
      WHERE client_id = $1 ORDER BY criado_em ASC`,
    [clientId],
  ).catch(() => ({ rows: [] as LinhaCampanha[] }));

  const salvas = rows.map(linhaParaCampanha);
  const porModelo = new Map(
    salvas.filter(c => c.fonte === 'segmento' && c.modelo).map(c => [c.modelo!, c]),
  );

  const segmentos = ORDEM_MODELOS.map(m => porModelo.get(m) ?? campanhaPadrao(m));
  const listas = salvas.filter(c => c.fonte === 'lista');
  return [...segmentos, ...listas];
}

export async function salvarCampanha(
  pool: Pool, clientId: string, bruto: Record<string, unknown>,
): Promise<CampanhaFidelidade> {
  const fonte: FonteCampanha = bruto.fonte === 'lista' ? 'lista' : 'segmento';
  const modelo = (MODELOS as readonly string[]).includes(String(bruto.modelo))
    ? String(bruto.modelo) as ModeloId : null;
  if (fonte === 'segmento' && !modelo) throw new Error('Modelo inválido');

  const params = modelo ? normalizarParams(modelo, bruto.params) : {};
  const mensagens = limparMensagens(bruto.mensagens, modelo);
  const padrao = modelo ? MODELOS_FIDELIDADE[modelo].cadenciaPadrao : { diasSemana: [2], hora: '18:00' };
  const dias = parseDias(
    Array.isArray(bruto.diasSemana) ? (bruto.diasSemana as unknown[]).join(',') : null,
    padrao.diasSemana,
  );
  const hora = typeof bruto.hora === 'string' && HORA_RE.test(bruto.hora) ? bruto.hora : padrao.hora;
  const tetoBruto = Number(bruto.tetoPublico);
  const tetoPublico = Number.isFinite(tetoBruto) && tetoBruto > 0
    ? Math.min(100_000, Math.round(tetoBruto)) : null;
  const imagemUrl = typeof bruto.imagemUrl === 'string' && bruto.imagemUrl.trim()
    ? bruto.imagemUrl.trim() : null;
  const cupom = normalizarCupom(bruto.cupom);
  const listaId = fonte === 'lista' && typeof bruto.listaId === 'string' ? bruto.listaId : null;
  if (fonte === 'lista' && !listaId) throw new Error('Campanha de lista precisa de uma lista');
  const nome = typeof bruto.nome === 'string' && bruto.nome.trim()
    ? bruto.nome.trim().slice(0, 120)
    : (modelo ? MODELOS_FIDELIDADE[modelo].nome : 'Campanha');
  const ativa = bruto.ativa === true;

  const valores = [
    clientId, fonte, modelo, listaId, nome, JSON.stringify(params), JSON.stringify(mensagens),
    cupom, imagemUrl, dias.join(','), hora, tetoPublico, ativa,
  ];

  // Segmento é idempotente pela unique parcial; lista é insert ou update por id.
  if (fonte === 'segmento') {
    const { rows } = await pool.query<LinhaCampanha>(
      `INSERT INTO public.fidelidade_campanhas
         (client_id, fonte, modelo, lista_id, nome, params, mensagens, cupom, imagem_url,
          dias_semana, hora, teto_publico, ativa)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (client_id, modelo) WHERE fonte = 'segmento' DO UPDATE SET
         params = EXCLUDED.params, mensagens = EXCLUDED.mensagens, cupom = EXCLUDED.cupom,
         imagem_url = EXCLUDED.imagem_url, dias_semana = EXCLUDED.dias_semana,
         hora = EXCLUDED.hora, teto_publico = EXCLUDED.teto_publico, nome = EXCLUDED.nome,
         ativa = EXCLUDED.ativa, atualizado_em = NOW()
       RETURNING ${COLS_CAMPANHA}`,
      valores,
    );
    return linhaParaCampanha(rows[0]);
  }

  const id = typeof bruto.id === 'string' && bruto.id ? bruto.id : null;
  if (id) {
    const { rows } = await pool.query<LinhaCampanha>(
      `UPDATE public.fidelidade_campanhas SET
         lista_id = $4, nome = $5, params = $6::jsonb, mensagens = $7::jsonb, cupom = $8,
         imagem_url = $9, dias_semana = $10, hora = $11, teto_publico = $12, ativa = $13,
         atualizado_em = NOW()
       WHERE id = $14 AND client_id = $1
       RETURNING ${COLS_CAMPANHA}`,
      [...valores, id],
    );
    if (rows[0]) return linhaParaCampanha(rows[0]);
  }
  const { rows } = await pool.query<LinhaCampanha>(
    `INSERT INTO public.fidelidade_campanhas
       (client_id, fonte, modelo, lista_id, nome, params, mensagens, cupom, imagem_url,
        dias_semana, hora, teto_publico, ativa)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)
     RETURNING ${COLS_CAMPANHA}`,
    valores,
  );
  return linhaParaCampanha(rows[0]);
}

export async function excluirCampanha(pool: Pool, clientId: string, id: string): Promise<void> {
  await pool.query(
    `DELETE FROM public.fidelidade_campanhas WHERE id = $1 AND client_id = $2 AND fonte = 'lista'`,
    [id, clientId],
  );
}

// ───────────────────────────────────────────────────────────────── Listas

export type ListaFidelidade = { id: string; nome: string; contatos: number; criadoEm: string };

export async function listarListas(pool: Pool, clientId: string): Promise<ListaFidelidade[]> {
  const { rows } = await pool.query<{ id: string; nome: string; contatos: string; criado_em: Date }>(
    `SELECT l.id, l.nome, l.criado_em,
            (SELECT COUNT(*) FROM public.fidelidade_lista_contatos c WHERE c.lista_id = l.id) AS contatos
       FROM public.fidelidade_listas l
      WHERE l.client_id = $1
      ORDER BY l.criado_em DESC`,
    [clientId],
  ).catch(() => ({ rows: [] as { id: string; nome: string; contatos: string; criado_em: Date }[] }));

  return rows.map(r => ({
    id: r.id,
    nome: r.nome,
    contatos: Number(r.contatos) || 0,
    criadoEm: r.criado_em instanceof Date ? r.criado_em.toISOString() : String(r.criado_em),
  }));
}

/**
 * Cria ou completa uma lista com os contatos lidos.
 *
 * Importar de novo é seguro: a PK (lista, chave) faz o `ON CONFLICT` atualizar
 * o nome em vez de duplicar a pessoa.
 */
export async function salvarLista(
  pool: Pool, clientId: string,
  { id, nome, contatos }: { id?: string | null; nome: string; contatos: { telefone: string; nome: string | null }[] },
): Promise<{ id: string; inseridos: number }> {
  let listaId = id ?? null;
  if (listaId) {
    await pool.query(
      `UPDATE public.fidelidade_listas SET nome = $1 WHERE id = $2 AND client_id = $3`,
      [nome, listaId, clientId],
    );
  } else {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.fidelidade_listas (client_id, nome) VALUES ($1, $2) RETURNING id`,
      [clientId, nome],
    );
    listaId = rows[0].id;
  }

  let inseridos = 0;
  for (const c of contatos) {
    const chave = normalizarTelefoneBR(c.telefone);
    if (!chave) continue;
    await pool.query(
      `INSERT INTO public.fidelidade_lista_contatos (lista_id, chave, telefone, nome)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lista_id, chave) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, fidelidade_lista_contatos.nome)`,
      [listaId, chave, c.telefone, c.nome],
    );
    inseridos++;
  }
  return { id: listaId!, inseridos };
}

export async function excluirLista(pool: Pool, clientId: string, id: string): Promise<void> {
  // A campanha que apontava para a lista fica sem público — desativa junto, em
  // vez de deixá-la "ativa" tentando disparar para o vazio a cada rodada.
  await pool.query(
    `UPDATE public.fidelidade_campanhas SET ativa = false, lista_id = NULL
      WHERE client_id = $1 AND lista_id = $2`, [clientId, id],
  );
  await pool.query(`DELETE FROM public.fidelidade_listas WHERE id = $1 AND client_id = $2`, [id, clientId]);
}

export async function contatosDaLista(
  pool: Pool, listaId: string,
): Promise<{ chave: string; telefone: string; nome: string | null }[]> {
  const { rows } = await pool.query<{ chave: string; telefone: string; nome: string | null }>(
    `SELECT chave, telefone, nome FROM public.fidelidade_lista_contatos
      WHERE lista_id = $1 ORDER BY criado_em ASC`,
    [listaId],
  ).catch(() => ({ rows: [] as { chave: string; telefone: string; nome: string | null }[] }));
  return rows;
}

// ───────────────────────────────────────────────────────────────── Travas

export async function lerTravas(pool: Pool, clientId: string): Promise<Travas> {
  const { rows } = await pool.query<{
    intervalo_min_seg: number; teto_diario: number; janela_inicio: string;
    janela_fim: string; dias_semana: string; cooldown_dias: number; optout_ativo: boolean;
  }>(
    `SELECT intervalo_min_seg, teto_diario, janela_inicio, janela_fim,
            dias_semana, cooldown_dias, optout_ativo
       FROM public.fidelidade_config WHERE client_id = $1`,
    [clientId],
  ).catch(() => ({ rows: [] }));

  const r = rows[0];
  if (!r) return { ...TRAVAS_PADRAO };
  return normalizarTravas({
    intervaloMinSeg: r.intervalo_min_seg,
    tetoDiario: r.teto_diario,
    janelaInicio: r.janela_inicio,
    janelaFim: r.janela_fim,
    diasSemana: parseDias(r.dias_semana, TRAVAS_PADRAO.diasSemana),
    cooldownDias: r.cooldown_dias,
    optoutAtivo: r.optout_ativo,
  });
}

export async function salvarTravas(pool: Pool, clientId: string, bruto: unknown): Promise<Travas> {
  const t = normalizarTravas(bruto);
  await pool.query(
    `INSERT INTO public.fidelidade_config
       (client_id, intervalo_min_seg, teto_diario, janela_inicio, janela_fim,
        dias_semana, cooldown_dias, optout_ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (client_id) DO UPDATE SET
       intervalo_min_seg = EXCLUDED.intervalo_min_seg, teto_diario = EXCLUDED.teto_diario,
       janela_inicio = EXCLUDED.janela_inicio, janela_fim = EXCLUDED.janela_fim,
       dias_semana = EXCLUDED.dias_semana, cooldown_dias = EXCLUDED.cooldown_dias,
       optout_ativo = EXCLUDED.optout_ativo, atualizado_em = NOW()`,
    [clientId, t.intervaloMinSeg, t.tetoDiario, t.janelaInicio, t.janelaFim,
      t.diasSemana.join(','), t.cooldownDias, t.optoutAtivo],
  );
  return t;
}

// ──────────────────────────────────────────────── Opt-out, cooldown e teto

export async function chavesComOptout(
  pool: Pool, clientId: string, chaves: string[],
): Promise<Set<string>> {
  if (chaves.length === 0) return new Set();
  const { rows } = await pool.query<{ chave: string }>(
    `SELECT chave FROM public.fidelidade_optout WHERE client_id = $1 AND chave = ANY($2::text[])`,
    [clientId, chaves],
  ).catch(() => ({ rows: [] as { chave: string }[] }));
  return new Set(rows.map(r => r.chave));
}

export async function registrarOptout(
  pool: Pool, clientId: string, telefone: string, motivo: string,
): Promise<boolean> {
  const chave = normalizarTelefoneBR(telefone);
  if (!chave) return false;
  await pool.query(
    `INSERT INTO public.fidelidade_optout (client_id, chave, telefone, motivo)
     VALUES ($1, $2, $3, $4) ON CONFLICT (client_id, chave) DO NOTHING`,
    [clientId, chave, telefone, motivo.slice(0, 200)],
  );
  return true;
}

/**
 * Quem já recebeu QUALQUER campanha de fidelidade dentro do cooldown.
 *
 * ⚠️ A janela é por cliente, não por campanha — é isso que impede a mesma
 * pessoa, que cai em três segmentos ao mesmo tempo, de receber três mensagens
 * na mesma semana.
 */
export async function chavesEmCooldown(
  pool: Pool, clientId: string, chaves: string[], dias: number,
): Promise<Set<string>> {
  if (chaves.length === 0 || dias <= 0) return new Set();
  const { rows } = await pool.query<{ chave: string }>(
    `SELECT DISTINCT chave FROM public.fidelidade_envios
      WHERE client_id = $1 AND status = 'enviada' AND chave = ANY($2::text[])
        AND enviado_em > NOW() - ($3 || ' days')::interval`,
    [clientId, chaves, String(dias)],
  ).catch(() => ({ rows: [] as { chave: string }[] }));
  return new Set(rows.map(r => r.chave));
}

/** Enviadas hoje (BRT) por este cliente, somando TODAS as campanhas dele. */
export async function enviadasHoje(pool: Pool, clientId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM public.fidelidade_envios
      WHERE client_id = $1 AND status = 'enviada'
        AND (enviado_em AT TIME ZONE 'America/Sao_Paulo')::date
            = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`,
    [clientId],
  ).catch(() => ({ rows: [{ n: '0' }] }));
  return Number(rows[0]?.n ?? 0);
}
