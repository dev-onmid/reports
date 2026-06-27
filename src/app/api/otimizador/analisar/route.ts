import { createHash, randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { calcCostUsd } from '@/lib/ai-usage-config';
import { logAiUsage } from '@/lib/ai-usage-logger';
import { makeServerPool } from '@/lib/server-db';
import {
  OPTIMIZER_MODEL,
  OPTIMIZER_PROMPT_VERSION,
  OPTIMIZER_PROMPT_VERSION_V2,
  applyLayerOneRules,
  buildFallbackDiagnosis,
  buildGreenDiagnosis,
  buildOptimizerSystemPrompt,
  buildOptimizerSystemPromptV2,
  estimateCriticalLevel,
  extractJsonObject,
  maxSnapshotDriftPercent,
  payloadNumericSnapshot,
  sanitizeOptimizerDiagnosis,
  sanitizeOptimizerOutputV2,
  currentWeekLabel,
  type OptimizerAnalysisResult,
  type OptimizerAnalysisResultV2,
  type OptimizerPayload,
  type OptimizerPayloadV2,
  type OptimizerRequestKind,
} from '@/lib/optimizer';
import { sendOptimizerReport } from '@/lib/optimizer-whatsapp';

type AnalyzeBody = {
  payload?: OptimizerPayload;
  payload_v2?: OptimizerPayloadV2;
  connection_id?: string;
  force_ai?: boolean;
};

type ActionLogBody = {
  gestor_id: string;
  cliente_id: string;
  conjunto_id: string;
  recomendacao_id: string;
  decisao: 'aceito' | 'recusado' | 'manual';
  motivo_recusa?: 'nao_concordo' | 'ja_resolvi' | 'vou_fazer_depois' | 'outro';
  motivo_texto?: string;
  acao_executada?: string;
  resultado_da_acao?: 'pendente' | 'sucesso' | 'erro';
};

type CacheRow = {
  id: string;
  payload_hash: string | null;
  resultado: OptimizerAnalysisResult;
  payload_snapshot: Record<string, number> | null;
};

type MemoryActionRow = {
  decisao: string;
  acao_executada: string | null;
  motivo_recusa: string | null;
  motivo_texto: string | null;
  resultado_da_acao: string | null;
  created_at: string;
};

type MemoryAnalysisRow = {
  nivel_critico: string | null;
  resultado: OptimizerAnalysisResult | null;
  created_at: string;
};

function currentDataEvidence(payload: OptimizerPayload, actionText: string | null, resultStatus: string | null): string {
  const action = (actionText ?? '').toLowerCase();
  const account = payload.dados_da_conta;
  const metrics = account.metricas_periodo;
  const currentStatus = account.status || 'indisponivel';
  const isPaused = /paused|pause|pausad|inactive|inativo|archived/i.test(currentStatus);
  const isActive = /active|enabled|ativo/i.test(currentStatus);
  const cpl = metrics.cpl_cpa_atual == null ? 'indisponivel' : `R$ ${metrics.cpl_cpa_atual.toFixed(2)}`;
  const conversions = metrics.conversoes;
  const spend = metrics.gasto_total;

  if (!actionText) return `sem acao registrada para confirmar; status_atual=${currentStatus}, gasto=${spend}, conversoes=${conversions}, cpl=${cpl}`;

  if (action.includes('pausar') || action.includes('pause')) {
    if (isPaused) return `CONFIRMADA pelos dados: status atual esta pausado/inativo (${currentStatus}).`;
    if (isActive) return `NAO CONFIRMADA pelos dados: acao registrada fala em pausar, mas status atual continua ativo (${currentStatus}). Nao trate como executada.`;
    return `INCONCLUSIVA pelos dados: acao registrada fala em pausar, status atual=${currentStatus}.`;
  }

  if (action.includes('aumentar') || action.includes('reduzir') || action.includes('orcamento') || action.includes('orçamento')) {
    const budget = payload.metas_do_cliente.orcamento_diario;
    const rhythm = metrics.ritmo_gasto_percentual;
    return `INCONCLUSIVA pelos dados: acao envolve orcamento. Orcamento diario atual=${budget ?? 'indisponivel'}, ritmo_gasto=${rhythm ?? 'indisponivel'}%. So considere feita se houver resultado_da_acao=sucesso e as metricas atuais fizerem sentido.`;
  }

  if (action.includes('criativo') || action.includes('briefing')) {
    return `INCONCLUSIVA pelos dados: acao envolve criativo/briefing e nao da para confirmar so por metricas agregadas. Se resultado_da_acao=${resultStatus ?? 'pendente'}, trate como nao comprovada ate haver sinal de criativo novo ou melhora de metricas.`;
  }

  return `VERIFICACAO GERAL: status_atual=${currentStatus}, gasto=${spend}, conversoes=${conversions}, cpl=${cpl}. Nao assuma execucao se os dados atuais nao confirmarem.`;
}

type QueueRow = {
  id: string;
  cliente_id: string;
  cliente_nome: string | null;
  conjunto_id: string;
  campanha_nome: string | null;
  conta_plataforma: string | null;
  periodo_label: string | null;
  periodo_dias: number | null;
  origem: OptimizerAnalysisResult['origem'];
  nivel_critico: OptimizerAnalysisResult['nivel_critico'];
  gasto_total: string | number | null;
  conversoes: string | number | null;
  cpl_cpa_atual: string | number | null;
  ctr_link: string | number | null;
  resultado: OptimizerAnalysisResult;
  semana_analise: string | null;
  modo_operacao: string | null;
  estado_da_conta: string | null;
  resumo_executivo: string | null;
  created_at: string;
};

const MAX_DAILY_AI_CALLS_PER_CLIENT = 10;

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_ai_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id TEXT NOT NULL,
      conjunto_id TEXT NOT NULL,
      solicitacao TEXT NOT NULL,
      origem TEXT NOT NULL,
      nivel_critico TEXT,
      cliente_nome TEXT,
      campanha_nome TEXT,
      conta_plataforma TEXT,
      periodo_label TEXT,
      periodo_dias INTEGER,
      gasto_total NUMERIC,
      conversoes NUMERIC,
      cpl_cpa_atual NUMERIC,
      ctr_link NUMERIC,
      payload_hash TEXT,
      payload_snapshot JSONB,
      resultado JSONB,
      prompt_version TEXT,
      modelo_usado TEXT,
      tokens_usados INTEGER NOT NULL DEFAULT 0,
      custo_estimado_usd NUMERIC(12,8) NOT NULL DEFAULT 0,
      erro TEXT,
      resultado_aceito BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS optimizer_ai_logs_lookup_idx
      ON public.optimizer_ai_logs (cliente_id, conjunto_id, solicitacao, created_at DESC);
    CREATE INDEX IF NOT EXISTS optimizer_ai_logs_daily_queue_idx
      ON public.optimizer_ai_logs (created_at DESC, nivel_critico, cliente_id);

    CREATE TABLE IF NOT EXISTS public.optimizer_action_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      gestor_id TEXT NOT NULL,
      cliente_id TEXT NOT NULL,
      conjunto_id TEXT NOT NULL,
      recomendacao_id TEXT NOT NULL,
      decisao TEXT NOT NULL,
      motivo_recusa TEXT,
      motivo_texto TEXT,
      acao_executada TEXT,
      resultado_da_acao TEXT NOT NULL DEFAULT 'pendente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS optimizer_action_logs_lookup_idx
      ON public.optimizer_action_logs (cliente_id, conjunto_id, created_at DESC);
  `);

  await pool.query(`
    ALTER TABLE public.optimizer_ai_logs
      ADD COLUMN IF NOT EXISTS cliente_nome TEXT,
      ADD COLUMN IF NOT EXISTS campanha_nome TEXT,
      ADD COLUMN IF NOT EXISTS conta_plataforma TEXT,
      ADD COLUMN IF NOT EXISTS periodo_label TEXT,
      ADD COLUMN IF NOT EXISTS periodo_dias INTEGER,
      ADD COLUMN IF NOT EXISTS gasto_total NUMERIC,
      ADD COLUMN IF NOT EXISTS conversoes NUMERIC,
      ADD COLUMN IF NOT EXISTS cpl_cpa_atual NUMERIC,
      ADD COLUMN IF NOT EXISTS ctr_link NUMERIC
  `).catch(() => {});
}

function hashPayload(payload: OptimizerPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function withMeta(
  diagnosis: Omit<OptimizerAnalysisResult, 'recomendacao_id' | 'prompt_version'> & Partial<Pick<OptimizerAnalysisResult, 'recomendacao_id' | 'prompt_version'>>,
): OptimizerAnalysisResult {
  return {
    ...diagnosis,
    recomendacao_id: diagnosis.recomendacao_id ?? randomUUID(),
    prompt_version: diagnosis.prompt_version ?? OPTIMIZER_PROMPT_VERSION,
  };
}

async function saveLog(params: {
  payload: OptimizerPayload;
  result: OptimizerAnalysisResult;
  payloadHash: string;
  snapshot: Record<string, number>;
  error?: string;
}) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    await pool.query(
      `INSERT INTO public.optimizer_ai_logs
        (cliente_id, conjunto_id, solicitacao, origem, nivel_critico,
         cliente_nome, campanha_nome, conta_plataforma, periodo_label, periodo_dias,
         gasto_total, conversoes, cpl_cpa_atual, ctr_link,
         payload_hash, payload_snapshot,
         resultado, prompt_version, modelo_usado, tokens_usados, custo_estimado_usd, erro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        params.payload.cliente_id,
        params.payload.dados_da_conta.conjunto_id,
        params.payload.contexto_adicional.solicitacao,
        params.result.origem,
        params.result.nivel_critico,
        params.payload.cliente_nome,
        params.payload.dados_da_conta.campanha_nome,
        params.payload.conta_plataforma,
        params.payload.contexto_adicional.janela_analise ?? null,
        params.payload.metas_do_cliente.periodo_analise_dias,
        params.payload.dados_da_conta.metricas_periodo.gasto_total,
        params.payload.dados_da_conta.metricas_periodo.conversoes,
        params.payload.dados_da_conta.metricas_periodo.cpl_cpa_atual,
        params.payload.dados_da_conta.metricas_periodo.ctr_link,
        params.payloadHash,
        JSON.stringify(params.snapshot),
        JSON.stringify(params.result),
        params.result.prompt_version,
        params.result.modelo_usado,
        params.result.tokens_usados,
        params.result.custo_estimado_usd,
        params.error ?? null,
      ],
    );
  } catch (error) {
    console.error('[otimizador][saveLog]', error);
  } finally {
    await pool.end();
  }
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  const level = req.nextUrl.searchParams.get('level') ?? '';
  const lookbackHours = Math.min(Math.max(Number(req.nextUrl.searchParams.get('hours') ?? 36), 1), 168);

  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const params: unknown[] = [lookbackHours];
    const filters = [
      `created_at >= NOW() - ($1::int * INTERVAL '1 hour')`,
      `solicitacao IN ('analise_completa', 'analise_semanal')`,
      `resultado IS NOT NULL`,
    ];
    if (clientId) {
      params.push(clientId);
      filters.push(`cliente_id = $${params.length}`);
    }
    if (['vermelho', 'amarelo', 'verde'].includes(level)) {
      params.push(level);
      filters.push(`nivel_critico = $${params.length}`);
    }

    const { rows } = await pool.query<QueueRow>(
      `SELECT DISTINCT ON (cliente_id, conjunto_id, COALESCE(periodo_label, periodo_dias::text))
          id, cliente_id, cliente_nome, conjunto_id, campanha_nome, conta_plataforma,
          periodo_label, periodo_dias, origem, nivel_critico, gasto_total, conversoes,
          cpl_cpa_atual, ctr_link, resultado,
          semana_analise, modo_operacao, estado_da_conta, resumo_executivo,
          created_at
         FROM public.optimizer_ai_logs
        WHERE ${filters.join(' AND ')}
        ORDER BY cliente_id, conjunto_id, COALESCE(periodo_label, periodo_dias::text),
          created_at DESC`,
      params,
    );

    const levelOrder = { vermelho: 0, amarelo: 1, verde: 2 } as const;
    const items = rows
      .map((row) => ({
        id: row.id,
        cliente_id: row.cliente_id,
        cliente_nome: row.cliente_nome ?? row.resultado.cliente_id,
        conjunto_id: row.conjunto_id,
        campanha_nome: row.campanha_nome ?? row.resultado.conjunto_id,
        conta_plataforma: row.conta_plataforma ?? 'meta_ads',
        periodo_label: row.periodo_label ?? `${row.periodo_dias ?? '?'} dias`,
        periodo_dias: row.periodo_dias ?? 0,
        origem: row.origem,
        nivel_critico: row.nivel_critico,
        gasto_total: Number(row.gasto_total ?? 0),
        conversoes: Number(row.conversoes ?? 0),
        cpl_cpa_atual: row.cpl_cpa_atual == null ? null : Number(row.cpl_cpa_atual),
        ctr_link: row.ctr_link == null ? null : Number(row.ctr_link),
        resultado: row.resultado,
        semana_analise: row.semana_analise ?? null,
        modo_operacao: row.modo_operacao ?? null,
        estado_da_conta: row.estado_da_conta ?? null,
        resumo_executivo: row.resumo_executivo ?? null,
        created_at: row.created_at,
      }))
      .sort((a, b) => {
        const levelDiff = levelOrder[a.nivel_critico] - levelOrder[b.nivel_critico];
        if (levelDiff !== 0) return levelDiff;
        return (b.gasto_total ?? 0) - (a.gasto_total ?? 0);
      });

    return Response.json({ items, generated_at: items[0]?.created_at ?? null });
  } finally {
    await pool.end();
  }
}

