import type { Pool } from 'pg';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import type { OptimizerAcaoTipo, OptimizerObjetoTipo } from '@/lib/optimizer';

// Camada única de execução de ações do Otimizador (Meta + Google) + workflow por recomendação.
// Reusada por executar / lote / desfazer para não duplicar mutação e log.

const GOOGLE_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

export type ExecParametros = { novo_orcamento_diario?: number; budget_resource_name?: string };

export type ExecInput = {
  canal: 'meta' | 'google';
  acao: OptimizerAcaoTipo;
  objeto_tipo: OptimizerObjetoTipo;
  objeto_id: string;
  parametros: ExecParametros;
  connection_id: string;
  account_id?: string | null;        // Google: customer id (act_ removido); Meta: informativo
  login_customer_id?: string | null; // Google: MCC
};

// Ação inversa gravada para permitir "Desfazer".
export type UndoAcao = { acao: OptimizerAcaoTipo; parametros: Record<string, unknown> } | null;

export type ExecResult = { ok: boolean; error?: string; undo?: UndoAcao };

// ─── Resolução de token ───────────────────────────────────────────────────────

async function resolveMetaToken(connectionId: string): Promise<string | null> {
  const pool = makeServerPool();
  try {
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      if (rows[0]) return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
    }
    const { rows: poolRows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
    );
    if (poolRows[0]) return getFreshMetaToken(poolRows[0] as Parameters<typeof getFreshMetaToken>[0]);
    const { rows: legacy } = await pool.query(
      `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry
         FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
    );
    if (legacy[0]) return getFreshMetaToken(legacy[0] as Parameters<typeof getFreshMetaToken>[0]);
    return null;
  } finally {
    await pool.end();
  }
}

// Renova via endpoint OAuth cru (mesmo caminho do report-builder, que FUNCIONA). O antigo
// `oauth2.refreshAccessToken()` da googleapis é depreciado e falhava silenciosamente no
// Otimizador ("token não resolvido") — ver mesma correção em otimizador/weekly/route.ts.
async function refreshGoogleAccessToken(row: { access_token: string; refresh_token: string; token_expiry: string | null }): Promise<string | null> {
  if (row.token_expiry && new Date(row.token_expiry).getTime() > Date.now() + 60_000) {
    return row.access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  }).catch(() => null);
  if (res?.ok) {
    const data = await res.json().catch(() => null) as { access_token?: string } | null;
    return data?.access_token ?? row.access_token ?? null;
  }
  return row.access_token ?? null;
}

// Exportada para a Luna (execute_ad_action) reusar a mesma resolução de token.
export async function resolveGoogleToken(connectionId: string): Promise<string | null> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ access_token: string; refresh_token: string; token_expiry: string | null }>(
      `SELECT access_token, refresh_token, token_expiry FROM public.google_connections WHERE id = $1`,
      [connectionId],
    );
    if (rows[0]) {
      const tok = await refreshGoogleAccessToken(rows[0]);
      if (tok) return tok;
    }
    // Fallback: qualquer conexão Google Ads conectada (connection_id salvo pode estar defasado).
    const { rows: candidates } = await pool.query<{ access_token: string; refresh_token: string; token_expiry: string | null }>(
      `SELECT access_token, refresh_token, token_expiry
         FROM public.google_connections
        WHERE status = 'connected'
          AND (account_type = 'google_ads' OR scope ILIKE '%adwords%')
        ORDER BY connected_at DESC
        LIMIT 3`,
    ).catch(() => ({ rows: [] as { access_token: string; refresh_token: string; token_expiry: string | null }[] }));
    for (const c of candidates) {
      const tok = await refreshGoogleAccessToken(c);
      if (tok) return tok;
    }
    return null;
  } catch {
    return null;
  } finally {
    await pool.end();
  }
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

async function metaGet(objetoId: string, fields: string, token: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${objetoId}?fields=${fields}&access_token=${token}`);
  if (!res.ok) return null;
  return res.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function executeMeta(input: ExecInput, token: string): Promise<ExecResult> {
  const base = `https://graph.facebook.com/v21.0/${input.objeto_id}`;

  if (input.acao === 'PAUSAR' || input.acao === 'ATIVAR') {
    const status = input.acao === 'PAUSAR' ? 'PAUSED' : 'ACTIVE';
    const undo: UndoAcao = { acao: input.acao === 'PAUSAR' ? 'ATIVAR' : 'PAUSAR', parametros: {} };
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, access_token: token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Meta ${res.status}` };
    }
    return { ok: true, undo };
  }

  if (input.acao === 'AJUSTAR_ORCAMENTO') {
    if (!input.parametros.novo_orcamento_diario || input.parametros.novo_orcamento_diario <= 0) {
      return { ok: false, error: 'novo_orcamento_diario inválido para ajuste de orçamento.' };
    }
    if (input.objeto_tipo !== 'adset') {
      return { ok: false, error: 'Ajuste de orçamento só é suportado em conjuntos (adsets).' };
    }
    // Captura o orçamento anterior (em centavos → reais) para permitir desfazer.
    const before = await metaGet(input.objeto_id, 'daily_budget', token);
    const oldCents = before?.daily_budget != null ? Number(before.daily_budget) : null;
    const undo: UndoAcao = oldCents != null && Number.isFinite(oldCents)
      ? { acao: 'AJUSTAR_ORCAMENTO', parametros: { novo_orcamento_diario: oldCents / 100 } }
      : null;

    const budgetCents = Math.round(input.parametros.novo_orcamento_diario * 100);
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_budget: budgetCents, access_token: token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Meta ${res.status}` };
    }
    return { ok: true, undo };
  }

  return { ok: false, error: `Ação desconhecida: ${input.acao}` };
}

