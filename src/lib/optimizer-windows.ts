// Panorama multi-janela do Otimizador (30/14/7/3 dias) — lógica PURA, testável via esbuild.
//
// Motivação (pedido do Matheus, 2026-07-18): analisar uma janela única "emburrece" a decisão —
// a IA pausa campanha que teve turbulência de 7 dias mas performou o mês inteiro, ou deixa de
// perceber que uma campanha ruim há 30 dias voltou a performar nos últimos 3. Toda análise passa
// a enviar o MESMO objeto medido em 4 janelas terminando ontem, e a IA raciocina sobre a
// trajetória (PASSO 3.6 do prompt). A janela primária (?period=) continua nos campos de topo.
//
// Este arquivo NÃO é importado por optimizer.ts (sem ciclo) — quem monta payload (weekly) usa.

import type { OptimizerJanelas, OptimizerTendencia, OptimizerWindowKey, OptimizerWindowMetrics } from '@/lib/optimizer';
import { optimizerDateRangeForDays } from '@/lib/optimizer-period-range';
import { countMetaResults } from '@/lib/meta-results';

export const OPTIMIZER_WINDOW_DAYS: Record<OptimizerWindowKey, number> = {
  d30: 30,
  d14: 14,
  d7: 7,
  d3: 3,
};

export const OPTIMIZER_WINDOW_KEYS = Object.keys(OPTIMIZER_WINDOW_DAYS) as OptimizerWindowKey[];

// Janela com gasto abaixo disso é AUSÊNCIA de dado, não performance — nunca sustenta conclusão.
export const JANELA_GASTO_MINIMO = 1;

export type OptimizerWindowRanges = Record<OptimizerWindowKey, { dateFrom: string; dateTo: string }>;

// As 4 janelas do panorama, todas terminando ONTEM (hoje não fechou), fuso America/Sao_Paulo —
// mesma convenção de optimizerDateRangeForDays usada pela janela primária.
export function optimizerMultiWindowRanges(referenceDate = new Date()): OptimizerWindowRanges {
  const ranges = {} as OptimizerWindowRanges;
  for (const key of OPTIMIZER_WINDOW_KEYS) {
    ranges[key] = optimizerDateRangeForDays(OPTIMIZER_WINDOW_DAYS[key], referenceDate);
  }
  return ranges;
}

// Bloco janelas_referencia do payload (datas uma vez na raiz, não por nó).
export function janelasReferencia(ranges: OptimizerWindowRanges): Record<OptimizerWindowKey, { data_inicio: string; data_fim: string }> {
  const ref = {} as Record<OptimizerWindowKey, { data_inicio: string; data_fim: string }>;
  for (const key of OPTIMIZER_WINDOW_KEYS) {
    ref[key] = { data_inicio: ranges[key].dateFrom, data_fim: ranges[key].dateTo };
  }
  return ref;
}

const META_WINDOW_ALIAS_PREFIX = 'ins_';

// Fragmento de field expansion da Graph com ALIASING — 4 blocos nomeados na mesma chamada:
//   insights.time_range({"since":"...","until":"..."}).as(ins_d30){spend,impressions,clicks,actions,ctr},...
// Escolhido sobre time_ranges=[...] porque o parse por chave nomeada é inequívoco quando uma
// janela volta vazia (com time_ranges, a linha simplesmente some do data[] e desloca o parse).
export function buildMetaWindowFields(ranges: OptimizerWindowRanges): string {
  return OPTIMIZER_WINDOW_KEYS.map((key) => {
    const timeRange = JSON.stringify({ since: ranges[key].dateFrom, until: ranges[key].dateTo });
    return `insights.time_range(${timeRange}).as(${META_WINDOW_ALIAS_PREFIX}${key}){spend,impressions,clicks,actions,ctr}`;
  }).join(',');
}

type MetaInsightsEdge = { data?: Array<Record<string, unknown>> } | undefined;

// Lê os aliases ins_d30..ins_d3 de um nó cru da Graph. Alias presente com data vazia → janela
// zerada (objeto existia mas não entregou); alias AUSENTE (erro parcial) → janela omitida.
// Conversões via countMetaResults — NUNCA somar famílias de action_types (regra do projeto).
export function parseMetaWindowInsights(raw: Record<string, unknown>): OptimizerJanelas | undefined {
  const janelas: OptimizerJanelas = {};
  let algum = false;
  for (const key of OPTIMIZER_WINDOW_KEYS) {
    const edge = raw[`${META_WINDOW_ALIAS_PREFIX}${key}`] as MetaInsightsEdge;
    if (!edge || !Array.isArray(edge.data)) continue;
    algum = true;
    const row = edge.data[0] ?? {};
    const gasto = Number(row.spend ?? 0);
    const impressoes = Number(row.impressions ?? 0);
    const cliques = Number(row.clicks ?? 0);
    const conversoes = countMetaResults(row.actions as Array<{ action_type: string; value: string }> | undefined);
    const ctrRaw = Number(row.ctr ?? NaN);
    janelas[key] = {
      gasto,
      conversoes,
      cpl: gasto > 0 && conversoes > 0 ? gasto / conversoes : null,
      cliques,
      cpc: gasto > 0 && cliques > 0 ? gasto / cliques : null,
      ctr: Number.isFinite(ctrRaw) ? ctrRaw : (impressoes > 0 ? (cliques / impressoes) * 100 : null),
    };
  }
  return algum ? janelas : undefined;
}

