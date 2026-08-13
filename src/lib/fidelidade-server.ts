/**
 * Persistência da Fidelidade (server-only).
 *
 * Guarda apenas a CONFIGURAÇÃO — régua, textos, cadência e travas. O público
 * nunca é gravado: ele é recalculado a cada leitura e, no futuro, a cada
 * disparo (ver o comentário de arquitetura em fidelidade.ts).
 *
 * DDL inline e memoizada, padrão do repo (não há .sql para tabelas novas).
 */

import type { Pool } from 'pg';
import {
  MODELOS_FIDELIDADE, ORDEM_MODELOS, limparMensagens, normalizarParams, normalizarTravas,
  paramsPadrao, TRAVAS_PADRAO, type ModeloId, type ParamsRegua, type Travas,
} from '@/lib/fidelidade';

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
    // Uma campanha por modelo por cliente. A unique é o que faz o salvar ser
    // idempotente e o que impede duas campanhas do mesmo segmento competindo
    // pelo mesmo público sob o cooldown.
    `CREATE TABLE IF NOT EXISTS public.fidelidade_campanhas (
       id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       client_id     TEXT NOT NULL,
       modelo        TEXT NOT NULL,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS fidelidade_campanhas_cliente_modelo_idx
       ON public.fidelidade_campanhas (client_id, modelo)`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(err => console.error('[fidelidade schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}

export type CampanhaFidelidade = {
  modelo: ModeloId;
  params: ParamsRegua;
  mensagens: string[];
  imagemUrl: string | null;
  diasSemana: number[];
  hora: string;
  /** null = sem corte extra além do teto diário das travas. */
  tetoPublico: number | null;
  ativa: boolean;
  /** false = nunca salva; a tela mostra os padrões de fábrica. */
  salva: boolean;
};

function parseDias(raw: string | null | undefined, padrao: number[]): number[] {
  if (!raw) return padrao;
  const dias = [...new Set(
    raw.split(',').map(s => Number(s.trim())).filter(d => Number.isInteger(d) && d >= 0 && d <= 6),
  )].sort();
  return dias.length > 0 ? dias : padrao;
}

/** Uma campanha "de fábrica": o que a tela mostra antes de qualquer edição. */
export function campanhaPadrao(modelo: ModeloId): CampanhaFidelidade {
  const m = MODELOS_FIDELIDADE[modelo];
  return {
    modelo,
    params: paramsPadrao(modelo),
    mensagens: [...m.mensagensPadrao],
    imagemUrl: null,
    diasSemana: [...m.cadenciaPadrao.diasSemana],
    hora: m.cadenciaPadrao.hora,
    tetoPublico: null,
    ativa: false,
    salva: false,
  };
}

type LinhaCampanha = {
  modelo: string;
  params: unknown;
  mensagens: unknown;
  imagem_url: string | null;
  dias_semana: string | null;
  hora: string | null;
  teto_publico: number | null;
  ativa: boolean;
};

/**
 * Todas as campanhas do cliente, na ordem dos modelos, com os padrões de
 * fábrica preenchendo o que ainda não foi salvo. A tela nunca precisa saber se
 * a linha existe no banco.
 */
export async function listarCampanhas(pool: Pool, clientId: string): Promise<CampanhaFidelidade[]> {
  const { rows } = await pool.query<LinhaCampanha>(
    `SELECT modelo, params, mensagens, imagem_url, dias_semana, hora, teto_publico, ativa
       FROM public.fidelidade_campanhas WHERE client_id = $1`,
    [clientId],
  ).catch(() => ({ rows: [] as LinhaCampanha[] }));

  const porModelo = new Map(rows.map(r => [r.modelo, r]));

  return ORDEM_MODELOS.map(modelo => {
    const linha = porModelo.get(modelo);
    if (!linha) return campanhaPadrao(modelo);
    const padrao = MODELOS_FIDELIDADE[modelo];
    return {
      modelo,
      params: normalizarParams(modelo, linha.params),
      mensagens: limparMensagens(linha.mensagens, modelo),
      imagemUrl: linha.imagem_url,
      diasSemana: parseDias(linha.dias_semana, padrao.cadenciaPadrao.diasSemana),
      hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(linha.hora ?? '') ? linha.hora! : padrao.cadenciaPadrao.hora,
      tetoPublico: linha.teto_publico ?? null,
      ativa: linha.ativa,
      salva: true,
    };
  });
}

export async function salvarCampanha(
  pool: Pool, clientId: string, modelo: ModeloId, bruto: Record<string, unknown>,
): Promise<CampanhaFidelidade> {
  const padrao = MODELOS_FIDELIDADE[modelo];
  const params = normalizarParams(modelo, bruto.params);
  const mensagens = limparMensagens(bruto.mensagens, modelo);
  const dias = parseDias(
    Array.isArray(bruto.diasSemana) ? (bruto.diasSemana as unknown[]).join(',') : null,
    padrao.cadenciaPadrao.diasSemana,
  );
  const hora = typeof bruto.hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(bruto.hora)
    ? bruto.hora : padrao.cadenciaPadrao.hora;
  const tetoBruto = Number(bruto.tetoPublico);
  const tetoPublico = Number.isFinite(tetoBruto) && tetoBruto > 0
    ? Math.min(100_000, Math.round(tetoBruto)) : null;
  const imagemUrl = typeof bruto.imagemUrl === 'string' && bruto.imagemUrl.trim()
    ? bruto.imagemUrl.trim() : null;

  await pool.query(
    `INSERT INTO public.fidelidade_campanhas
       (client_id, modelo, params, mensagens, imagem_url, dias_semana, hora, teto_publico, ativa)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, false)
     ON CONFLICT (client_id, modelo) DO UPDATE SET
       params = EXCLUDED.params, mensagens = EXCLUDED.mensagens,
       imagem_url = EXCLUDED.imagem_url, dias_semana = EXCLUDED.dias_semana,
       hora = EXCLUDED.hora, teto_publico = EXCLUDED.teto_publico,
       atualizado_em = NOW()`,
    [clientId, modelo, JSON.stringify(params), JSON.stringify(mensagens),
      imagemUrl, dias.join(','), hora, tetoPublico],
  );

  return {
    modelo, params, mensagens, imagemUrl, diasSemana: dias, hora, tetoPublico,
    ativa: false, salva: true,
  };
}

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
