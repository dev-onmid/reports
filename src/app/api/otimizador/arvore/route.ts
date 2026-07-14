import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  buildCampaignTree,
  ensureOptimizerRecStatusTable,
  type OptimizerOutputV2,
  type OptimizerTreeNode,
} from '@/lib/optimizer';

// Árvore completa (campanha→conjunto→criativo) de UM cliente, para a visão nova do Otimizador.
// Diferente de /fila (achatada, cross-cliente, só itens com ação), esta rota devolve TODOS os
// nós — inclusive "saudável sem ação" — pra tela mostrar o que manter, não só o que corrigir.
//
// Conta MISTA (Meta + Google): cada canal tem sua própria análise semanal, gerada e armazenada
// separadamente. Sem `?canal=`, a rota busca a análise mais recente de CADA canal disponível e
// devolve tudo junto (cada nó já vem com `canal: 'meta'|'google'` de buildRecomendacoes) — a UI
// agrupa por canal em vez de precisar de um toggle pra trocar de visão.

export const dynamic = 'force-dynamic';

type LogRow = {
  id: string;
  cliente_nome: string | null;
  conta_plataforma: string | null;
  connection_id: string | null;
  account_id: string | null;
  resultado: OptimizerOutputV2;
  semana_analise: string | null;
  modo_operacao: string | null;
  estado_da_conta: string | null;
  resumo_executivo: string | null;
  created_at: string;
};

type StatusRow = { rec_id: string; status: string; atribuido_a: string | null };

function countNodes(nodes: OptimizerTreeNode[]) {
  let campanhas = 0, conjuntos = 0, criativos = 0, diagnosticos = 0;
  for (const n of nodes) {
    if (n.nivel === 'campaign') campanhas++;
    if (n.nivel === 'adset') conjuntos++;
    if (n.nivel === 'ad') criativos++;
    if (n.texto_recomendacao?.trim()) diagnosticos++;
    const child = countNodes(n.filhos);
    campanhas += child.campanhas; conjuntos += child.conjuntos; criativos += child.criativos; diagnosticos += child.diagnosticos;
  }
  return { campanhas, conjuntos, criativos, diagnosticos };
}