export type GoogleDailyRow = {
  id: string;
  date: string; // YYYY-MM-DD
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

// Agrega linhas diárias GAQL (segments.date no SELECT) nas 4 janelas, por id do objeto.
// Bordas inclusivas (mesma semântica do BETWEEN da query).
export function aggregateGoogleDailyRows(rows: GoogleDailyRow[], ranges: OptimizerWindowRanges): Map<string, OptimizerJanelas> {
  type Acc = { gasto: number; impressoes: number; cliques: number; conversoes: number };
  const byId = new Map<string, Record<OptimizerWindowKey, Acc>>();

  for (const row of rows) {
    if (!row?.id || !row.date) continue;
    let acc = byId.get(row.id);
    if (!acc) {
      acc = {
        d30: { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0 },
        d14: { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0 },
        d7: { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0 },
        d3: { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0 },
      };
      byId.set(row.id, acc);
    }
    for (const key of OPTIMIZER_WINDOW_KEYS) {
      const { dateFrom, dateTo } = ranges[key];
      if (row.date < dateFrom || row.date > dateTo) continue;
      const w = acc[key];
      w.gasto += row.costMicros / 1_000_000;
      w.impressoes += row.impressions;
      w.cliques += row.clicks;
      w.conversoes += row.conversions;
    }
  }

  const result = new Map<string, OptimizerJanelas>();
  for (const [id, acc] of byId) {
    const janelas: OptimizerJanelas = {};
    for (const key of OPTIMIZER_WINDOW_KEYS) {
      const w = acc[key];
      const conversoes = Math.round(w.conversoes);
      janelas[key] = {
        gasto: w.gasto,
        conversoes,
        cpl: w.gasto > 0 && conversoes > 0 ? w.gasto / conversoes : null,
        cliques: w.cliques,
        cpc: w.gasto > 0 && w.cliques > 0 ? w.gasto / w.cliques : null,
        ctr: w.impressoes > 0 ? (w.cliques / w.impressoes) * 100 : null,
      };
    }
    result.set(id, janelas);
  }
  return result;
}

// Regra Cão Véio DENTRO das janelas: nó de TRÁFEGO mede-se por clique — o cpl de cada janela
// sai de conversas incidentais e vira número sem sentido. Zera o cpl e garante o cpc.
export function janelasComMetricaDeClique(janelas: OptimizerJanelas | null | undefined): OptimizerJanelas | undefined {
  if (!janelas) return undefined;
  const out: OptimizerJanelas = {};
  for (const key of OPTIMIZER_WINDOW_KEYS) {
    const w = janelas[key];
    if (!w) continue;
    out[key] = {
      ...w,
      cpl: null,
      cpc: w.gasto > 0 && w.cliques > 0 ? w.gasto / w.cliques : null,
    };
  }
  return out;
}

function janelaValida(w: OptimizerWindowMetrics | undefined): w is OptimizerWindowMetrics {
  return !!w && w.gasto >= JANELA_GASTO_MINIMO;
}

// Tendência determinística: compara o custo por resultado de d3 contra d30, no eixo de medição
// do objetivo (cpc pra tráfego, cpl pros demais). Calculada em código pra ancorar a IA — o
// prompt exige que qualquer divergência cite as janelas.
export function calcularTendencia(
  janelas: OptimizerJanelas | null | undefined,
  usaCpc: boolean,
): OptimizerTendencia | null {
  if (!janelas) return null; // nó sem panorama não ganha tendência inventada
  const d30 = janelas.d30;
  const d3 = janelas.d3;
  if (!janelaValida(d30) || !janelaValida(d3)) return 'DADO_INSUFICIENTE';

  const custo = (w: OptimizerWindowMetrics) => (usaCpc ? w.cpc : w.cpl);
  const custo30 = custo(d30);
  const custo3 = custo(d3);

  if (custo30 != null && custo3 != null) {
    if (custo3 <= custo30 * 0.7) return 'RECUPERANDO';
    if (custo3 >= custo30 * 1.3) return 'PIORANDO';
    return 'ESTAVEL';
  }
  // custo null = janela sem resultado (gasto sem conversão/clique no eixo medido).
  if (custo30 != null && custo3 == null) {
    // Só condena se d3 já gastou o suficiente pra ter produzido ao menos ~2 resultados no
    // ritmo de d30 — gasto baixo sem resultado ainda é ruído, não queda.
    return d3.gasto >= custo30 * 2 ? 'PIORANDO' : 'DADO_INSUFICIENTE';
  }
  if (custo30 == null && custo3 != null) return 'RECUPERANDO';
  return 'DADO_INSUFICIENTE';
}