async function loadOptimizerMemory(payload: OptimizerPayload): Promise<string | null> {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const [actionsRes, analysesRes] = await Promise.all([
      pool.query<MemoryActionRow>(
        `SELECT decisao, motivo_recusa, motivo_texto, acao_executada, resultado_da_acao, created_at
           FROM public.optimizer_action_logs
          WHERE cliente_id = $1
            AND conjunto_id = $2
            AND created_at >= NOW() - INTERVAL '21 days'
          ORDER BY created_at DESC
          LIMIT 5`,
        [payload.cliente_id, payload.dados_da_conta.conjunto_id],
      ),
      pool.query<MemoryAnalysisRow>(
        `SELECT nivel_critico, resultado, created_at
           FROM public.optimizer_ai_logs
          WHERE cliente_id = $1
            AND conjunto_id = $2
            AND solicitacao = 'analise_completa'
            AND resultado IS NOT NULL
            AND created_at >= NOW() - INTERVAL '21 days'
          ORDER BY created_at DESC
          LIMIT 3`,
        [payload.cliente_id, payload.dados_da_conta.conjunto_id],
      ),
    ]);

    const lines: string[] = [];
    if (actionsRes.rows.length > 0) {
      lines.push('Historico recente de decisoes do gestor com verificacao nos dados atuais:');
      for (const row of actionsRes.rows) {
        const date = new Date(row.created_at).toISOString();
        const reason = row.motivo_recusa ? `, motivo_recusa=${row.motivo_recusa}` : '';
        const text = row.motivo_texto ? `, detalhe=${row.motivo_texto}` : '';
        const evidence = currentDataEvidence(payload, row.acao_executada, row.resultado_da_acao);
        lines.push(`- ${date}: decisao_declarada=${row.decisao}, acao_declarada=${row.acao_executada ?? 'nao informada'}, resultado_declarado=${row.resultado_da_acao ?? 'pendente'}${reason}${text}. Evidencia atual: ${evidence}`);
      }
    }
    if (analysesRes.rows.length > 0) {
      lines.push('Ultimas analises geradas para esta campanha:');
      for (const row of analysesRes.rows) {
        const date = new Date(row.created_at).toISOString();
        lines.push(`- ${date}: nivel=${row.nivel_critico ?? row.resultado?.nivel_critico ?? 'indefinido'}, problema=${row.resultado?.titulo_problema ?? 'sem titulo'}`);
      }
    }
    if (lines.length === 0) return null;
    lines.push('Regra importante: uma decisao registrada pelo gestor NAO prova execucao. So trate como executada se resultado_declarado=sucesso E os dados atuais forem coerentes. Se houver conflito entre declaracao e dados atuais, priorize os dados atuais e aponte a divergencia na observacao.');
    return lines.join('\n');
  } catch (error) {
    console.error('[otimizador][memory]', error);
    return null;
  } finally {
    await pool.end();
  }
}

