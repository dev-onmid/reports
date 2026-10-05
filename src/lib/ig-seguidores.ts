import type { Pool } from 'pg';

/**
 * Ganho de seguidores do Instagram por DIA — série própria, gravada no banco.
 *
 * Por que existe: a Meta só entrega `follower_count` dos ÚLTIMOS 30 DIAS (sem o
 * dia corrente). Um relatório de setembro gerado em 05/10 pedia 01–30/09, a API
 * recusava o bloco inteiro com 400 e o card de seguidores somava só o que
 * sobrava (2 dias) chamando de "no período" — número errado, e errado para
 * menos, justo no relatório que vai para o cliente.
 *
 * A saída é guardar cada dia enquanto a Meta ainda entrega: o monitor de redes
 * (cron diário) e o próprio relatório gravam aqui, e a leitura do período sai do
 * banco. O que já passou dos 30 dias ANTES de esta tabela existir não volta.
 *
 * ⚠️ `dia` é a data (UTC) do `end_time` que a Graph devolve em cada valor — a
 * mesma régua que a soma por `since/until` sempre usou. Não é dia em BRT.
 */

export type DiaSeguidores = { dia: string; ganho: number };

/** Quantos dias a Graph aceita para trás (sem o dia corrente). Medido em 05/10/2026. */
export const JANELA_API_DIAS = 30;
const DIA_S = 86_400;

let schemaOk: Promise<void> | null = null;
export function ensureIgSeguidoresSchema(pool: Pool): Promise<void> {
  if (!schemaOk) {
    schemaOk = pool.query(`
      CREATE TABLE IF NOT EXISTS public.ig_seguidores_dia (
        ig_id         TEXT        NOT NULL,
        dia           DATE        NOT NULL,
        ganho         INT         NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ig_id, dia)
      )
    `).then(() => undefined, (e) => { schemaOk = null; throw e; });
  }
  return schemaOk;
}

/** 'YYYY-MM-DD' (UTC) de um instante. */
function diaUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Lê da Graph tudo o que ela ainda entrega: os últimos 30 dias completos.
 * `null` = a chamada falhou (≠ lista vazia, que é "sem valores").
 *
 * ⚠️ `until` é o fim de ONTEM (UTC): o dia corrente vem incompleto e gravá-lo
 * congelaria um parcial. E `since..until` tem de caber em 30 dias exatos — um
 * segundo a mais e a API responde 400.
 */
export async function buscarSerieSeguidores(
  igId: string,
  token: string,
  agora: number = Date.now(),
  base = 'https://graph.facebook.com/v21.0',
): Promise<DiaSeguidores[] | null> {
  const meiaNoite = Math.floor(agora / 1000 / DIA_S) * DIA_S;
  // 30 dias; se a Meta recusar (o "dia corrente" dela é em outro fuso), tenta 29.
  for (const dias of [JANELA_API_DIAS, JANELA_API_DIAS - 1]) {
    try {
      const url = new URL(`${base}/${igId}/insights`);
      url.searchParams.set('metric', 'follower_count');
      url.searchParams.set('period', 'day');
      url.searchParams.set('since', String(meiaNoite - dias * DIA_S));
      url.searchParams.set('until', String(meiaNoite - 1));
      url.searchParams.set('access_token', token);
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json() as { data?: Array<{ name?: string; values?: Array<{ value?: number; end_time?: string }> }> };
      const valores = data.data?.find(m => m.name === 'follower_count')?.values ?? data.data?.[0]?.values;
      if (!valores) return null;
      return serieDaResposta(valores);
    } catch { /* tenta a janela menor */ }
  }
  return null;
}

/** Normaliza os `values` da Graph: um por dia, sem data inválida. */
export function serieDaResposta(valores: Array<{ value?: number; end_time?: string }>): DiaSeguidores[] {
  const porDia = new Map<string, number>();
  for (const v of valores) {
    const t = v.end_time ? Date.parse(v.end_time) : NaN;
    if (!Number.isFinite(t) || typeof v.value !== 'number') continue;
    porDia.set(diaUtc(t), v.value);
  }
  return [...porDia].map(([dia, ganho]) => ({ dia, ganho })).sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Grava a série (idempotente). Nunca lança: guardar histórico não pode derrubar quem chamou. */
export async function registrarSerieSeguidores(pool: Pool, igId: string, serie: DiaSeguidores[] | null | undefined): Promise<void> {
  if (!igId || !serie?.length) return;
  try {
    await ensureIgSeguidoresSchema(pool);
    await pool.query(
      `INSERT INTO public.ig_seguidores_dia (ig_id, dia, ganho)
       SELECT $1, d::date, g FROM unnest($2::text[], $3::int[]) AS t(d, g)
       ON CONFLICT (ig_id, dia) DO UPDATE SET ganho = EXCLUDED.ganho, atualizado_em = NOW()`,
      [igId, serie.map(s => s.dia), serie.map(s => Math.round(s.ganho))],
    );
  } catch (e) {
    console.error('[ig-seguidores] gravar', e);
  }
}

/** Dias já gravados dentro de [from, to]. Banco/tabela indisponível → lista vazia. */
export async function lerSerieSeguidores(pool: Pool, igId: string, from: string, to: string): Promise<DiaSeguidores[]> {
  try {
    await ensureIgSeguidoresSchema(pool);
    const { rows } = await pool.query(
      `SELECT dia::text AS dia, ganho FROM public.ig_seguidores_dia WHERE ig_id = $1 AND dia BETWEEN $2 AND $3`,
      [igId, from, to],
    );
    return rows.map(r => ({ dia: String(r.dia).slice(0, 10), ganho: Number(r.ganho) || 0 }));
  } catch (e) {
    console.error('[ig-seguidores] ler', e);
    return [];
  }
}

export type GanhoSeguidores = {
  /** Soma dos dias que TEMOS dentro do período. */
  ganho: number;
  /** Quantos dias do período têm dado. */
  dias: number;
  /** Quantos dias o período tem até ontem (o dia corrente nunca conta). */
  esperados: number;
  /** Primeiro dia com dado ('YYYY-MM-DD'), ou null sem dado nenhum. */
  desde: string | null;
  /** Temos todos os dias esperados — só aí o número é "do período". */
  completo: boolean;
};

/**
 * Ganho no período a partir de uma ou mais séries (banco + API; a última vence
 * no mesmo dia). PURA: recebe `agora` para o teste não depender do relógio.
 */
export function ganhoNoPeriodo(from: string, to: string, series: DiaSeguidores[][], agora: number = Date.now()): GanhoSeguidores {
  const ontem = diaUtc(agora - DIA_S * 1000);
  const fim = to < ontem ? to : ontem;
  const esperados = fim < from ? 0 : Math.round((Date.parse(fim + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / (DIA_S * 1000)) + 1;
  const porDia = new Map<string, number>();
  for (const serie of series) for (const s of serie) if (s.dia >= from && s.dia <= fim) porDia.set(s.dia, s.ganho);
  const dias = porDia.size;
  let ganho = 0;
  for (const g of porDia.values()) ganho += g;
  const desde = dias ? [...porDia.keys()].sort()[0] : null;
  return { ganho, dias, esperados, desde, completo: esperados > 0 && dias >= esperados };
}
