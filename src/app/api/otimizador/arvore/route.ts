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

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  const lookbackHours = Math.min(Math.max(Number(req.nextUrl.searchParams.get('hours') ?? 200), 1), 336);
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  // Filtro de canal — conta MISTA (Meta + Google) tem 2 análises separadas (uma por
  // conta_plataforma). Sem `canal`, pega a mais recente de qualquer canal (comportamento antigo).
  // 'meta' = qualquer coisa que NÃO seja google_ads (logs antigos vêm null e são Meta).
  const canalParam = (req.nextUrl.searchParams.get('canal') ?? '').toLowerCase();
  const canalFilter = canalParam === 'google'
    ? `AND conta_plataforma = 'google_ads'`
    : canalParam === 'meta'
      ? `AND conta_plataforma IS DISTINCT FROM 'google_ads'`
      : '';

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);

    const { rows } = await pool.query<LogRow>(
      `SELECT id, cliente_nome, conta_plataforma, connection_id, account_id, resultado,
              semana_analise, modo_operacao, estado_da_conta, resumo_executivo, created_at
         FROM public.optimizer_ai_logs
        WHERE cliente_id = $1
          AND solicitacao = 'analise_semanal'
          AND resultado IS NOT NULL
          AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')
          ${canalFilter}
        ORDER BY created_at DESC
        LIMIT 1`,
      [clientId, lookbackHours],
    );

    // Canais com análise recente — a UI só mostra o toggle Meta/Google quando há os dois.
    const { rows: canalRows } = await pool.query<{ conta_plataforma: string | null }>(
      `SELECT DISTINCT conta_plataforma
         FROM public.optimizer_ai_logs
        WHERE cliente_id = $1
          AND solicitacao = 'analise_semanal'
          AND resultado IS NOT NULL
          AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
      [clientId, lookbackHours],
    );
    const canais = Array.from(new Set(canalRows.map((r) => (r.conta_plataforma === 'google_ads' ? 'google' : 'meta'))));

    const log = rows[0];
    if (!log) {
      return Response.json({ campanhas: [], resumo: null, generated_at: null, canal: canalParam || null, canais });
    }

    const canal: 'meta' | 'google' = log.conta_plataforma === 'google_ads' ? 'google' : 'meta';
    const tree = buildCampaignTree(log.resultado, {
      analise_id: log.id,
      cliente_id: clientId,
      cliente_nome: log.cliente_nome ?? clientId,
      canal,
      connection_id: log.connection_id,
      account_id: log.account_id,
    });

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
    const annotated = annotate(tree);

    const counts = countNodes(tree);

    return Response.json({
      campanhas: annotated,
      resumo: {
        estado_da_conta: log.estado_da_conta,
        resumo_executivo: log.resumo_executivo,
        semana_analise: log.semana_analise,
        modo_operacao: log.modo_operacao,
        cruzamento_com_metas: log.resultado.cruzamento_com_metas,
        ...counts,
      },
      generated_at: log.created_at,
      canal,
      canais,
    });
  } finally {
    await pool.end();
  }
}