function withMemoryContext(payload: OptimizerPayload, memory: string | null): OptimizerPayload {
  if (!memory) return payload;
  const previous = payload.contexto_adicional.observacao_do_gestor?.trim();
  return {
    ...payload,
    contexto_adicional: {
      ...payload.contexto_adicional,
      observacao_do_gestor: [previous, memory].filter(Boolean).join('\n\n'),
    },
  };
}

function layerOneContext(diagnosis: OptimizerAnalysisResult | ReturnType<typeof applyLayerOneRules>): string | null {
  if (!diagnosis) return null;
  return [
    'Regra automatica acionada antes da IA:',
    `- nivel=${diagnosis.nivel_critico}`,
    `- problema=${diagnosis.titulo_problema}`,
    `- leitura=${diagnosis.o_que_esta_acontecendo}`,
    `- acao_prioritaria=${diagnosis.acoes[0]?.acao ?? 'nao informada'}`,
    'Use esta regra como gatilho e contexto, mas cruze com todas as metricas antes de recomendar.',
  ].join('\n');
}

function annotateResultWithMemory(result: OptimizerAnalysisResult, memory: string | null): OptimizerAnalysisResult {
  if (!memory) return result;
  const memoryNote = 'Esta recomendacao considerou o historico recente de analises e decisoes registradas para esta campanha.';
  return {
    ...result,
    observacao: result.observacao ? `${result.observacao} ${memoryNote}` : memoryNote,
  };
}