// Ranking de gravidade — usado pra escolher qual canal "lidera" o resumo executivo/estado da
// conta quando dois canais são combinados (não dá pra fundir duas narrativas de IA em uma só).
const ESTADO_RANK: Record<string, number> = { CRISE: 0, ATENCAO: 1, SAUDAVEL: 2 };

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  const lookbackHours = Math.min(Math.max(Number(req.nextUrl.searchParams.get('hours') ?? 200), 1), 336);
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  // `?canal=` explícito ainda é suportado (uso interno/depuração) — sem ele, busca os dois.
  const canalParam = (req.nextUrl.searchParams.get('canal') ?? '').toLowerCase();

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);

    // Canais com análise recente — decide se busca 1 ou os 2.
    const { rows: canalRows } = await pool.query<{ conta_plataforma: string | null }>(
      `SELECT DISTINCT conta_plataforma
         FROM public.optimizer_ai_logs
        WHERE cliente_id = $1
          AND solicitacao = 'analise_semanal'
          AND resultado IS NOT NULL
          AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
      [clientId, lookbackHours],
    );
    const canaisDisponiveis = Array.from(new Set(canalRows.map((r) => (r.conta_plataforma === 'google_ads' ? 'google' : 'meta')))) as Array<'meta' | 'google'>;

    const canaisParaBuscar: Array<'meta' | 'google'> = canalParam === 'google' || canalParam === 'meta'
      ? [canalParam]
      : canaisDisponiveis;

    if (canaisParaBuscar.length === 0) {
      return Response.json({ campanhas: [], resumo: null, generated_at: null, canais: canaisDisponiveis });
    }

    const logsPorCanal = await Promise.all(canaisParaBuscar.map(async (canal) => {
      const filtro = canal === 'google' ? `AND conta_plataforma = 'google_ads'` : `AND conta_plataforma IS DISTINCT FROM 'google_ads'`;
      const { rows } = await pool.query<LogRow>(
        `SELECT id, cliente_nome, conta_plataforma, connection_id, account_id, resultado,
                semana_analise, modo_operacao, estado_da_conta, resumo_executivo, created_at
           FROM public.optimizer_ai_logs
          WHERE cliente_id = $1
            AND solicitacao = 'analise_semanal'
            AND resultado IS NOT NULL
            AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')
            ${filtro}
          ORDER BY created_at DESC
          LIMIT 1`,
        [clientId, lookbackHours],
      );
      return rows[0] ? { canal, log: rows[0] } : null;
    }));
    const validLogs = logsPorCanal.filter((x): x is { canal: 'meta' | 'google'; log: LogRow } => x !== null);

    if (validLogs.length === 0) {
      return Response.json({ campanhas: [], resumo: null, generated_at: null, canais: canaisDisponiveis });
    }

    // Cruza com o workflow persistido (mesmo padrão de /fila).
    const { rows: statusRows } = await pool.query<StatusRow>(
      `SELECT rec_id, status, atribuido_a FROM public.optimizer_recomendacao_status WHERE cliente_id = $1`,
      [clientId],
    );
    const statusByRec = new Map<string, StatusRow>();
    for (const s of statusRows) statusByRec.set(s.rec_id, s);
    function annotate(nodes: OptimizerTreeNode[]): Array<OptimizerTreeNode & { status: string; atribuido_a: string | null }> {
      return nodes.map((n) => {
        const st = statusByRec.get(n.rec_id);
        return { ...n, status: st?.status ?? 'pendente', atribuido_a: st?.atribuido_a ?? null, filhos: annotate(n.filhos) as OptimizerTreeNode[] };
      });
    }

    // Monta a árvore de cada canal e junta tudo — cada nó já sai com `canal` marcado.
    const arvorePorCanal = validLogs.map(({ canal, log }) => {
      const tree = buildCampaignTree(log.resultado, {
        analise_id: log.id,
        cliente_id: clientId,
        cliente_nome: log.cliente_nome ?? clientId,
        canal,
        connection_id: log.connection_id,
        account_id: log.account_id,
      });
      return { canal, log, tree: annotate(tree) };
    });

    const campanhas = arvorePorCanal.flatMap((c) => c.tree);
    const counts = countNodes(arvorePorCanal.flatMap((c) => c.tree));

    // Resumo executivo: narrativa não dá pra fundir — usa a do canal em pior estado (CRISE
    // primeiro). Números (gasto/resultado/orçamento) são somados — spend real é aditivo entre canais.
    const principal = [...arvorePorCanal].sort((a, b) =>
      (ESTADO_RANK[a.log.estado_da_conta ?? ''] ?? 3) - (ESTADO_RANK[b.log.estado_da_conta ?? ''] ?? 3))[0];
    const cmSum = arvorePorCanal.reduce((acc, c) => {
      const cm = c.log.resultado.cruzamento_com_metas;
      return {
        gasto_total: acc.gasto_total + (cm?.gasto_total ?? 0),
        volume_conversoes_atual: acc.volume_conversoes_atual + (cm?.volume_conversoes_atual ?? 0),
        orcamento_periodo: (acc.orcamento_periodo ?? 0) + (cm?.orcamento_periodo ?? 0),
      };
    }, { gasto_total: 0, volume_conversoes_atual: 0, orcamento_periodo: 0 as number | null });
    const generatedAt = arvorePorCanal.reduce((max, c) => (new Date(c.log.created_at) > new Date(max) ? c.log.created_at : max), arvorePorCanal[0].log.created_at);

    return Response.json({
      campanhas,
      resumo: {
        estado_da_conta: principal.log.estado_da_conta,
        resumo_executivo: arvorePorCanal.length > 1
          ? `${principal.log.resumo_executivo ?? ''} ${principal.canal === 'meta' ? '(Meta)' : '(Google)'} · também há análise de ${principal.canal === 'meta' ? 'Google' : 'Meta'} nesta conta.`
          : principal.log.resumo_executivo,
        semana_analise: principal.log.semana_analise,
        modo_operacao: principal.log.modo_operacao,
        cruzamento_com_metas: {
          ...principal.log.resultado.cruzamento_com_metas,
          gasto_total: cmSum.gasto_total,
          volume_conversoes_atual: cmSum.volume_conversoes_atual,
          orcamento_periodo: cmSum.orcamento_periodo,
          // cpl_atual recalculado sobre o total combinado (média simples do valor por nó não faz
          // sentido aqui — refaz a partir do gasto e resultado somados).
          cpl_atual: cmSum.volume_conversoes_atual > 0 ? cmSum.gasto_total / cmSum.volume_conversoes_atual : null,
        },
        ...counts,
      },
      generated_at: generatedAt,
      canais: canaisDisponiveis,
    });
  } finally {
    await pool.end();
  }
}