// ─── Google ───────────────────────────────────────────────────────────────────

async function executeGoogle(input: ExecInput, token: string): Promise<ExecResult> {
  const customer = String(input.account_id ?? '').replace(/^customers\//, '').replace(/-/g, '');
  if (!customer) return { ok: false, error: 'account_id (customer id) obrigatório para ações no Google Ads.' };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': GOOGLE_DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (input.login_customer_id) headers['login-customer-id'] = String(input.login_customer_id).replace(/-/g, '');

  if (input.acao === 'PAUSAR' || input.acao === 'ATIVAR') {
    const resource = input.objeto_tipo === 'campaign' ? 'campaigns'
      : input.objeto_tipo === 'adset' ? 'adGroups'
      : null;
    if (!resource) return { ok: false, error: 'Ação de status no Google só suporta campanha e conjunto (ad group).' };
    const status = input.acao === 'PAUSAR' ? 'PAUSED' : 'ENABLED';
    const res = await fetch(`https://googleads.googleapis.com/v24/customers/${customer}/${resource}:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: { resourceName: `customers/${customer}/${resource}/${input.objeto_id}`, status },
          updateMask: 'status',
        }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Google Ads ${res.status}` };
    }
    return { ok: true, undo: { acao: input.acao === 'PAUSAR' ? 'ATIVAR' : 'PAUSAR', parametros: {} } };
  }

  if (input.acao === 'AJUSTAR_ORCAMENTO') {
    const budgetResource = input.parametros.budget_resource_name;
    if (!budgetResource || input.parametros.novo_orcamento_diario == null) {
      return { ok: false, error: 'budget_resource_name e novo_orcamento_diario obrigatórios para orçamento no Google.' };
    }
    const res = await fetch(`https://googleads.googleapis.com/v24/customers/${customer}/campaignBudgets:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: { resourceName: budgetResource, amountMicros: Math.round(input.parametros.novo_orcamento_diario * 1_000_000) },
          updateMask: 'amountMicros',
        }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Google Ads ${res.status}` };
    }
    // Sem leitura do valor anterior aqui → desfazer de orçamento no Google fica indisponível.
    return { ok: true, undo: null };
  }

  return { ok: false, error: `Ação desconhecida: ${input.acao}` };
}

// ─── Entrada única ─────────────────────────────────────────────────────────────

export async function executeOptimizerAction(input: ExecInput): Promise<ExecResult> {
  if (input.canal === 'google') {
    const token = await resolveGoogleToken(input.connection_id);
    if (!token) return { ok: false, error: 'Token Google Ads não encontrado.' };
    return executeGoogle(input, token);
  }
  const token = await resolveMetaToken(input.connection_id);
  if (!token) return { ok: false, error: 'Token Meta não encontrado.' };
  return executeMeta(input, token);
}

// ─── Log de execução ───────────────────────────────────────────────────────────

export async function logExecucao(pool: Pool, params: {
  analise_id?: string | null;
  client_id: string;
  connection_id: string;
  objeto_tipo: string;
  objeto_id: string;
  objeto_nome: string;
  acao: string;
  parametros: Record<string, unknown>;
  justificativa: string;
  modo_operacao: string;
  resultado: 'pendente' | 'sucesso' | 'erro';
  erro_detalhe?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.optimizer_execucoes_automaticas
         (analise_id, client_id, connection_id, objeto_tipo, objeto_id, objeto_nome, acao,
          parametros, justificativa, modo_operacao, resultado, erro_detalhe, executado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        params.analise_id ?? null, params.client_id, params.connection_id, params.objeto_tipo,
        params.objeto_id, params.objeto_nome, params.acao, JSON.stringify(params.parametros),
        params.justificativa, params.modo_operacao, params.resultado, params.erro_detalhe ?? null,
      ],
    );
  } catch (err) {
    console.error('[optimizer-execucao][logExecucao]', err);
  }
}

// ─── Workflow por recomendação ──────────────────────────────────────────────────

export async function upsertRecStatus(pool: Pool, p: {
  rec_id: string;
  analise_id?: string | null;
  cliente_id: string;
  objeto_id?: string | null;
  status: 'pendente' | 'aplicado' | 'ignorado' | 'em_analise_humana';
  autor_id?: string | null;
  autor_nome?: string | null;
  motivo?: string | null;
  undo_payload?: Record<string, unknown> | null;
  atribuido_a?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.optimizer_recomendacao_status
       (rec_id, analise_id, cliente_id, objeto_id, status, autor_id, autor_nome, motivo, undo_payload, atribuido_a, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (rec_id) DO UPDATE SET
       status = EXCLUDED.status,
       autor_id = EXCLUDED.autor_id,
       autor_nome = EXCLUDED.autor_nome,
       motivo = EXCLUDED.motivo,
       undo_payload = COALESCE(EXCLUDED.undo_payload, public.optimizer_recomendacao_status.undo_payload),
       atribuido_a = EXCLUDED.atribuido_a,
       updated_at = NOW()`,
    [
      p.rec_id, p.analise_id ?? null, p.cliente_id, p.objeto_id ?? null, p.status,
      p.autor_id ?? null, p.autor_nome ?? null, p.motivo ?? null,
      p.undo_payload ? JSON.stringify(p.undo_payload) : null, p.atribuido_a ?? null,
    ],
  );
}