async function findCachedResult(payload: OptimizerPayload, snapshot: Record<string, number>, payloadHash: string): Promise<OptimizerAnalysisResult | null> {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query<CacheRow>(
      `SELECT id, payload_hash, resultado, payload_snapshot
         FROM public.optimizer_ai_logs
        WHERE cliente_id = $1
          AND conjunto_id = $2
          AND solicitacao = $3
          AND origem = 'ia'
          AND resultado IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [payload.cliente_id, payload.dados_da_conta.conjunto_id, payload.contexto_adicional.solicitacao],
    );
    const row = rows[0];
    if (!row?.resultado) return null;
    if (row.payload_hash !== payloadHash) return null;
    const drift = maxSnapshotDriftPercent(snapshot, row.payload_snapshot);
    if (drift > 5) return null;
    return { ...row.resultado, origem: 'cache', recomendacao_id: randomUUID(), tokens_usados: 0, custo_estimado_usd: 0 };
  } catch (error) {
    console.error('[otimizador][cache]', error);
    return null;
  } finally {
    await pool.end();
  }
}

async function dailyAiCalls(payload: OptimizerPayload): Promise<number> {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM public.optimizer_ai_logs
        WHERE cliente_id = $1
          AND origem = 'ia'
          AND created_at >= date_trunc('day', NOW())`,
      [payload.cliente_id],
    );
    return Number(rows[0]?.total ?? 0);
  } catch {
    return 0;
  } finally {
    await pool.end();
  }
}

async function callClaude(payload: OptimizerPayload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nao configurada');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: OPTIMIZER_MODEL,
      max_tokens: 1500,
      system: buildOptimizerSystemPrompt(payload.contexto_adicional.solicitacao),
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude retornou ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.map((block) => block.type === 'text' ? block.text ?? '' : '').join('').trim() ?? '';
  const inputTokens = Number(data.usage?.input_tokens ?? 0);
  const outputTokens = Number(data.usage?.output_tokens ?? 0);
  return { text, inputTokens, outputTokens };
}

function validatePayload(payload: OptimizerPayload | undefined): string | null {
  if (!payload) return 'Payload obrigatorio.';
  if (!payload.cliente_id) return 'cliente_id obrigatorio.';
  if (!payload.dados_da_conta?.conjunto_id) return 'conjunto_id obrigatorio.';
  if (!payload.contexto_adicional?.solicitacao) return 'solicitacao obrigatoria.';
  return null;
}

// ─── v2 handler ──────────────────────────────────────────────────────────────

async function saveLogV2(params: {
  payload: OptimizerPayloadV2;
  result: OptimizerAnalysisResultV2;
  payloadHash: string;
  error?: string;
}) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    await pool.query(
      `INSERT INTO public.optimizer_ai_logs
        (cliente_id, conjunto_id, solicitacao, origem, nivel_critico,
         cliente_nome, campanha_nome, conta_plataforma, periodo_label, periodo_dias,
         gasto_total, conversoes, cpl_cpa_atual, ctr_link,
         payload_hash, resultado, prompt_version, modelo_usado, tokens_usados, custo_estimado_usd, erro,
         semana_analise, modo_operacao, estado_da_conta, resumo_executivo,
         acoes_automaticas_count, acoes_executadas_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        params.payload.cliente_id,
        params.payload.cliente_id, // conjunto_id = client (análise da conta inteira)
        'analise_semanal',
        params.result.origem,
        params.result.estado_da_conta === 'CRISE' ? 'vermelho' : params.result.estado_da_conta === 'ATENCAO' ? 'amarelo' : 'verde',
        params.payload.cliente_nome,
        null,
        'meta_ads',
        params.payload.periodo_analise.label ?? `${params.payload.periodo_analise.dias} dias`,
        params.payload.periodo_analise.dias,
        params.result.cruzamento_com_metas.gasto_total,
        params.result.cruzamento_com_metas.volume_conversoes_atual,
        params.result.cruzamento_com_metas.cpl_atual,
        null,
        params.payloadHash,
        JSON.stringify(params.result),
        params.result.prompt_version,
        params.result.modelo_usado,
        params.result.tokens_usados,
        params.result.custo_estimado_usd,
        params.error ?? null,
        params.payload.semana_analise,
        params.payload.modo_operacao,
        params.result.estado_da_conta,
        params.result.resumo_executivo,
        params.result.acoes_automaticas.length,
        params.result.acoes_automaticas.filter((a) => a.status_execucao === 'EXECUTAR_AGORA').length,
      ],
    );
  } catch (err) {
    console.error('[analisar][saveLogV2]', err);
  } finally {
    await pool.end();
  }
}

async function processAutoActions(
  result: OptimizerAnalysisResultV2,
  payload: OptimizerPayloadV2,
  connectionId: string,
  origin: string,
  analiseId: string,
) {
  const toExecute = result.acoes_automaticas.filter((a) => a.status_execucao === 'EXECUTAR_AGORA');
  for (const acao of toExecute.slice(0, 2)) { // max 2 por ciclo
    try {
      await fetch(new URL('/api/otimizador/executar', origin).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analise_id: analiseId,
          client_id: payload.cliente_id,
          connection_id: connectionId,
          acao: acao.acao,
          objeto_tipo: acao.objeto_tipo,
          objeto_id: acao.objeto_id,
          objeto_nome: acao.objeto_nome,
          parametros: acao.parametros,
          justificativa: acao.justificativa,
          modo_operacao: payload.modo_operacao,
          min_dias_aprendizado: payload.limites_globais.min_dias_aprendizado,
        }),
      });
    } catch (err) {
      console.error('[analisar][autoAction]', acao.objeto_id, err);
    }
  }
}

async function handleV2(body: AnalyzeBody, origin: string): Promise<Response> {
  const payload = body.payload_v2!;
  const connectionId = body.connection_id ?? '';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });

  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const analiseId = randomUUID();

  // Cache semanal: se já analisou esta semana com drift < 10%, retorna cache
  if (!body.force_ai) {
    const pool = makeServerPool();
    try {
      await ensureTables(pool);
      const { rows } = await pool.query<{ resultado: OptimizerAnalysisResultV2; payload_hash: string }>(
        `SELECT resultado, payload_hash FROM public.optimizer_ai_logs
          WHERE cliente_id = $1 AND semana_analise = $2 AND origem = 'ia' AND resultado IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        [payload.cliente_id, payload.semana_analise],
      );
      if (rows[0]?.payload_hash === payloadHash) {
        return Response.json({ ...rows[0].resultado, origem: 'cache', tokens_usados: 0, custo_estimado_usd: 0 });
      }
    } catch { /* ignore */ } finally {
      await pool.end();
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: OPTIMIZER_MODEL,
      max_tokens: 3000,
      system: buildOptimizerSystemPromptV2(),
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return Response.json({ error: `Claude ${response.status}: ${errText}` }, { status: 502 });
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.map((b) => b.type === 'text' ? b.text ?? '' : '').join('').trim() ?? '';
  const inputTokens = Number(data.usage?.input_tokens ?? 0);
  const outputTokens = Number(data.usage?.output_tokens ?? 0);
  const tokens = inputTokens + outputTokens;
  const cost = calcCostUsd(OPTIMIZER_MODEL, inputTokens, outputTokens);

  let parsed: unknown;
  try { parsed = extractJsonObject(text); } catch { parsed = {}; }

  const output = sanitizeOptimizerOutputV2(parsed, payload);
  const result: OptimizerAnalysisResultV2 = {
    ...output,
    recomendacao_id: analiseId,
    cliente_id: payload.cliente_id,
    semana_analise: payload.semana_analise,
    modo_operacao: payload.modo_operacao,
    origem: 'ia',
    prompt_version: OPTIMIZER_PROMPT_VERSION_V2,
    modelo_usado: OPTIMIZER_MODEL,
    tokens_usados: tokens,
    custo_estimado_usd: cost,
  };

  void logAiUsage({ source: 'otimizador-v2', model: OPTIMIZER_MODEL, inputTokens, outputTokens });
  await saveLogV2({ payload, result, payloadHash });

  // Executa ações automáticas (fire-and-forget)
  if (payload.modo_operacao === 'AUTOMATICO_PARCIAL' || payload.modo_operacao === 'AUTOMATICO_TOTAL') {
    void processAutoActions(result, payload, connectionId, origin, analiseId);
  }

  // Envia relatório WhatsApp (fire-and-forget)
  void sendOptimizerReport(result, payload.cliente_nome);

  return Response.json(result);
}

// ─── v1 handler (mantido para compatibilidade) ────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as AnalyzeBody;

  // Rota v2
  if (body.payload_v2) {
    const origin = new URL(req.url).origin;
    return handleV2(body, origin);
  }

  const rawPayload = body.payload;
  const invalid = validatePayload(rawPayload);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  if (!rawPayload) return Response.json({ error: 'payload obrigatorio.' }, { status: 400 });

  const preliminaryRule = applyLayerOneRules(rawPayload);
  const rawMemory = await loadOptimizerMemory(rawPayload);
  const memory = [rawMemory, preliminaryRule?.nivel_critico !== 'verde' ? layerOneContext(preliminaryRule) : null]
    .filter(Boolean)
    .join('\n\n') || null;
  const payload = withMemoryContext(rawPayload, memory);
  const payloadHash = hashPayload(payload);
  const snapshot = payloadNumericSnapshot(payload);
  const kind = payload.contexto_adicional.solicitacao as OptimizerRequestKind;
  const forceAi = kind === 'sugestao_criativo';

  if (!forceAi) {
    if (preliminaryRule?.nivel_critico === 'verde') {
      const result = withMeta({
        ...preliminaryRule,
        origem: 'camada_1',
        modelo_usado: null,
        tokens_usados: 0,
        custo_estimado_usd: 0,
      });
      const finalResult = annotateResultWithMemory(result, memory);
      void saveLog({ payload, result: finalResult, payloadHash, snapshot });
      return Response.json(finalResult);
    }

    const estimatedLevel = estimateCriticalLevel(payload);
    if (!preliminaryRule && estimatedLevel === 'verde') {
      const result = withMeta({
        ...buildGreenDiagnosis(payload),
        origem: 'camada_1',
        modelo_usado: null,
        tokens_usados: 0,
        custo_estimado_usd: 0,
      });
      const finalResult = annotateResultWithMemory(result, memory);
      void saveLog({ payload, result: finalResult, payloadHash, snapshot });
      return Response.json(finalResult);
    }
  }

  const cached = await findCachedResult(payload, snapshot, payloadHash);
  if (cached && !forceAi) return Response.json(cached);

  if (!forceAi) {
    const usedToday = await dailyAiCalls(payload);
    if (usedToday >= MAX_DAILY_AI_CALLS_PER_CLIENT) {
      if (preliminaryRule && preliminaryRule.nivel_critico !== 'verde') {
        const result = withMeta({
          ...preliminaryRule,
          origem: 'camada_1',
          modelo_usado: null,
          tokens_usados: 0,
          custo_estimado_usd: 0,
        });
        const limitedResult = {
          ...annotateResultWithMemory(result, memory),
          observacao: [
            result.observacao,
            `Limite de ${MAX_DAILY_AI_CALLS_PER_CLIENT} chamadas de IA do Otimizador atingido hoje para este cliente. A recomendacao ficou pela regra automatica e pode ser aprofundada no proximo processamento.`,
          ].filter(Boolean).join(' '),
        };
        void saveLog({ payload, result: limitedResult, payloadHash, snapshot, error: limitedResult.observacao ?? undefined });
        return Response.json(limitedResult);
      }

      const result = withMeta({
        ...buildFallbackDiagnosis(payload, `Limite de ${MAX_DAILY_AI_CALLS_PER_CLIENT} chamadas de IA do Otimizador atingido hoje para este cliente.`),
        origem: 'fallback',
        modelo_usado: null,
        tokens_usados: 0,
        custo_estimado_usd: 0,
      });
      const finalResult = annotateResultWithMemory(result, memory);
      void saveLog({ payload, result: finalResult, payloadHash, snapshot, error: finalResult.observacao ?? undefined });
      return Response.json(finalResult);
    }
  }

  try {
    const claude = await callClaude(payload);
    const parsed = extractJsonObject(claude.text);
    const diagnosis = sanitizeOptimizerDiagnosis(parsed, payload);
    const tokens = claude.inputTokens + claude.outputTokens;
    const cost = calcCostUsd(OPTIMIZER_MODEL, claude.inputTokens, claude.outputTokens);
    const result = withMeta({
      ...diagnosis,
      origem: 'ia',
      modelo_usado: OPTIMIZER_MODEL,
      tokens_usados: tokens,
      custo_estimado_usd: cost,
    });
    const finalResult = annotateResultWithMemory(result, memory);
    void logAiUsage({ source: 'otimizador', model: OPTIMIZER_MODEL, inputTokens: claude.inputTokens, outputTokens: claude.outputTokens });
    void saveLog({ payload, result: finalResult, payloadHash, snapshot });
    return Response.json(finalResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido na analise';
    const result = withMeta({
      ...buildFallbackDiagnosis(payload, message),
      origem: 'fallback',
      modelo_usado: null,
      tokens_usados: 0,
      custo_estimado_usd: 0,
    });
    const finalResult = annotateResultWithMemory(result, memory);
    void saveLog({ payload, result: finalResult, payloadHash, snapshot, error: message });
    return Response.json(finalResult);
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as ActionLogBody;
  if (!body.gestor_id || !body.cliente_id || !body.conjunto_id || !body.recomendacao_id || !body.decisao) {
    return Response.json({ error: 'Campos obrigatorios faltando.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    await pool.query(
      `INSERT INTO public.optimizer_action_logs
        (gestor_id, cliente_id, conjunto_id, recomendacao_id, decisao, motivo_recusa,
         motivo_texto, acao_executada, resultado_da_acao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        body.gestor_id,
        body.cliente_id,
        body.conjunto_id,
        body.recomendacao_id,
        body.decisao,
        body.motivo_recusa ?? null,
        body.motivo_texto ?? null,
        body.acao_executada ?? null,
        body.resultado_da_acao ?? 'pendente',
      ],
    );
    await pool.query(
      `UPDATE public.optimizer_ai_logs
          SET resultado_aceito = $1
        WHERE cliente_id = $2
          AND conjunto_id = $3
          AND (resultado->>'recomendacao_id') = $4`,
      [body.decisao === 'aceito', body.cliente_id, body.conjunto_id, body.recomendacao_id],
    ).catch(() => {});
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
