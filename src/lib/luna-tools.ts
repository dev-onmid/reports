// Ferramentas da Luna IA — extraídas de /api/agent/chat/route.ts para serem
// compartilhadas entre o chat (streaming) e o agendador headless (/api/agent/scheduler).
// Toda ferramenta nova da Luna deve ser adicionada AQUI (schema em systemTools +
// executor em execSystemTool), nunca de volta na rota.
import Anthropic from '@anthropic-ai/sdk';
import { deflateSync } from 'zlib';
import { makeServerPool } from '@/lib/server-db';
import { sendText } from '@/lib/zapi';
import { getFreshMetaToken } from '@/lib/meta-token';
import { resolveMetaPeriod, resolveGaqlPeriod, applyMetaDateToUrl } from '@/lib/period-utils';
import { countMetaResults } from '@/lib/meta-results';
import { ensureOptimizerClientConfigTable } from '@/lib/optimizer';
import { executeOptimizerAction } from '@/lib/optimizer-execucao';
import { dispararEventosPorStatus } from '@/lib/conversions';
import type { OptimizerAcaoTipo, OptimizerObjetoTipo } from '@/lib/optimizer';

// ─── Agendamento (luna_tasks) ────────────────────────────────────────────────

export async function ensureLunaTasksTable(pool: ReturnType<typeof makeServerPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.luna_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      titulo TEXT NOT NULL,
      instrucao TEXT NOT NULL,
      tipo TEXT NOT NULL,
      hora TEXT,
      dia_semana INTEGER,
      dia_mes INTEGER,
      whatsapp_phone TEXT,
      zapi_client_id TEXT,
      permitir_acoes BOOLEAN NOT NULL DEFAULT FALSE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ,
      last_result TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // Histórico de execuções (1 linha por rodada — o last_result da tarefa só guarda a última)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.luna_task_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES public.luna_tasks(id) ON DELETE CASCADE,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ok BOOLEAN NOT NULL DEFAULT TRUE,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_luna_task_runs_task ON public.luna_task_runs (task_id, ran_at DESC);
  `).catch(() => {});
}

// Brasil não tem horário de verão desde 2019 — BRT é UTC-3 fixo.
const BRT_OFFSET_MS = 3 * 3600_000;

function parseHoraBrt(hora: string | null | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return { h: 9, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

// Próxima execução em UTC a partir da recorrência (horários interpretados em BRT).
export function computeNextRun(
  tipo: string,
  opts: { run_at?: string | null; hora?: string | null; dia_semana?: number | null; dia_mes?: number | null },
  fromMs = Date.now(),
): Date | null {
  if (tipo === 'once') {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(opts.run_at ?? '').trim());
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + BRT_OFFSET_MS);
  }
  const { h, m } = parseHoraBrt(opts.hora);
  // "Agora" no relógio de Brasília, tratado como UTC pra fazer conta de calendário.
  const nowBrt = new Date(fromMs - BRT_OFFSET_MS);
  const candidate = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d, h, m) + BRT_OFFSET_MS);
  if (tipo === 'daily') {
    let c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate());
    if (c.getTime() <= fromMs) c = new Date(c.getTime() + 86400_000);
    return c;
  }
  if (tipo === 'weekly') {
    const target = Math.max(0, Math.min(6, Number(opts.dia_semana ?? 1)));
    let c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate());
    let delta = (target - nowBrt.getUTCDay() + 7) % 7;
    if (delta === 0 && c.getTime() <= fromMs) delta = 7;
    return new Date(candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate() + delta).getTime());
  }
  if (tipo === 'monthly') {
    const day = Math.max(1, Math.min(28, Number(opts.dia_mes ?? 1)));
    let c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), day);
    if (c.getTime() <= fromMs) c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth() + 1, day);
    return c;
  }
  return null;
}

function fmtBrt(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Instância de envio FIXA da Luna ─────────────────────────────────────────
// A Luna NUNCA escolhe por onde enviar WhatsApp: usa exclusivamente a instância
// configurada em system_settings['luna_zapi_client_id'] (delegável pela UI de
// Agendamentos). Sem config, cai na instância de TESTE (name com "test"). Se
// nada existir, NÃO envia — jamais usa outra instância como fallback.
export type LunaSendInstance = { id: string; name: string; instance_id: string; token: string; security_token: string | null };

export async function getLunaSendInstance(pool: ReturnType<typeof makeServerPool>): Promise<LunaSendInstance | null> {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
  )`).catch(() => {});
  const { rows: cfg } = await pool.query(`SELECT value FROM public.system_settings WHERE key = 'luna_zapi_client_id'`).catch(() => ({ rows: [] as { value: string }[] }));
  const configuredId = cfg[0]?.value?.trim();
  if (configuredId) {
    const { rows } = await pool.query(
      `SELECT id, name, instance_id, token, security_token FROM public.zapi_clients WHERE id = $1 AND active = TRUE`,
      [configuredId]
    ).catch(() => ({ rows: [] as LunaSendInstance[] }));
    return rows[0] ?? null; // configurada mas inativa/apagada → não envia (engessado)
  }
  const { rows } = await pool.query(
    `SELECT id, name, instance_id, token, security_token FROM public.zapi_clients
      WHERE active = TRUE AND COALESCE(provider,'zapi') <> 'evolution' AND name ILIKE '%test%'
      ORDER BY created_at ASC LIMIT 1`
  ).catch(() => ({ rows: [] as LunaSendInstance[] }));
  return rows[0] ?? null;
}

// ─── Google Ads (busca robusta) ──────────────────────────────────────────────
// Espelha o padrão comprovado do Radar/Otimizador: token via fetch cru com
// fallback (resolveGoogleToken — NUNCA googleapis.refreshAccessToken, que falha
// silenciosamente) e tentativa de login-customer-id (contas de agência ficam
// sob MCC e retornam PERMISSION_DENIED sem esse header).
const gLoginCache = new Map<string, string | null | undefined>(); // customerId → login que funcionou

// Mesmo fallback embutido do Radar/Otimizador — com env ausente na Vercel,
// developer-token vazio faz o Google recusar tudo.
const GOOGLE_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

async function refreshGoogleTokenRaw(row: { access_token: string | null; refresh_token: string | null; token_expiry: string | null }): Promise<string | null> {
  if (row.token_expiry && new Date(row.token_expiry).getTime() > Date.now() + 5 * 60_000 && row.access_token) {
    return row.access_token;
  }
  if (!row.refresh_token) return row.access_token ?? null;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function lunaGoogleSearch(customerId: string, query: string): Promise<{ results: any[]; login: string | null; token: string } | null> {
  // Igual ao Radar (comprovado em produção): TODAS as conexões conectadas, sem
  // filtro de account_type/scope — o fallback do optimizer-execucao filtra por
  // esses campos e não casa com as linhas reais do banco (token voltava nulo).
  const pool = makeServerPool();
  let conns: Array<{ access_token: string | null; refresh_token: string | null; token_expiry: string | null }> = [];
  try {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, token_expiry FROM public.google_connections
        WHERE status = 'connected' ORDER BY connected_at DESC NULLS LAST LIMIT 5`
    );
    conns = rows;
  } catch { /* sem conexões */ } finally { await pool.end(); }
  if (conns.length === 0) return null;

  for (const conn of conns) {
    const token = await refreshGoogleTokenRaw(conn);
    if (!token) continue;

    const attempt = async (login: string | null) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'developer-token': GOOGLE_DEV_TOKEN, 'Content-Type': 'application/json' };
      if (login) headers['login-customer-id'] = login;
      const r = await fetch(`https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`, {
        method: 'POST', headers, body: JSON.stringify({ query }),
      }).catch(() => null);
      if (!r?.ok) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await r.json().catch(() => null) as { results?: any[] } | null;
      return d ? (d.results ?? []) : null;
    };

    // 1) login memorizado; 2) direto e a própria conta; 3) cada conta acessível como MCC
    const cached = gLoginCache.get(customerId);
    if (cached !== undefined) {
      const out = await attempt(cached);
      if (out) return { results: out, login: cached, token };
    }
    for (const login of [null, customerId]) {
      const out = await attempt(login);
      if (out) { gLoginCache.set(customerId, login); return { results: out, login, token }; }
    }
    const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
      headers: { Authorization: `Bearer ${token}`, 'developer-token': GOOGLE_DEV_TOKEN },
    }).catch(() => null);
    const rns = listRes?.ok ? ((await listRes.json().catch(() => ({}))) as { resourceNames?: string[] }).resourceNames ?? [] : [];
    for (const rn of rns.slice(0, 10)) {
      const cand = rn.replace('customers/', '').replace(/\D/g, '');
      if (cand === customerId) continue;
      const out = await attempt(cand);
      if (out) { gLoginCache.set(customerId, cand); return { results: out, login: cand, token }; }
    }
  }
  return null;
}

// Mutate cru na Google Ads API (mesmos headers/login do lunaGoogleSearch). Retorna os
// resourceNames criados ou {error} com a mensagem real do Google.
async function lunaGoogleMutate(
  customerId: string, token: string, login: string | null,
  resource: string, operations: Record<string, unknown>[],
): Promise<{ resourceNames: string[] } | { error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`, 'developer-token': GOOGLE_DEV_TOKEN, 'Content-Type': 'application/json',
  };
  if (login) headers['login-customer-id'] = login;
  const r = await fetch(`https://googleads.googleapis.com/v24/customers/${customerId}/${resource}:mutate`, {
    method: 'POST', headers, body: JSON.stringify({ operations }),
  }).catch(() => null);
  if (!r) return { error: 'sem resposta da Google Ads API' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await r.json().catch(() => ({})) as any;
  if (!r.ok) {
    const msg = body?.error?.details?.[0]?.errors?.[0]?.message
      ?? body?.error?.message ?? `HTTP ${r.status}`;
    return { error: String(msg) };
  }
  const names = (body?.results ?? []).map((x: { resourceName?: string }) => x.resourceName ?? '').filter(Boolean);
  return { resourceNames: names };
}

export const DEFAULT_INSTRUCTIONS = `Você é Luna, assistente inteligente da Onmid Marketing.`;

// --- DB helpers ---

export async function getInstructions(): Promise<string> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query("SELECT instructions FROM public.agent_instructions WHERE id = 'default'");
    return rows[0]?.instructions ?? DEFAULT_INSTRUCTIONS;
  } catch { return DEFAULT_INSTRUCTIONS; } finally { await pool.end(); }
}

export type KnowledgeItem = { id: string; title: string; type: string; content: string; mime_type?: string };

export async function getKnowledge(): Promise<KnowledgeItem[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query('SELECT id, title, type, content, mime_type FROM public.agent_knowledge ORDER BY created_at ASC');
    return rows;
  } catch { return []; } finally { await pool.end(); }
}

export type ExternalTool = { id: string; name: string; description: string; type: string; config: Record<string, unknown>; enabled: boolean };

export async function getExternalTools(): Promise<ExternalTool[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query("SELECT id, name, description, type, config, enabled FROM public.agent_external_tools WHERE enabled = true ORDER BY created_at ASC");
    return rows;
  } catch { return []; } finally { await pool.end(); }
}

// --- Core system tools ---

export const systemTools: Anthropic.Tool[] = [
  {
    name: 'list_clients',
    description: 'Lista todos os clientes cadastrados no sistema com nome, segmento e status.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_client_accounts',
    description: 'Retorna as contas de anúncios (Meta Ads e Google Ads) vinculadas a um cliente. Útil para saber quais contas o cliente possui.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        client_name: { type: 'string', description: 'Nome do cliente (para busca por nome)' },
      },
      required: [],
    },
  },
  {
    name: 'get_crm_data',
    description: 'Retorna leads do CRM para um cliente específico.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        limit: { type: 'number', description: 'Máx de leads a retornar (padrão: 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_meta_campaigns',
    description: 'Busca campanhas e métricas do Meta Ads para um cliente. Inclui gasto, impressões, cliques, CTR, leads e CPL. Também retorna o ID das campanhas para operações de pause/ativar. Aceita período custom com date_from/date_to para qualquer intervalo de datas (ex: um mês específico do passado).',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        period: { type: 'string', description: 'Período: this_month, last_7d, last_30d, last_month, custom (padrão: this_month). Use custom com date_from/date_to para qualquer intervalo de datas.' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (obrigatória se period=custom)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (obrigatória se period=custom)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_google_campaigns',
    description: 'Busca campanhas e métricas do Google Ads para um cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        period: { type: 'string', description: 'Período: this_month, last_7d, last_30d, last_month, custom (padrão: this_month). Use custom com date_from/date_to para qualquer intervalo de datas.' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (obrigatória se period=custom)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (obrigatória se period=custom)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_monthly_history',
    description: 'Histórico MÊS A MÊS de um cliente num intervalo de datas: investimento, leads (formulário + conversa iniciada, contagem canônica sem duplicar), CPL, impressões e cliques — Meta Ads + Google Ads + leads registrados no CRM, tudo separado por mês numa chamada só. USE SEMPRE que o usuário pedir dados separados por mês ou evolução mensal (ex: "de janeiro a julho, mês a mês"). NÃO chame get_meta_campaigns várias vezes para isso.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (ex: 2026-01-01)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (ex: 2026-07-31)' },
      },
      required: ['client_id', 'date_from', 'date_to'],
    },
  },
  {
    name: 'get_account_balances',
    description: 'Retorna o saldo disponível nas contas de anúncios (Meta e Google) de um cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'update_meta_campaign_status',
    description: 'Pausa ou ativa uma campanha do Meta Ads. Use este tool quando o usuário pedir para pausar, ativar ou reativar uma campanha.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'ID da campanha Meta Ads' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'], description: 'PAUSED para pausar, ACTIVE para ativar' },
        client_id: { type: 'string', description: 'ID do cliente dono da campanha' },
      },
      required: ['campaign_id', 'status', 'client_id'],
    },
  },
  {
    name: 'generate_client_report',
    description: 'Gera o relatório OFICIAL do cliente pelo gerador da plataforma (o mesmo da tela Relatórios — capa, Meta Ads, Instagram, Google, etc.) e devolve o link público /relatorio/[token] para ver ou compartilhar no chat. Use quando o usuário quiser gerar/ver o relatório sem necessariamente baixar o PDF.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        period: { type: 'string', description: 'Período: this_month, last_month, last_30d, last_7d, custom (padrão: this_month)' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (obrigatória se period=custom)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (obrigatória se period=custom)' },
        template: { type: 'string', enum: ['performance', 'delivery', 'social'], description: 'Modelo do relatório. Se omitido, usa o configurado para o cliente (ou performance).' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'send_report_pdf_whatsapp',
    description: 'Gera o relatório OFICIAL do cliente pelo gerador da plataforma e ENVIA no WhatsApp via Z-API. O formato de entrega é escolhido em "format": "link" envia o link do relatório completo (padrão, funciona sempre); "pdf" envia o arquivo PDF real de todas as páginas (renderizado no navegador — só disponível no chat, não no agendador). Use quando o usuário pedir para enviar o relatório pelo WhatsApp. Se não souber qual Z-API usar, use list_zapi_clients.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente para gerar o relatório' },
        phone: { type: 'string', description: 'Número do WhatsApp com DDI (ex: 5511999999999)' },
        period: { type: 'string', description: 'Período: this_month, last_month, last_30d, last_7d, custom (padrão: this_month)' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (obrigatória se period=custom)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (obrigatória se period=custom)' },
        format: { type: 'string', enum: ['link', 'pdf'], description: 'Como entregar: "link" (padrão) manda o link do relatório; "pdf" manda o arquivo PDF completo.' },
        template: { type: 'string', enum: ['performance', 'delivery', 'social'], description: 'Modelo do relatório. Se omitido, usa o configurado para o cliente (ou performance).' },
        caption: { type: 'string', description: 'Mensagem de texto que acompanha o relatório (opcional)' },
        zapi_client_id: { type: 'string', description: 'ID da conexão Z-API a usar. Se não souber, use list_zapi_clients primeiro.' },
      },
      required: ['client_id', 'phone'],
    },
  },
  {
    name: 'generate_report_pdf',
    description: 'Gera o relatório OFICIAL do cliente pelo gerador da plataforma e disponibiliza o PDF completo (todas as páginas) para download direto no chat. Use quando o usuário pedir para ver, gerar ou baixar o relatório em PDF no chat.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente para gerar o relatório' },
        period: { type: 'string', description: 'Período: this_month, last_month, last_30d, last_7d, custom (padrão: this_month)' },
        date_from: { type: 'string', description: 'Data inicial YYYY-MM-DD (obrigatória se period=custom)' },
        date_to: { type: 'string', description: 'Data final YYYY-MM-DD (obrigatória se period=custom)' },
        template: { type: 'string', enum: ['performance', 'delivery', 'social'], description: 'Modelo do relatório. Se omitido, usa o configurado para o cliente (ou performance).' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'list_zapi_clients',
    description: 'Lista as conexões Z-API disponíveis para envio de WhatsApp.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_users',
    description: 'Lista todos os usuários e gestores cadastrados no sistema com nome, email, role e status.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'create_user',
    description: 'Cria um novo usuário no sistema. APENAS disponível para administradores. Sempre confirme com o usuário os dados antes de criar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nome completo do usuário' },
        email: { type: 'string', description: 'Email de login do usuário' },
        password: { type: 'string', description: 'Senha inicial' },
        role: { type: 'string', enum: ['admin', 'gestor', 'viewer'], description: 'admin, gestor ou viewer' },
      },
      required: ['name', 'email', 'password', 'role'],
    },
  },
  {
    name: 'assign_gestor',
    description: 'Vincula um gestor (usuário) a um cliente como responsável.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        gestor_id: { type: 'string', description: 'ID do gestor/usuário a vincular' },
      },
      required: ['client_id', 'gestor_id'],
    },
  },
  {
    name: 'link_account',
    description: 'Vincula uma conta de anúncios (Meta Ads ou Google Ads) a um cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        platform: { type: 'string', enum: ['meta_ads', 'google_ads'], description: 'meta_ads ou google_ads' },
        account_id: { type: 'string', description: 'ID da conta de anúncios (ex: act_123456789 para Meta)' },
        account_name: { type: 'string', description: 'Nome da conta (opcional)' },
        connection_id: { type: 'string', description: 'ID da conexão OAuth (opcional)' },
      },
      required: ['client_id', 'platform', 'account_id'],
    },
  },
  {
    name: 'create_webhook',
    description: 'Cria uma nova automação webhook no sistema. O token de autenticação é gerado automaticamente pelo banco.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nome do webhook (ex: "Notificação de novo lead")' },
        description: { type: 'string', description: 'Descrição do propósito' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_disparo',
    description: 'Cria uma campanha de disparo em massa via WhatsApp (Z-API). Use list_zapi_clients para descobrir o zapi_client_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente dono da campanha' },
        name: { type: 'string', description: 'Nome da campanha' },
        message: { type: 'string', description: 'Mensagem a enviar' },
        numbers: {
          type: 'array',
          items: { type: 'object', properties: { phone: { type: 'string' }, name: { type: 'string' } }, required: ['phone'] },
          description: 'Contatos: [{phone: "5511999999999", name: "João"}]',
        },
        starts_at: { type: 'string', description: 'Início no formato ISO (ex: 2025-06-01T09:00:00). Padrão: agora.' },
        interval_min: { type: 'number', description: 'Intervalo mínimo entre mensagens em segundos (padrão: 30)' },
        interval_max: { type: 'number', description: 'Intervalo máximo entre mensagens em segundos (padrão: 90)' },
      },
      required: ['client_id', 'name', 'message', 'numbers'],
    },
  },
  {
    name: 'schedule_payment',
    description: 'Agenda ou registra um pagamento PIX novo no sistema (cria um lançamento). Para MUDAR a data de um pagamento que já existe, use reschedule_client_payment em vez desta.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente relacionado' },
        destination: { type: 'string', description: 'Destinatário ou chave PIX' },
        amount: { type: 'number', description: 'Valor em reais (ex: 150.00)' },
        date: { type: 'string', description: 'Data do pagamento YYYY-MM-DD' },
        channel: { type: 'string', enum: ['pix', 'ted', 'boleto'], description: 'Canal de pagamento (padrão: pix)' },
        status: { type: 'string', enum: ['pendente', 'agendado', 'pago'], description: 'Status inicial (padrão: agendado)' },
      },
      required: ['client_id', 'destination', 'amount', 'date'],
    },
  },
  {
    name: 'list_client_payments',
    description: 'Lista os pagamentos (pendentes, agendados e recentes) de um cliente, com id, data, valor e status. Use ANTES de reschedule_client_payment para descobrir o payment_id certo, a menos que o usuário já tenha dito qual.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'reschedule_client_payment',
    description: 'AÇÃO SENSÍVEL — muda a data de UM pagamento específico já existente (ajuste pontual, "só essa semana/mês"). NÃO altera o dia fixo de vencimento do cliente. Antes de chamar: descreva o que vai fazer (qual pagamento, data nova) e espere confirmação explícita do usuário em outra mensagem.',
    input_schema: {
      type: 'object' as const,
      properties: {
        payment_id: { type: 'string', description: 'ID do pagamento a reagendar (use list_client_payments se não souber)' },
        new_date: { type: 'string', description: 'Nova data YYYY-MM-DD' },
      },
      required: ['payment_id', 'new_date'],
    },
  },
  {
    name: 'set_client_payment_due_day',
    description: 'AÇÃO SENSÍVEL — define o dia fixo de vencimento do PIX/pagamento de um cliente PARA SEMPRE (muda o padrão recorrente, não um pagamento específico). Use quando o usuário disser algo como "definitivo", "sempre", "todo mês". Antes de chamar: confirme com o usuário se é mesmo uma mudança permanente (e não pontual) e espere a resposta em outra mensagem antes de executar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        due_day: { type: 'number', description: 'Dia do mês de vencimento, 1 a 31' },
      },
      required: ['client_id', 'due_day'],
    },
  },
  {
    name: 'configure_optimizer_client',
    description: 'Atualiza a configuração do Otimizador de um cliente: modo de operação, dia da semana da análise, ou peculiaridades (a lista de observações que a IA do Otimizador lê antes de cada análise — no painel aparecem como itens separados, um por linha). Por padrão, observacoes_fixas ADICIONA um item novo à lista sem apagar os existentes; use substituir_tudo=true só se o usuário pedir explicitamente para trocar/limpar tudo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        observacoes_fixas: { type: 'string', description: 'Texto da peculiaridade a adicionar (ex: "campanhas com [BOT] no nome são fluxo automatizado, nunca sugerir mover orçamento delas"). Vira um novo item na lista, não sobrescreve os demais — a menos que substituir_tudo=true.' },
        substituir_tudo: { type: 'boolean', description: 'Se true, APAGA todos os itens existentes e deixa só o texto informado em observacoes_fixas. Só use se o usuário pedir explicitamente para substituir/limpar tudo.' },
        modo_operacao: { type: 'string', enum: ['DIAGNOSTICO_APENAS', 'RECOMENDACAO_COM_APROVACAO', 'AUTOMATICO_PARCIAL', 'AUTOMATICO_TOTAL'], description: 'Modo de operação do Otimizador' },
        analise_dia_semana: { type: 'number', description: 'Dia da semana da análise: 1=segunda...5=sexta' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'add_client_vault_credential',
    description: 'AÇÃO SENSÍVEL — guarda uma senha/credencial no Cofre de um cliente. Antes de chamar: repita em texto o título e para qual cliente (NUNCA repita a senha em texto puro na sua resposta) e espere confirmação explícita do usuário em outra mensagem antes de executar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        title: { type: 'string', description: 'Título da credencial (ex: "Facebook Ads", "Painel Google")' },
        login: { type: 'string', description: 'Usuário/login (opcional)' },
        password: { type: 'string', description: 'Senha (opcional)' },
        url: { type: 'string', description: 'URL do sistema (opcional)' },
        category: { type: 'string', description: 'Categoria (opcional, padrão "Outros")' },
        notes: { type: 'string', description: 'Observações (opcional)' },
      },
      required: ['client_id', 'title'],
    },
  },
  {
    name: 'create_meta_campaign',
    description: `Cria uma campanha COMPLETA no Meta Ads: campanha + conjunto de anúncios + anúncio com criativo.
IMPORTANTE: SEMPRE preencha ad_body (texto principal), ad_headline (título) e ad_cta antes de chamar. Gere a copy com base no segmento/objetivo do cliente.
Antes de chamar, analise o negócio/segmento do cliente e preencha os campos de targeting adequados (cidade, interesses, placements, faixa etária).
A ferramenta busca automaticamente os IDs de cidades e interesses na API Meta, você só precisa fornecer os nomes.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        name: { type: 'string', description: 'Nome da campanha (ex: [ON] NomeCliente - Leads - Jun/25)' },
        objective: {
          type: 'string',
          enum: ['OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_APP_PROMOTION'],
          description: 'OUTCOME_LEADS (leads), OUTCOME_SALES (vendas), OUTCOME_TRAFFIC (tráfego), OUTCOME_AWARENESS (reconhecimento)',
        },
        daily_budget: { type: 'number', description: 'Orçamento diário em reais (ex: 50.00)' },
        adset_name: { type: 'string', description: 'Nome do conjunto. Padrão: "Conjunto 1 — [nome da campanha]"' },
        age_min: { type: 'number', description: 'Idade mínima (padrão: 18)' },
        age_max: { type: 'number', description: 'Idade máxima (padrão: 65)' },
        genders: { type: 'string', enum: ['all', 'male', 'female'], description: 'Gênero: all, male ou female' },
        cities: {
          type: 'array', items: { type: 'string' },
          description: 'Cidades alvo por nome (ex: ["Londrina", "Maringá"]). A ferramenta busca os IDs automaticamente na API Meta.',
        },
        countries: {
          type: 'array', items: { type: 'string' },
          description: 'Países ISO como fallback se nenhuma cidade for encontrada (padrão: ["BR"])',
        },
        interests: {
          type: 'array', items: { type: 'string' },
          description: 'Interesses por nome (ex: ["Empreendedorismo", "Marketing digital"]). A ferramenta busca os IDs automaticamente.',
        },
        placements: {
          type: 'string',
          enum: ['all', 'instagram_only', 'facebook_only', 'instagram_feed_reels', 'facebook_feed'],
          description: 'Posicionamento dos anúncios. instagram_only = Feed+Stories+Reels+Explore do Instagram apenas.',
        },
        ad_body: { type: 'string', description: 'Texto principal do anúncio (corpo/copy). Obrigatório para criar o anúncio.' },
        ad_headline: { type: 'string', description: 'Título/headline do anúncio (ex: "Venda mais com marketing efetivo")' },
        ad_description: { type: 'string', description: 'Descrição curta exibida abaixo do headline' },
        ad_cta: {
          type: 'string',
          enum: ['LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'CONTACT_US', 'SUBSCRIBE', 'APPLY_NOW', 'BOOK_TRAVEL', 'DOWNLOAD', 'WATCH_MORE', 'SHOP_NOW', 'ORDER_NOW', 'CALL_NOW', 'MESSAGE_PAGE', 'WHATSAPP_MESSAGE'],
          description: 'Botão de CTA. Para leads: SIGN_UP, GET_QUOTE ou LEARN_MORE. Para vendas/tráfego: SHOP_NOW, LEARN_MORE.',
        },
        destination_url: { type: 'string', description: 'URL de destino do anúncio (site, LP, WhatsApp). Padrão: onmid.com.br' },
        audience_notes: { type: 'string', description: 'Análise de público-alvo gerada pela Luna (incluída no relatório)' },
      },
      required: ['client_id', 'name', 'objective', 'daily_budget'],
    },
  },
  {
    name: 'create_google_campaign',
    description: `Cria uma campanha COMPLETA de Pesquisa (Search) no Google Ads: orçamento + campanha + grupo de anúncios + palavras-chave + anúncio responsivo (RSA).
A campanha nasce PAUSADA — o gestor revisa no painel e ativa. Lances: Maximizar cliques (sem histórico de conversão ainda).
IMPORTANTE: gere você as palavras-chave (5-15, focadas na intenção de busca do segmento), os títulos (mínimo 3, máx 30 caracteres CADA) e as descrições (mínimo 2, máx 90 caracteres CADA) antes de chamar. Sempre descreva a estrutura ao usuário e espere confirmação antes de criar.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        name: { type: 'string', description: 'Nome da campanha (ex: [ON] Londrigifts - Agro - Pesquisa - Jul/26)' },
        daily_budget: { type: 'number', description: 'Orçamento diário em reais (ex: 30.00)' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Palavras-chave de pesquisa (5-15). Ex: ["brindes agronegócio", "canecas personalizadas agro"]' },
        match_type: { type: 'string', enum: ['broad', 'phrase', 'exact'], description: 'Correspondência das palavras-chave (padrão: phrase)' },
        headlines: { type: 'array', items: { type: 'string' }, description: 'Títulos do anúncio RSA: mínimo 3, máximo 15, ATÉ 30 CARACTERES cada' },
        descriptions: { type: 'array', items: { type: 'string' }, description: 'Descrições do RSA: mínimo 2, máximo 4, ATÉ 90 CARACTERES cada' },
        final_url: { type: 'string', description: 'URL de destino do anúncio (site/LP do cliente)' },
        cities: { type: 'array', items: { type: 'string' }, description: 'Cidades alvo por nome (ex: ["Londrina"]). Sem cidades = Brasil inteiro' },
      },
      required: ['client_id', 'name', 'daily_budget', 'keywords', 'headlines', 'descriptions', 'final_url'],
    },
  },
  // ── Pacote A: execução Meta + Google ──────────────────────────────────────
  {
    name: 'get_meta_structure',
    description: 'Estrutura detalhada do Meta Ads de um cliente: CONJUNTOS e ANÚNCIOS (não só campanhas) com status, orçamento diário, gasto, leads (contagem canônica) e CPL. Use para analisar dentro de uma campanha, achar o conjunto/anúncio certo antes de pausar/ajustar orçamento, ou responder "qual criativo performa melhor".',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        campaign_id: { type: 'string', description: 'Opcional: limita a uma campanha específica' },
        period: { type: 'string', description: 'this_month, last_7d, last_30d, last_month, custom (padrão: last_30d)' },
        date_from: { type: 'string', description: 'YYYY-MM-DD (se period=custom)' },
        date_to: { type: 'string', description: 'YYYY-MM-DD (se period=custom)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'execute_ad_action',
    description: 'Executa uma ação em campanha/conjunto/anúncio de Meta Ads OU Google Ads: pausar, ativar ou ajustar orçamento diário. Para ajustar_orcamento no Meta use objeto_tipo=adset (orçamento fica no conjunto, exceto campanhas CBO); no Google use objeto_tipo=campaign. AJUSTE DE ORÇAMENTO exige confirmação prévia do usuário; pausar/ativar pode executar direto.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente dono da conta' },
        canal: { type: 'string', enum: ['meta', 'google'], description: 'Plataforma' },
        objeto_tipo: { type: 'string', enum: ['campaign', 'adset', 'ad'], description: 'Nível do objeto (Google: campaign ou adset=grupo de anúncios)' },
        objeto_id: { type: 'string', description: 'ID do objeto na plataforma' },
        acao: { type: 'string', enum: ['pausar', 'ativar', 'ajustar_orcamento'], description: 'Ação a executar' },
        novo_orcamento_diario: { type: 'number', description: 'Novo orçamento diário em R$ (obrigatório para ajustar_orcamento)' },
      },
      required: ['client_id', 'canal', 'objeto_tipo', 'objeto_id', 'acao'],
    },
  },
  {
    name: 'duplicate_meta_campaign',
    description: 'Duplica uma campanha Meta Ads completa (com conjuntos e anúncios). A cópia nasce PAUSADA por segurança — avise o usuário para revisar e ativar. Confirme com o usuário antes de executar.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        campaign_id: { type: 'string', description: 'ID da campanha Meta a duplicar' },
        new_name: { type: 'string', description: 'Nome da cópia (opcional; padrão: "[nome original] - Cópia")' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  // ── Pacote C: cérebro do sistema ──────────────────────────────────────────
  {
    name: 'get_optimizer_analysis',
    description: 'Última análise do Otimizador de Campanhas para um cliente (Meta e Google): estado da conta (SAUDAVEL/ATENCAO/CRISE), resumo executivo e recomendações da IA. Use para responder "o que o otimizador recomendou", "como está a saúde da conta".',
    input_schema: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'ID do cliente' } },
      required: ['client_id'],
    },
  },
  {
    name: 'get_client_goals',
    description: 'Metas e planejamento de um cliente: meta de faturamento/leads, CPL meta, ticket médio (tkm) e funil planejado por etapa. Combine com get_meta_campaigns/get_monthly_history para responder "está batendo a meta?".',
    input_schema: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'ID do cliente' } },
      required: ['client_id'],
    },
  },
  {
    name: 'get_lead_attribution',
    description: 'Rastreio rico dos leads de um cliente: de qual campanha/conjunto/anúncio/palavra-chave veio cada lead, origem (Meta/Google/orgânico), região e % de atribuição. Use para "qual criativo trouxe mais leads", "de onde vêm os leads".',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        days: { type: 'number', description: 'Janela em dias (padrão: 30)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_demographics',
    description: 'Demografia AGREGADA das campanhas de um cliente (últimos 30d): idade, gênero e região — Meta e Google. É agregado da conta, não por lead.',
    input_schema: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'ID do cliente' } },
      required: ['client_id'],
    },
  },
  {
    name: 'get_social_monitor',
    description: 'Monitor de redes sociais (Instagram): dias sem postar, seguidores, posts nos últimos 30d, alcance 28d e engajamento — de um cliente ou da carteira toda. Use para "quem está sem postar", "como está o Instagram do cliente X".',
    input_schema: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'Opcional: ID do cliente (sem ele, retorna todos os monitorados)' } },
    },
  },
  {
    name: 'get_ai_costs',
    description: 'Custo de IA do CRM por cliente e por mês (chamadas, tokens, custo em US$) — a base usada pra repassar custo ao cliente.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Opcional: filtra um cliente' },
        mes_ano: { type: 'string', description: 'Opcional: mês YYYY-MM' },
      },
    },
  },
  // ── Pacote B: CRM profundo ────────────────────────────────────────────────
  {
    name: 'search_crm_leads',
    description: 'Busca leads no CRM de um cliente por nome, telefone, etapa/status ou período. Retorna dados completos incluindo atribuição (campanha/origem), temperatura e valor.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        query: { type: 'string', description: 'Nome ou telefone (busca parcial)' },
        status: { type: 'string', description: 'Filtrar por etapa exata do funil' },
        days: { type: 'number', description: 'Só leads criados nos últimos N dias' },
        limit: { type: 'number', description: 'Máximo de resultados (padrão: 20)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_lead_conversation',
    description: 'Lê a conversa de WhatsApp de um lead do CRM (últimas mensagens, quem falou o quê). Use para resumir a conversa, entender o interesse do lead ou responder "o que esse lead falou".',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        lead_id: { type: 'string', description: 'ID do lead (ou use phone)' },
        phone: { type: 'string', description: 'Telefone do lead (alternativa ao lead_id)' },
        limit: { type: 'number', description: 'Máx de mensagens (padrão: 30)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'move_crm_lead',
    description: 'Move um lead do CRM para outra etapa do funil. A etapa PRECISA existir no funil do cliente — se não souber as etapas, use get_crm_stats primeiro. Dispara os eventos de conversão configurados (Meta/Google) quando aplicável.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        lead_id: { type: 'string', description: 'ID do lead (use search_crm_leads para achar)' },
        new_status: { type: 'string', description: 'Etapa de destino (rótulo exato do funil)' },
      },
      required: ['client_id', 'lead_id', 'new_status'],
    },
  },
  {
    name: 'get_crm_stats',
    description: 'Estatísticas do funil de um cliente: leads por etapa (com as etapas REAIS do funil), por origem, por temperatura, fechamentos e faturamento, evolução mensal. Use para "quantos leads viraram venda", "como está o funil".',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        days: { type: 'number', description: 'Janela em dias (padrão: 90)' },
      },
      required: ['client_id'],
    },
  },
  // ── Pacote D: agendamento ─────────────────────────────────────────────────
  {
    name: 'schedule_luna_task',
    description: 'Agenda uma tarefa para a Luna executar sozinha no futuro — única ("amanhã às 9h") ou recorrente (diária/semanal/mensal). A tarefa roda sem usuário presente e o resultado pode ser enviado por WhatsApp. Exemplos: "toda segunda às 8h me manda o resumo da carteira", "amanhã às 14h pausa a campanha X". Horários em fuso de Brasília. Antes de agendar, confirme com o usuário: instrução, horário/recorrência e número de WhatsApp de destino (se envio).',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Nome curto da tarefa (ex: "Resumo semanal da carteira")' },
        instrucao: { type: 'string', description: 'Instrução COMPLETA e autossuficiente do que fazer (a Luna futura não verá esta conversa — inclua cliente, período, formato)' },
        tipo: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly'], description: 'once=uma vez, daily=todo dia, weekly=toda semana, monthly=todo mês' },
        em_minutos: { type: 'number', description: 'Para once RELATIVO ("daqui a 30 minutos", "em 2 horas"): quantos minutos a partir de AGORA. O servidor calcula o horário exato — SEMPRE prefira este campo a run_at quando o usuário falar em tempo relativo.' },
        run_at: { type: 'string', description: 'Para once com horário ABSOLUTO ("amanhã às 9h"): data/hora YYYY-MM-DD HH:MM (Brasília). Não use se em_minutos foi informado.' },
        hora: { type: 'string', description: 'Para recorrente: horário HH:MM (Brasília, padrão 09:00)' },
        dia_semana: { type: 'number', description: 'Para weekly: 0=domingo, 1=segunda ... 6=sábado' },
        dia_mes: { type: 'number', description: 'Para monthly: dia do mês 1-28' },
        whatsapp_phone: { type: 'string', description: 'Número WhatsApp com DDI para receber o resultado (opcional). O ENVIO sai sempre pela instância fixa configurada pelo administrador — você não escolhe a instância.' },
        permitir_acoes: { type: 'boolean', description: 'true APENAS se a tarefa executa ações (pausar campanha, mover lead). false para tarefas de análise/relatório (padrão)' },
      },
      required: ['titulo', 'instrucao', 'tipo'],
    },
  },
  {
    name: 'list_luna_tasks',
    description: 'Lista as tarefas agendadas da Luna: título, recorrência, próxima execução, último resultado.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_luna_task',
    description: 'Cancela (desativa) uma tarefa agendada da Luna pelo ID. Use list_luna_tasks para achar o ID.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'ID da tarefa' } },
      required: ['task_id'],
    },
  },
  // ─── Cobertura total do sistema (leitura + ações finas reusando rotas canônicas) ───
  {
    name: 'list_reports',
    description: 'Lista os relatórios JÁ GERADOS (tela Relatórios) com o link público de cada um. Use para reenviar/compartilhar um relatório existente sem gerar de novo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'Filtrar por cliente (opcional)' },
        limit: { type: 'number', description: 'Máx de relatórios (padrão 15)' },
      },
      required: [],
    },
  },
  {
    name: 'get_report_configs',
    description: 'Lista as automações de relatório mensal por cliente (dia de envio, template, grupo de WhatsApp, ativo/inativo).',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_disparos_campaigns',
    description: 'Lista as campanhas de disparo de WhatsApp (módulo Disparos) com status e progresso.',
    input_schema: {
      type: 'object' as const,
      properties: { status: { type: 'string', description: 'Filtrar por status (opcional): running, paused, done, cancelled...' } },
      required: [],
    },
  },
  {
    name: 'disparo_campaign_action',
    description: 'Pausa, retoma ou cancela uma campanha de disparo de WhatsApp. Ações: pause, resume, cancel. Descreva a campanha e espere confirmação do usuário antes de cancelar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'ID da campanha (use list_disparos_campaigns)' },
        action: { type: 'string', enum: ['pause', 'resume', 'cancel'], description: 'Ação a executar' },
      },
      required: ['campaign_id', 'action'],
    },
  },
  {
    name: 'get_whatsapp_instances',
    description: 'Status de TODAS as instâncias de WhatsApp (Evolution) da agência: conectada/desconectada e a que cliente cada uma está vinculada. Use quando perguntarem se o WhatsApp de alguém caiu.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_crm_inbox',
    description: 'Inbox do CRM de um cliente: conversas recentes com última mensagem e contagem de não lidas.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        limit: { type: 'number', description: 'Máx de conversas (padrão 20)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_followup_status',
    description: 'Regras de follow-up do CRM de um cliente e execuções pendentes/recentes (sequências automáticas de mensagens).',
    input_schema: {
      type: 'object' as const,
      properties: { client_id: { type: 'string', description: 'ID do cliente' } },
      required: ['client_id'],
    },
  },
  {
    name: 'list_automations',
    description: 'Lista as automações do sistema: webhooks de entrada (Automações) e automações da Meta cadastradas.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_email_campaigns',
    description: 'Lista as campanhas de e-mail marketing com status e métricas básicas.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_leadlovers_campaigns',
    description: 'Lista as campanhas de envio de contatos ao Leadlovers com progresso (enviados/pendentes/erros).',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_lp_analytics',
    description: 'Radar de LP: landing pages cadastradas de um cliente (sessões 30d, última visita) e, com lp_id, as estatísticas completas (funil de scroll, cliques, dispositivos).',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        lp_id: { type: 'string', description: 'ID da LP para estatísticas detalhadas (opcional)' },
        days: { type: 'number', description: 'Janela em dias para as estatísticas (padrão 30)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_link_redirects',
    description: 'Links rastreados /r/ (encurtador com captura de UTM/clique): lista com contagem de cliques.',
    input_schema: {
      type: 'object' as const,
      properties: { client_id: { type: 'string', description: 'Filtrar por cliente (opcional)' } },
      required: [],
    },
  },
  {
    name: 'get_ig_posts',
    description: 'Posts recentes do Instagram de um cliente com métricas (alcance, curtidas, comentários, salvos). Mais detalhado que o get_social_monitor.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        period: { type: 'string', description: 'Período: last_7d, last_14d, last_30d (padrão), this_month, last_month' },
        limit: { type: 'number', description: 'Máx de posts (padrão 12)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_optimizer_queue',
    description: 'Fila global de decisões do Otimizador: recomendações pendentes por conta (o que precisa de ação agora). Sem client_id retorna a fila de todos.',
    input_schema: {
      type: 'object' as const,
      properties: { client_id: { type: 'string', description: 'Filtrar por cliente (opcional)' } },
      required: [],
    },
  },
  {
    name: 'get_activity_logs',
    description: 'Últimos registros do log de auditoria do sistema (quem fez o quê e quando).',
    input_schema: {
      type: 'object' as const,
      properties: { limit: { type: 'number', description: 'Máx de registros (padrão 30)' } },
      required: [],
    },
  },
];

// --- Tool executors ---

// Origem canônica da aplicação (mesmo padrão do webhookOrigin) — usada pra montar o
// link público do relatório e pra chamar a rota run-once por HTTP.
function appOrigin(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://reports.onmid.app')
    .trim().replace(/\/$/, '');
}

// GET numa rota interna do próprio sistema (reuso da lógica canônica em vez de duplicar).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchInternal(path: string): Promise<any | null> {
  try {
    const r = await fetch(`${appOrigin()}${path}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Remove campos pesados/sensíveis de uma linha antes de devolver pra IA.
function stripFields(row: Record<string, unknown>, drop: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (drop.includes(k)) continue;
    if (typeof v === 'string' && v.length > 300) { out[k] = v.slice(0, 300) + '…'; continue; }
    out[k] = v;
  }
  return out;
}

// Converte o período nomeado da Luna (this_month/last_month/last_30d/last_7d/custom)
// em datas YYYY-MM-DD no fuso de Brasília — mesma semântica dos relatórios da plataforma.
function resolvePeriodDates(
  period: string, dateFrom?: string, dateTo?: string,
): { from: string; to: string } {
  if (period === 'custom' && dateFrom) return { from: dateFrom, to: dateTo || dateFrom };
  // "Hoje" em BRT (UTC-3)
  const nowBrt = new Date(Date.now() - 3 * 3600_000);
  const y = nowBrt.getUTCFullYear();
  const m = nowBrt.getUTCMonth();
  const d = nowBrt.getUTCDate();
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  switch (period) {
    case 'last_month': {
      const first = new Date(Date.UTC(y, m - 1, 1));
      const last = new Date(Date.UTC(y, m, 0));
      return { from: fmt(first), to: fmt(last) };
    }
    case 'last_7d':
      return { from: fmt(new Date(Date.UTC(y, m, d - 6))), to: fmt(new Date(Date.UTC(y, m, d))) };
    case 'last_30d':
      return { from: fmt(new Date(Date.UTC(y, m, d - 29))), to: fmt(new Date(Date.UTC(y, m, d))) };
    case 'this_month':
    default:
      return { from: fmt(new Date(Date.UTC(y, m, 1))), to: fmt(new Date(Date.UTC(y, m, d))) };
  }
}

// Rótulo humano do relatório conforme o template.
function reportLabel(template: string): string {
  if (template === 'delivery') return 'Relatório de Delivery';
  if (template === 'social') return 'Relatório de Redes Sociais';
  return 'Relatório de Performance';
}

// Gera o relatório REAL da plataforma — o MESMO gerador da tela de Relatórios. Delega pra
// rota /api/reports/run-once (que tem maxDuration=300 próprio, isolando o fan-out pesado
// do orçamento do chat) e devolve o token público + o link /relatorio/[token]. O template
// vem do report_config do cliente quando existe; senão 'performance' (padrão da plataforma).
async function buildRealReport(
  pool: ReturnType<typeof makeServerPool>,
  clientId: string,
  period: string,
  dateFrom?: string,
  dateTo?: string,
  templateOverride?: string,
): Promise<{ token: string; url: string; clientName: string; template: string }> {
  const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [clientId]);
  if (!clientRows[0]) throw new Error('Cliente não encontrado.');
  const clientName = clientRows[0].name as string;

  let template = templateOverride || '';
  if (!template) {
    try {
      const { rows } = await pool.query(
        'SELECT template FROM public.report_configs WHERE client_id = $1 ORDER BY active DESC LIMIT 1',
        [clientId],
      );
      template = (rows[0]?.template as string) || 'performance';
    } catch { template = 'performance'; }
  }

  const { from, to } = resolvePeriodDates(period, dateFrom, dateTo);
  const origin = appOrigin();
  const res = await fetch(`${origin}/api/reports/run-once`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, from, to, template }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `Falha ao gerar o relatório (HTTP ${res.status}).`);
  }
  const data = await res.json() as { public_token: string };
  if (!data.public_token) throw new Error('O gerador não retornou o relatório.');
  return { token: data.public_token, url: `${origin}/relatorio/${data.public_token}`, clientName, template };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function execSystemTool(
  name: string,
  input: Record<string, any>,
  onEvent?: (event: Record<string, unknown>) => void,
  callerRole?: string
): Promise<string> {
  const pool = makeServerPool();
  try {
    if (name === 'list_clients') {
      const { rows } = await pool.query('SELECT id, name, segment, status FROM public.clients ORDER BY name ASC');
      if (rows.length === 0) return 'Nenhum cliente cadastrado.';
      return JSON.stringify(rows);
    }

    if (name === 'get_client_accounts') {
      let clientId = input.client_id as string | undefined;
      if (!clientId && input.client_name) {
        const { rows } = await pool.query('SELECT id FROM public.clients WHERE name ILIKE $1 LIMIT 1', [`%${input.client_name}%`]);
        clientId = rows[0]?.id;
      }
      if (!clientId) return 'Cliente não encontrado. Use list_clients para ver os clientes.';
      const { rows } = await pool.query(
        'SELECT platform, account_id, account_name, currency FROM public.client_account_links WHERE client_id = $1 ORDER BY platform',
        [clientId]
      );
      if (rows.length === 0) return `Nenhuma conta vinculada ao cliente ${clientId}.`;
      return JSON.stringify(rows);
    }

    if (name === 'get_crm_data') {
      const limit = Number(input.limit) || 20;
      const clientId = input.client_id as string | undefined;
      // Colunas REAIS de crm_leads são nome/numero (a query antiga usava name/phone/
      // email e estourava "column does not exist" — a Luna nunca conseguia ler o CRM).
      // Aliases mantêm o shape que o prompt espera; origem/campanha vêm do rastreio.
      const cols = `nome AS name, numero AS phone, email, status, origin,
                    campaign_name, regiao_uf, created_at`;
      const colsFallback = `nome AS name, numero AS phone, status, created_at`;
      let rows: unknown[] = [];
      try {
        const r = clientId
          ? await pool.query(`SELECT ${cols} FROM public.crm_leads WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`, [clientId, limit])
          : await pool.query(`SELECT ${cols}, client_id FROM public.crm_leads ORDER BY created_at DESC LIMIT $1`, [limit]);
        rows = r.rows;
      } catch {
        // Colunas do rastreio podem não existir em instalação antiga — cai pro básico
        const r = clientId
          ? await pool.query(`SELECT ${colsFallback} FROM public.crm_leads WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`, [clientId, limit])
          : await pool.query(`SELECT ${colsFallback}, client_id FROM public.crm_leads ORDER BY created_at DESC LIMIT $1`, [limit]);
        rows = r.rows;
      }
      if (rows.length === 0) return 'Nenhum lead encontrado.';
      return JSON.stringify(rows);
    }

    if (name === 'get_meta_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const metaPeriod = resolveMetaPeriod(period, (input.date_from as string) ?? '', (input.date_to as string) ?? '');

      // Get client's Meta account links
      const { rows: links } = await pool.query(
        "SELECT connection_id, account_id, account_name FROM public.client_account_links WHERE client_id = $1 AND platform = 'meta_ads'",
        [clientId]
      );

      // Also check legacy meta_ads_connections
      const { rows: legacyLinks } = await pool.query(
        'SELECT account_ids FROM public.meta_ads_connections WHERE client_id = $1 LIMIT 1',
        [clientId]
      ).catch(() => ({ rows: [] }));

      // Get all connected Meta tokens
      const { rows: metaConns } = await pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'");
      const { rows: globalConn } = await pool.query("SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'").catch(() => ({ rows: [] }));
      if (globalConn[0]?.access_token) metaConns.push({ id: 'legacy-global', access_token: globalConn[0].access_token, app_id: null, token_expiry: null });

      if (metaConns.length === 0) return 'Nenhuma conexão Meta Ads ativa.';

      const campaigns: Record<string, unknown>[] = [];

      await Promise.allSettled(metaConns.map(async (conn) => {
        const token = await getFreshMetaToken(conn);
        // Determine allowed accounts for this connection
        const allowed = links.filter(l => l.connection_id === conn.id).map(l => l.account_id);
        // Add legacy account IDs
        if (conn.id === 'legacy-global' && legacyLinks[0]?.account_ids) {
          for (const aid of legacyLinks[0].account_ids) allowed.push(aid);
        }
        if (links.length > 0 && allowed.length === 0) return; // Wrong connection for this client

        const acctToUse: Array<{ id: string; name: string }> = allowed.length > 0
          ? allowed.map(id => ({ id, name: links.find(l => l.account_id === id)?.account_name ?? id }))
          : [];

        // If no specific accounts and no links at all, try fetching all accounts
        if (acctToUse.length === 0 && links.length === 0) {
          const r = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&limit=100&access_token=${token}`);
          if (!r.ok) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = await r.json() as { data?: any[] };
          for (const a of d.data ?? []) acctToUse.push(a);
        }

        await Promise.allSettled(acctToUse.map(async (account) => {
          const acctNode = account.id.startsWith('act_') ? account.id : `act_${account.id}`;
          const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
          url.searchParams.set('level', 'campaign');
          url.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,actions');
          applyMetaDateToUrl(url, metaPeriod);
          url.searchParams.set('sort', 'spend_descending');
          url.searchParams.set('limit', '30');
          url.searchParams.set('access_token', token);

          const statusUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/campaigns`);
          statusUrl.searchParams.set('fields', 'id,effective_status,daily_budget');
          statusUrl.searchParams.set('limit', '200');
          statusUrl.searchParams.set('access_token', token);

          const [insRes, stRes] = await Promise.all([fetch(url.toString()), fetch(statusUrl.toString())]);
          if (!insRes.ok) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ins = await insRes.json() as { data?: any[] };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const statusMap: Record<string, string> = {};
          if (stRes.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = await stRes.json() as { data?: any[] };
            for (const c of st.data ?? []) statusMap[c.id] = c.effective_status ?? 'ACTIVE';
          }
          for (const row of ins.data ?? []) {
            const spend = parseFloat(row.spend || '0');
            if (spend <= 0) continue;
            const impressions = parseInt(row.impressions || '0', 10);
            const clicks = parseInt(row.clicks || '0', 10);
            // Contagem canônica (1 por família de resultado) — somar os aliases inflava 2-3x
            const leads = countMetaResults(row.actions ?? []);
            campaigns.push({
              id: row.campaign_id, name: row.campaign_name, platform: 'meta',
              accountName: account.name, status: statusMap[row.campaign_id] ?? 'ACTIVE',
              spend, impressions, clicks, leads,
              ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0',
              cpl: leads > 0 ? (spend / leads).toFixed(2) : '0',
            });
          }
        }));
      }));

      if (campaigns.length === 0) return 'Nenhuma campanha Meta encontrada para esse período. Verifique se a conta está vinculada corretamente.';
      return JSON.stringify(campaigns.slice(0, 30));
    }

    if (name === 'get_google_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const gaqlPeriod = resolveGaqlPeriod(period, (input.date_from as string) ?? '', (input.date_to as string) ?? '');

      const { rows: links } = await pool.query(
        "SELECT account_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('google_ads','google')",
        [clientId]
      );
      if (links.length === 0) return 'Nenhuma conta Google Ads vinculada a esse cliente.';

      const accountIds = [...new Set(links.map((l) => l.account_id.replace(/\D/g, '')).filter(Boolean))];
      const campaigns: Record<string, unknown>[] = [];
      const failures: string[] = [];

      await Promise.allSettled(accountIds.map(async (accountId) => {
        const found = await lunaGoogleSearch(accountId,
          `SELECT campaign.id, campaign.name, campaign.status,
                  metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
                FROM campaign
                WHERE ${gaqlPeriod}
                  AND campaign.status IN ('ENABLED', 'PAUSED')
                  AND metrics.cost_micros > 0
                ORDER BY metrics.cost_micros DESC LIMIT 30`);
        if (!found) { failures.push(accountId); return; }
        for (const row of found.results) {
          const campaign = row.campaign ?? {};
          const metrics = row.metrics ?? {};
          const spend = Number(metrics.costMicros ?? 0) / 1_000_000;
          if (spend <= 0) continue;
          const clicks = Number(metrics.clicks ?? 0);
          const impressions = Number(metrics.impressions ?? 0);
          const leads = Number(metrics.conversions ?? 0);
          campaigns.push({
            id: String(campaign.id), name: campaign.name, platform: 'google',
            accountId, status: campaign.status ?? 'ENABLED', spend, impressions, clicks, leads,
            ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0',
            cpl: leads > 0 ? (spend / leads).toFixed(2) : '0',
          });
        }
      }));

      if (campaigns.length === 0) {
        return failures.length > 0
          ? `Não consegui acessar a(s) conta(s) Google ${failures.join(', ')} (token/permissão MCC). Verifique a conexão Google em Integrações.`
          : 'Nenhuma campanha Google com gasto nesse período.';
      }
      return JSON.stringify(campaigns.slice(0, 30));
    }

    if (name === 'get_monthly_history') {
      const clientId = input.client_id as string;
      const dateFrom = String(input.date_from ?? '');
      const dateTo = String(input.date_to ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return 'Informe date_from e date_to no formato YYYY-MM-DD.';
      }

      type MonthAgg = { invest: number; leads: number; impressions: number; clicks: number };
      const emptyAgg = (): MonthAgg => ({ invest: 0, leads: 0, impressions: 0, clicks: 0 });
      const metaByMonth = new Map<string, MonthAgg>();
      const googleByMonth = new Map<string, MonthAgg>();
      const crmByMonth = new Map<string, number>();
      const notes: string[] = [];

      // ── Meta Ads: 1 chamada por conta com time_increment=monthly ──
      const { rows: metaLinks } = await pool.query(
        "SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'meta_ads'",
        [clientId]
      );
      const { rows: metaConns } = await pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'");
      const { rows: globalConn } = await pool.query("SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'").catch(() => ({ rows: [] }));
      if (globalConn[0]?.access_token) metaConns.push({ id: 'legacy-global', access_token: globalConn[0].access_token, app_id: null, token_expiry: null });

      const metaAccountsSeen = new Set<string>();
      await Promise.allSettled(metaConns.map(async (conn) => {
        const allowed = metaLinks.filter(l => !l.connection_id || l.connection_id === conn.id || conn.id === 'legacy-global').map(l => l.account_id);
        if (allowed.length === 0) return;
        const token = await getFreshMetaToken(conn);
        await Promise.allSettled(allowed.map(async (accountId: string) => {
          const acctNode = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
          if (metaAccountsSeen.has(acctNode)) return;
          const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
          url.searchParams.set('level', 'account');
          url.searchParams.set('fields', 'spend,impressions,clicks,actions');
          url.searchParams.set('time_range', JSON.stringify({ since: dateFrom, until: dateTo }));
          url.searchParams.set('time_increment', 'monthly');
          url.searchParams.set('limit', '60');
          url.searchParams.set('access_token', token);
          const res = await fetch(url.toString());
          if (!res.ok) return;
          metaAccountsSeen.add(acctNode);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = await res.json() as { data?: any[] };
          for (const row of data.data ?? []) {
            const mes = String(row.date_start ?? '').slice(0, 7); // YYYY-MM
            if (!mes) continue;
            const agg = metaByMonth.get(mes) ?? emptyAgg();
            agg.invest += parseFloat(row.spend || '0');
            agg.impressions += parseInt(row.impressions || '0', 10);
            agg.clicks += parseInt(row.clicks || '0', 10);
            agg.leads += countMetaResults(row.actions ?? []);
            metaByMonth.set(mes, agg);
          }
        }));
      }));
      if (metaLinks.length > 0 && metaAccountsSeen.size === 0) {
        notes.push('Meta Ads: nenhuma conta respondeu (token/permissão) — valores Meta podem estar faltando.');
      }

      // ── Google Ads: GAQL com segments.month ──
      const { rows: gLinks } = await pool.query(
        "SELECT account_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('google_ads','google')",
        [clientId]
      );
      if (gLinks.length > 0) {
        const gAccountIds = [...new Set(gLinks.map((l) => l.account_id.replace(/\D/g, '')).filter(Boolean))];
        let gOk = 0;
        await Promise.allSettled(gAccountIds.map(async (accountId) => {
          const found = await lunaGoogleSearch(accountId,
            `SELECT segments.month, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
             FROM customer
             WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`);
          if (!found) return;
          gOk++;
          for (const row of found.results) {
            const mes = String(row.segments?.month ?? '').slice(0, 7);
            if (!mes) continue;
            const m = row.metrics ?? {};
            const agg = googleByMonth.get(mes) ?? emptyAgg();
            agg.invest += Number(m.costMicros ?? 0) / 1_000_000;
            agg.impressions += Number(m.impressions ?? 0);
            agg.clicks += Number(m.clicks ?? 0);
            agg.leads += Number(m.conversions ?? 0);
            googleByMonth.set(mes, agg);
          }
        }));
        if (gOk === 0) notes.push('Google Ads: nenhuma conta respondeu (token/permissão MCC) — valores Google podem estar faltando.');
      }

      // ── CRM: leads que ENTRARAM no funil, por mês ──
      try {
        const { rows } = await pool.query(
          `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes, COUNT(*)::int AS total
           FROM public.crm_leads
           WHERE client_id = $1 AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')
           GROUP BY 1 ORDER BY 1`,
          [clientId, dateFrom, dateTo]
        );
        for (const r of rows) crmByMonth.set(r.mes, r.total);
      } catch { notes.push('CRM: não foi possível contar leads por mês.'); }

      // ── Merge ──
      const months = [...new Set([...metaByMonth.keys(), ...googleByMonth.keys(), ...crmByMonth.keys()])].sort();
      if (months.length === 0) return 'Nenhum dado encontrado nesse intervalo (Meta, Google ou CRM).';
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const result = months.map(mes => {
        const meta = metaByMonth.get(mes);
        const goog = googleByMonth.get(mes);
        const investTotal = (meta?.invest ?? 0) + (goog?.invest ?? 0);
        const leadsAds = (meta?.leads ?? 0) + (goog?.leads ?? 0);
        return {
          mes,
          meta: meta ? { investimento: round2(meta.invest), leads: meta.leads, cpl: meta.leads > 0 ? round2(meta.invest / meta.leads) : null, impressoes: meta.impressions, cliques: meta.clicks } : null,
          google: goog ? { investimento: round2(goog.invest), leads: goog.leads, cpl: goog.leads > 0 ? round2(goog.invest / goog.leads) : null, impressoes: goog.impressions, cliques: goog.clicks } : null,
          crm_leads_novos: crmByMonth.get(mes) ?? 0,
          investimento_total: round2(investTotal),
          leads_ads_total: leadsAds,
          cpl_geral: leadsAds > 0 ? round2(investTotal / leadsAds) : null,
        };
      });
      return JSON.stringify({
        cliente: clientId,
        intervalo: { de: dateFrom, ate: dateTo },
        observacao: 'Leads Meta = formulário + conversa iniciada (contagem canônica do Gerenciador, sem duplicar aliases). crm_leads_novos = leads que entraram no CRM no mês (WhatsApp/formulários rastreados).',
        avisos: notes,
        meses: result,
      });
    }

    if (name === 'get_account_balances') {
      const clientId = input.client_id as string;
      const { rows: links } = await pool.query(
        "SELECT platform, connection_id FROM public.client_account_links WHERE client_id = $1",
        [clientId]
      );
      if (links.length === 0) return 'Nenhuma conta vinculada.';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const balances: Record<string, unknown> = {};
      const meta = links.find((l) => l.platform === 'meta_ads' || l.platform === 'meta');
      const goog = links.find((l) => l.platform === 'google_ads' || l.platform === 'google');
      if (meta?.connection_id) {
        try { const r = await fetch(`${baseUrl}/api/meta/account-balances?connectionId=${meta.connection_id}`); if (r.ok) balances.meta = await r.json(); } catch { /* ignore */ }
      }
      if (goog?.connection_id) {
        try { const r = await fetch(`${baseUrl}/api/google/account-balances?connectionId=${goog.connection_id}`); if (r.ok) balances.google = await r.json(); } catch { /* ignore */ }
      }
      return JSON.stringify(balances);
    }

    if (name === 'update_meta_campaign_status') {
      const { campaign_id, status, client_id } = input as { campaign_id: string; status: 'PAUSED' | 'ACTIVE'; client_id: string };
      const { rows: links } = await pool.query(
        "SELECT connection_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('meta_ads','meta') LIMIT 1",
        [client_id]
      );
      if (!links[0]) return 'Nenhuma conexão Meta encontrada para esse cliente.';
      const { rows: connRows } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1', [links[0].connection_id]);
      if (!connRows[0]) return 'Conexão Meta não encontrada.';
      const token = await getFreshMetaToken(connRows[0]);
      const res = await fetch(`https://graph.facebook.com/v21.0/${campaign_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, access_token: token }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        return `Erro ao atualizar campanha: ${err.error?.message ?? `HTTP ${res.status}`}`;
      }
      // Log to activity log
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS public.client_activity_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'system', event_type TEXT NOT NULL, description TEXT NOT NULL, actor_name TEXT, actor_source TEXT NOT NULL DEFAULT 'system', campaign_id TEXT, campaign_name TEXT, old_value TEXT, new_value TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await pool.query(
          `INSERT INTO public.client_activity_log (client_id, platform, event_type, description, actor_name, actor_source, campaign_id, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [client_id, 'meta', status === 'PAUSED' ? 'campaign_paused' : 'campaign_activated',
           `Campanha ${campaign_id} ${status === 'PAUSED' ? 'pausada' : 'ativada'} via Luna`,
           'Luna IA', 'luna', campaign_id, status === 'PAUSED' ? 'ACTIVE' : 'PAUSED', status]
        );
      } catch { /* ignore log errors */ }
      return `Campanha ${campaign_id} ${status === 'PAUSED' ? 'pausada' : 'ativada'} com sucesso.`;
    }

    if (name === 'generate_client_report') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const { token, url, clientName, template } = await buildRealReport(
        pool, clientId, period,
        input.date_from as string | undefined, input.date_to as string | undefined,
        input.template as string | undefined,
      );
      const label = reportLabel(template);
      onEvent?.({ type: 'report_link', token, url, clientName, label: `${label} — ${clientName}` });
      return `✅ ${label} de ${clientName} gerado pelo gerador oficial da plataforma (todas as páginas).\n\n🔗 Link do relatório: ${url}\n\nO card no chat tem o botão "Baixar PDF" para exportar o arquivo completo.`;
    }

    if (name === 'generate_report_pdf') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const { token, url, clientName, template } = await buildRealReport(
        pool, clientId, period,
        input.date_from as string | undefined, input.date_to as string | undefined,
        input.template as string | undefined,
      );
      const label = reportLabel(template);
      const filename = `Relatorio_${clientName.replace(/\s+/g, '_')}_${period}.pdf`;
      if (onEvent) {
        onEvent({ type: 'report_link', token, url, clientName, label: `${label} — ${clientName}` });
        // O PDF fiel (mesma qualidade da tela de Relatórios) só é renderizável no navegador —
        // pede pro chat gerar e baixar o arquivo completo.
        onEvent({ type: 'render_report_pdf', mode: 'download', token, filename, clientName });
        return `✅ ${label} de ${clientName} gerado. Estou preparando o PDF completo (todas as páginas) para download aqui no chat — o arquivo aparece em instantes.\n🔗 Link do relatório: ${url}`;
      }
      // Headless (sem navegador) → não há como renderizar o PDF; devolve o link.
      return `✅ ${label} de ${clientName} gerado: ${url}`;
    }

    if (name === 'list_zapi_clients') {
      const { rows } = await pool.query('SELECT id, name, instance_id, active FROM public.zapi_clients ORDER BY name ASC');
      if (rows.length === 0) return 'Nenhuma conexão Z-API cadastrada. Configure uma em Disparos.';
      return JSON.stringify(rows.map(r => ({ id: r.id, name: r.name, instance_id: r.instance_id, active: r.active })));
    }

    if (name === 'send_report_pdf_whatsapp') {
      const { client_id, phone, period = 'this_month', caption, zapi_client_id } = input as {
        client_id: string; phone: string; period?: string; caption?: string; zapi_client_id?: string;
      };
      const format = (input.format as string) === 'pdf' ? 'pdf' : 'link';

      // Gera o relatório REAL pelo gerador da plataforma (link + token).
      const { token, url, clientName, template } = await buildRealReport(
        pool, client_id, period,
        input.date_from as string | undefined, input.date_to as string | undefined,
        input.template as string | undefined,
      );
      const label = reportLabel(template);
      const filename = `Relatorio_${clientName.replace(/\s+/g, '_')}_${period}.pdf`;

      // Formato PDF (só no chat, com navegador): o front renderiza o PDF completo e sobe
      // pra /api/agent/send-report-pdf, que envia via Z-API. Sem navegador (agendador),
      // cai no envio do LINK abaixo.
      if (format === 'pdf' && onEvent) {
        onEvent({ type: 'report_link', token, url, clientName, label: `${label} — ${clientName}` });
        onEvent({
          type: 'render_report_pdf', mode: 'whatsapp', token, filename, clientName,
          phone, zapi_client_id: zapi_client_id ?? null, caption: caption ?? null,
        });
        return `✅ ${label} de ${clientName} gerado. Estou renderizando o PDF completo no navegador e enviando para ${phone} via WhatsApp — confirmo em instantes.\n🔗 Link do relatório: ${url}`;
      }

      // Formato LINK (padrão) — resolve a Z-API e manda o link do relatório completo.
      let zapiConn: { instance_id: string; token: string; security_token?: string } | null = null;
      if (zapi_client_id) {
        const { rows } = await pool.query('SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1', [zapi_client_id]);
        if (rows[0]) zapiConn = rows[0];
      }
      if (!zapiConn) {
        const { rows } = await pool.query("SELECT instance_id, token, security_token FROM public.zapi_clients WHERE active = true ORDER BY created_at ASC LIMIT 1");
        if (rows[0]) zapiConn = rows[0];
      }
      if (!zapiConn) {
        const { rows } = await pool.query("SELECT config FROM public.agent_external_tools WHERE type = 'zapi_whatsapp' AND enabled = true LIMIT 1");
        if (rows[0]?.config?.instance_id) {
          zapiConn = { instance_id: rows[0].config.instance_id, token: rows[0].config.token, security_token: rows[0].config.security_token };
        }
      }
      if (!zapiConn) return `⚠️ Relatório gerado (${url}) mas nenhuma conexão Z-API foi encontrada para enviar. Use list_zapi_clients.`;

      const msg = caption ?? `📊 *${label} — ${clientName}*\n\nSeu relatório está pronto!\n\nAcesse aqui: ${url}`;
      onEvent?.({ type: 'report_link', token, url, clientName, label: `${label} — ${clientName}` });
      const result = await sendText(
        { instanceId: zapiConn.instance_id, token: zapiConn.token, clientToken: zapiConn.security_token },
        phone, msg,
      );
      if (result.ok) return `✅ ${label} de ${clientName} enviado para ${phone} (link do relatório completo).\n🔗 ${url}`;
      return `❌ Relatório gerado mas falha ao enviar no WhatsApp: ${result.error}.\n🔗 Link: ${url}`;
    }

    // ─── Cobertura total do sistema ────────────────────────────────────────────

    if (name === 'list_reports') {
      const limit = Math.min(Number(input.limit) || 15, 50);
      const params: unknown[] = [];
      let where = '';
      if (input.client_id) { params.push(input.client_id); where = 'WHERE client_id = $1'; }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT id, client_id, client_name, title, period_from, period_to, generated_by, public_token, created_at
           FROM public.diagnostic_reports ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      if (rows.length === 0) return 'Nenhum relatório gerado ainda.';
      const origin = appOrigin();
      return JSON.stringify(rows.map(r => ({
        id: r.id, cliente: r.client_name, titulo: r.title,
        periodo: `${r.period_from} a ${r.period_to}`, gerado_por: r.generated_by,
        criado_em: r.created_at, link: `${origin}/relatorio/${r.public_token}`,
      })));
    }

    if (name === 'get_report_configs') {
      const { rows } = await pool.query(
        `SELECT rc.id, rc.client_id, c.name AS client_name, rc.template, rc.send_day, rc.active,
                rc.whatsapp_group, rc.zapi_client_id
           FROM public.report_configs rc
           JOIN public.clients c ON c.id = rc.client_id
          ORDER BY c.name ASC`,
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (rows.length === 0) return 'Nenhuma automação de relatório mensal configurada.';
      return JSON.stringify(rows);
    }

    if (name === 'list_disparos_campaigns') {
      const { rows } = await pool.query(
        `SELECT c.*, cl.name AS conexao FROM public.zapi_campaigns c
           JOIN public.zapi_clients cl ON cl.id = c.client_id
          ORDER BY c.created_at DESC LIMIT 40`,
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      let list = rows;
      if (input.status) list = list.filter(r => String(r.status) === String(input.status));
      if (list.length === 0) return 'Nenhuma campanha de disparo encontrada.';
      // Corta textos de mensagem/listas de números — a IA só precisa do status/progresso.
      return JSON.stringify(list.map(r => stripFields(r as Record<string, unknown>, ['message', 'messages', 'image_urls', 'numbers', 'numbers_raw'])));
    }

    if (name === 'disparo_campaign_action') {
      const { campaign_id, action } = input as { campaign_id: string; action: string };
      if (!['pause', 'resume', 'cancel'].includes(action)) return 'Ação inválida. Use pause, resume ou cancel.';
      // Reusa a rota canônica do módulo Disparos (mesma semântica dos botões da tela).
      const res = await fetch(`${appOrigin()}/api/disparos/campaigns/${campaign_id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).catch(() => null);
      if (!res || !res.ok) return `❌ Falha ao executar "${action}" na campanha (HTTP ${res?.status ?? 'sem resposta'}).`;
      const labels: Record<string, string> = { pause: 'pausada', resume: 'retomada', cancel: 'cancelada' };
      return `✅ Campanha de disparo ${labels[action]} com sucesso.`;
    }

    if (name === 'get_whatsapp_instances') {
      // Rota canônica do admin (mesma da aba Instâncias em Configurações).
      const data = await fetchInternal('/api/admin/instances');
      if (!data?.instances) return 'Não consegui consultar as instâncias na VPS Evolution.';
      const list = (data.instances as Record<string, unknown>[]).map(i => ({
        nome: i.name, status: i.status, numero: i.number ?? null,
        vinculos: i.vinculos, ativa: i.active,
      }));
      if (list.length === 0) return 'Nenhuma instância encontrada na VPS.';
      return JSON.stringify(list);
    }

    if (name === 'get_crm_inbox') {
      const clientId = input.client_id as string;
      const limit = Math.min(Number(input.limit) || 20, 50);
      const { rows } = await pool.query(
        `SELECT l.id, l.nome, l.numero, l.status,
                m.text AS ultima_mensagem, m.direction AS ultima_direcao, m.created_at AS ultima_em,
                (SELECT COUNT(*)::int FROM public.crm_messages m2
                  WHERE m2.lead_id = l.id AND m2.direction = 'in'
                    AND m2.created_at > COALESCE(l.chat_read_at, '-infinity'::timestamptz)) AS nao_lidas
           FROM public.crm_leads l
           JOIN LATERAL (
             SELECT text, direction, created_at FROM public.crm_messages m
              WHERE m.lead_id = l.id ORDER BY created_at DESC LIMIT 1
           ) m ON true
          WHERE l.client_id = $1
          ORDER BY m.created_at DESC LIMIT $2`,
        [clientId, limit],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (rows.length === 0) return 'Nenhuma conversa encontrada no CRM deste cliente.';
      return JSON.stringify(rows.map(r => ({
        ...r, ultima_mensagem: String(r.ultima_mensagem ?? '').slice(0, 150),
      })));
    }

    if (name === 'get_followup_status') {
      const clientId = input.client_id as string;
      const { rows: regras } = await pool.query(
        `SELECT r.* FROM public.crm_followup_regras r WHERE r.client_id = $1 ORDER BY r.created_at DESC`,
        [clientId],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const { rows: execucoes } = await pool.query(
        `SELECT e.* FROM public.crm_followup_execucoes e
          WHERE e.client_id = $1 ORDER BY e.created_at DESC LIMIT 30`,
        [clientId],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (regras.length === 0 && execucoes.length === 0) return 'Nenhuma regra ou execução de follow-up para este cliente.';
      return JSON.stringify({
        regras: regras.map(r => stripFields(r as Record<string, unknown>, [])),
        execucoes_recentes: execucoes.map(e => stripFields(e as Record<string, unknown>, [])),
      });
    }

    if (name === 'list_automations') {
      const { rows: webhooks } = await pool.query(
        `SELECT id, name, description, enabled, created_at FROM public.webhook_configs ORDER BY created_at DESC`,
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const { rows: metaAuto } = await pool.query(
        `SELECT * FROM public.meta_automations ORDER BY created_at DESC LIMIT 30`,
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (webhooks.length === 0 && metaAuto.length === 0) return 'Nenhuma automação cadastrada.';
      return JSON.stringify({
        webhooks_de_entrada: webhooks,
        automacoes_meta: metaAuto.map(a => stripFields(a as Record<string, unknown>, [])),
      });
    }

    if (name === 'list_email_campaigns') {
      const data = await fetchInternal('/api/email/campaigns');
      if (!Array.isArray(data) || data.length === 0) return 'Nenhuma campanha de e-mail encontrada.';
      return JSON.stringify((data as Record<string, unknown>[]).map(c => stripFields(c, ['html', 'body', 'content'])));
    }

    if (name === 'list_leadlovers_campaigns') {
      const data = await fetchInternal('/api/leadlovers/campaigns');
      if (!Array.isArray(data) || data.length === 0) return 'Nenhuma campanha Leadlovers encontrada.';
      // Nunca expor credenciais do webhook pra IA.
      return JSON.stringify((data as Record<string, unknown>[]).map(c =>
        stripFields(c, ['webhook_url', 'auth_key', 'machine_code', 'email_sequence_code', 'sequence_level_code'])));
    }

    if (name === 'get_lp_analytics') {
      const clientId = input.client_id as string;
      const { rows: lps } = await pool.query(
        `SELECT lp.id, lp.name, lp.url, lp.active, lp.created_at,
                (SELECT COUNT(*)::int FROM public.lp_sessions s
                  WHERE s.lp_id = lp.id AND s.created_at > NOW() - INTERVAL '30 days') AS sessions_30d,
                (SELECT MAX(s.created_at) FROM public.lp_sessions s WHERE s.lp_id = lp.id) AS last_session_at
           FROM public.client_landing_pages lp
          WHERE lp.client_id = $1 ORDER BY lp.created_at DESC`,
        [clientId],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (lps.length === 0) return 'Nenhuma landing page cadastrada no Radar de LP deste cliente.';
      if (input.lp_id) {
        const days = Math.min(Math.max(Number(input.days) || 30, 1), 90);
        const stats = await fetchInternal(`/api/clients/${clientId}/landing-pages/${input.lp_id}/stats?days=${days}`);
        return JSON.stringify({ lps, stats: stats ?? 'estatísticas indisponíveis' });
      }
      return JSON.stringify(lps);
    }

    if (name === 'get_link_redirects') {
      const qs = input.client_id ? `?clientId=${encodeURIComponent(input.client_id as string)}` : '';
      const data = await fetchInternal(`/api/link-redirects${qs}`);
      if (!Array.isArray(data) || data.length === 0) return 'Nenhum link rastreado /r/ encontrado.';
      return JSON.stringify((data as Record<string, unknown>[]).map(l => stripFields(l, [])));
    }

    if (name === 'get_ig_posts') {
      const period = (input.period as string) || 'last_30d';
      const limit = Math.min(Number(input.limit) || 12, 30);
      const data = await fetchInternal(
        `/api/meta/ig-posts?clientIds=${encodeURIComponent(input.client_id as string)}&period=${period}&limit=${limit}`,
      );
      if (!data) return 'Não consegui buscar os posts do Instagram (conta não vinculada ou erro na Graph).';
      return JSON.stringify(data).slice(0, 20000);
    }

    if (name === 'get_optimizer_queue') {
      const qs = input.client_id ? `?clientId=${encodeURIComponent(input.client_id as string)}` : '';
      const data = await fetchInternal(`/api/otimizador/fila${qs}`);
      if (!data) return 'Não consegui consultar a fila do Otimizador.';
      const recs = Array.isArray(data.recs) ? data.recs.slice(0, 20) : [];
      return JSON.stringify({ contas: data.contas ?? [], decisoes_pendentes: recs, gerado_em: data.generated_at ?? null });
    }

    if (name === 'get_activity_logs') {
      const limit = Math.min(Number(input.limit) || 30, 100);
      const { rows } = await pool.query(
        `SELECT * FROM public.activity_logs ORDER BY created_at DESC LIMIT $1`, [limit],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (rows.length === 0) return 'Nenhum registro no log de auditoria.';
      return JSON.stringify(rows.map(r => stripFields(r as Record<string, unknown>, [])));
    }

    if (name === 'list_users') {
      const { rows } = await pool.query('SELECT id, name, email, role, status FROM public.users ORDER BY name ASC');
      if (rows.length === 0) return 'Nenhum usuário cadastrado.';
      return JSON.stringify(rows.map(r => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status })));
    }

    if (name === 'create_user') {
      if (callerRole !== 'admin') return 'Acesso negado. Apenas administradores podem criar usuários.';
      const { name: userName, email, password, role: userRole } = input as { name: string; email: string; password: string; role: string };
      const { rows: existing } = await pool.query('SELECT id FROM public.users WHERE email = $1', [email]);
      if (existing.length > 0) return `Usuário com email "${email}" já existe.`;
      const newId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO public.users (id, name, email, password, role, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [newId, userName, email, password, userRole, 'active']
      );
      return `Usuário "${userName}" (${email}) criado com sucesso. Role: ${userRole}. ID: ${newId}`;
    }

    if (name === 'assign_gestor') {
      const { client_id, gestor_id } = input as { client_id: string; gestor_id: string };
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [client_id]);
      if (!clientRows[0]) return 'Cliente não encontrado. Use list_clients para ver os clientes.';
      const { rows: gestorRows } = await pool.query('SELECT name FROM public.users WHERE id = $1', [gestor_id]);
      if (!gestorRows[0]) return 'Gestor não encontrado. Use list_users para ver os usuários.';
      await pool.query('UPDATE public.clients SET gestor_id = $1 WHERE id = $2', [gestor_id, client_id]);
      return `Gestor "${gestorRows[0].name}" vinculado ao cliente "${clientRows[0].name}" com sucesso.`;
    }

    if (name === 'link_account') {
      const { client_id, platform, account_id, account_name, connection_id } = input as {
        client_id: string; platform: string; account_id: string; account_name?: string; connection_id?: string;
      };
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [client_id]);
      if (!clientRows[0]) return 'Cliente não encontrado. Use list_clients para ver os clientes.';
      const { rows: existing } = await pool.query(
        'SELECT id FROM public.client_account_links WHERE client_id = $1 AND account_id = $2',
        [client_id, account_id]
      );
      if (existing.length > 0) return `Conta "${account_id}" já está vinculada a este cliente.`;
      await pool.query(
        'INSERT INTO public.client_account_links (client_id, platform, connection_id, account_id, account_name, currency) VALUES ($1, $2, $3, $4, $5, $6)',
        [client_id, platform, connection_id ?? null, account_id, account_name ?? account_id, 'BRL']
      );
      return `Conta "${account_name ?? account_id}" (${platform}) vinculada ao cliente "${clientRows[0].name}" com sucesso.`;
    }

    if (name === 'create_webhook') {
      const { name: wName, description } = input as { name: string; description?: string };
      const { rows } = await pool.query(
        'INSERT INTO public.webhook_configs (name, description) VALUES ($1, $2) RETURNING id, name, token',
        [wName, description ?? '']
      );
      const wh = rows[0];
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      return `Webhook "${wh.name}" criado com sucesso!\nToken: ${wh.token}\nURL para receber eventos: ${baseUrl}/api/webhook/${wh.token}\nID: ${wh.id}`;
    }

    if (name === 'create_disparo') {
      const {
        client_id, name: campName, message, numbers,
        starts_at, interval_min = 30, interval_max = 90,
      } = input as {
        client_id: string; name: string; message: string;
        numbers: { phone: string; name?: string }[];
        starts_at?: string; interval_min?: number; interval_max?: number;
      };
      if (!numbers || numbers.length === 0) return 'É necessário informar ao menos um contato em "numbers".';
      const startsAt = starts_at || new Date().toISOString();
      const { rows: campRows } = await pool.query(
        `INSERT INTO public.zapi_campaigns (client_id, name, message, status, starts_at, interval_min, interval_max, total)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7) RETURNING id`,
        [client_id, campName, message, startsAt, interval_min, interval_max, numbers.length]
      );
      const campId = campRows[0].id as string;
      for (let i = 0; i < numbers.length; i++) {
        await pool.query(
          'INSERT INTO public.zapi_numbers (campaign_id, phone, name, position) VALUES ($1, $2, $3, $4)',
          [campId, numbers[i].phone, numbers[i].name ?? '', i + 1]
        );
      }
      return `Campanha de disparo "${campName}" criada com ${numbers.length} contato(s). ID: ${campId}\nStatus: pendente. Início agendado: ${startsAt}`;
    }

    if (name === 'schedule_payment') {
      const { client_id, destination, amount, date, channel = 'pix', status = 'agendado' } = input as {
        client_id: string; destination: string; amount: number; date: string; channel?: string; status?: string;
      };
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [client_id]);
      const clientName = clientRows[0]?.name ?? client_id;
      const payId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO public.payments (id, client_id, client_name, date, destination, amount, channel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [payId, client_id, clientName, date, destination, amount, channel, status]
      );
      return `Pagamento registrado: R$ ${Number(amount).toFixed(2)} via ${channel.toUpperCase()} para "${destination}" em ${date}. Status: ${status}. ID: ${payId}`;
    }

    if (name === 'list_client_payments') {
      const { client_id } = input as { client_id: string };
      const { rows } = await pool.query(
        `SELECT id, date, destination, amount, channel, status FROM public.payments
          WHERE client_id = $1 ORDER BY date DESC LIMIT 20`,
        [client_id]
      );
      if (rows.length === 0) return 'Nenhum pagamento encontrado para este cliente.';
      return JSON.stringify(rows);
    }

    if (name === 'reschedule_client_payment') {
      const { payment_id, new_date } = input as { payment_id: string; new_date: string };
      const { rows } = await pool.query(
        `UPDATE public.payments SET date = $1 WHERE id = $2
         RETURNING id, client_name, destination, amount, date, status`,
        [new_date, payment_id]
      );
      if (rows.length === 0) return `Pagamento ${payment_id} não encontrado.`;
      const p = rows[0];
      return `Pagamento de R$ ${Number(p.amount).toFixed(2)} (${p.destination}) do cliente ${p.client_name} reagendado para ${p.date}. Status: ${p.status}.`;
    }

    if (name === 'set_client_payment_due_day') {
      const { client_id, due_day } = input as { client_id: string; due_day: number };
      if (!Number.isInteger(due_day) || due_day < 1 || due_day > 31) return 'due_day deve ser um número inteiro entre 1 e 31.';
      await pool.query('ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS dia_vencimento_pix INTEGER').catch(() => {});
      const { rows } = await pool.query(
        `UPDATE public.clients SET dia_vencimento_pix = $1 WHERE id = $2 RETURNING name`,
        [due_day, client_id]
      );
      if (rows.length === 0) return `Cliente ${client_id} não encontrado.`;
      return `Dia de vencimento fixo do cliente ${rows[0].name} definido como todo dia ${due_day} (mudança permanente, vale a partir de agora).`;
    }

    if (name === 'configure_optimizer_client') {
      const { client_id, observacoes_fixas, substituir_tudo, modo_operacao, analise_dia_semana } = input as {
        client_id: string; observacoes_fixas?: string; substituir_tudo?: boolean; modo_operacao?: string; analise_dia_semana?: number;
      };
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [client_id]);
      if (clientRows.length === 0) return `Cliente ${client_id} não encontrado.`;
      await ensureOptimizerClientConfigTable(pool);
      const { rows: existingRows } = await pool.query(
        `SELECT modo_operacao, acoes_pre_aprovadas, orcamento_diario_maximo, cpr_emergencia,
                min_conjuntos_ativos, max_conjuntos_ativos, min_dias_aprendizado, analise_dia_semana, ativo, observacoes_fixas
           FROM public.optimizer_client_config WHERE client_id = $1`,
        [client_id]
      );
      const existing = existingRows[0] ?? {
        modo_operacao: 'RECOMENDACAO_COM_APROVACAO', acoes_pre_aprovadas: [], orcamento_diario_maximo: null,
        cpr_emergencia: null, min_conjuntos_ativos: 1, max_conjuntos_ativos: 20, min_dias_aprendizado: 7,
        analise_dia_semana: 1, ativo: true, observacoes_fixas: null,
      };
      const dia = analise_dia_semana && analise_dia_semana >= 1 && analise_dia_semana <= 5 ? analise_dia_semana : existing.analise_dia_semana;
      // Cada linha do campo é um item na UI — por padrão, soma uma linha nova em vez de sobrescrever.
      const nextObservacoes = observacoes_fixas === undefined
        ? existing.observacoes_fixas
        : substituir_tudo || !existing.observacoes_fixas
          ? observacoes_fixas
          : `${existing.observacoes_fixas}\n${observacoes_fixas}`;
      await pool.query(
        `INSERT INTO public.optimizer_client_config
           (client_id, modo_operacao, acoes_pre_aprovadas, orcamento_diario_maximo, cpr_emergencia,
            min_conjuntos_ativos, max_conjuntos_ativos, min_dias_aprendizado, analise_dia_semana, ativo, observacoes_fixas, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12)
         ON CONFLICT (client_id) DO UPDATE SET
           modo_operacao = EXCLUDED.modo_operacao, analise_dia_semana = EXCLUDED.analise_dia_semana,
           observacoes_fixas = EXCLUDED.observacoes_fixas, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [
          client_id, modo_operacao ?? existing.modo_operacao, existing.acoes_pre_aprovadas, existing.orcamento_diario_maximo,
          existing.cpr_emergencia, existing.min_conjuntos_ativos, existing.max_conjuntos_ativos, existing.min_dias_aprendizado,
          dia, existing.ativo, nextObservacoes, 'Luna IA',
        ]
      );
      return `Configuração do Otimizador atualizada para ${clientRows[0].name}.${observacoes_fixas !== undefined ? (substituir_tudo ? ` Peculiaridades substituídas por: "${observacoes_fixas}".` : ` Nova peculiaridade adicionada: "${observacoes_fixas}".`) : ''}${modo_operacao ? ` Modo: ${modo_operacao}.` : ''}`;
    }

    if (name === 'add_client_vault_credential') {
      const { client_id, title, login, password, url, category, notes } = input as {
        client_id: string; title: string; login?: string; password?: string; url?: string; category?: string; notes?: string;
      };
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [client_id]);
      if (clientRows.length === 0) return `Cliente ${client_id} não encontrado.`;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.client_vault (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, title TEXT NOT NULL,
          url TEXT, login TEXT, password_enc TEXT, category TEXT NOT NULL DEFAULT 'Outros', notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_client_vault_client ON public.client_vault (client_id);
      `).catch(() => {});
      await pool.query(
        `INSERT INTO public.client_vault (client_id, title, url, login, password_enc, category, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [client_id, title.trim(), url ?? null, login ?? null, password ?? null, category ?? 'Outros', notes ?? null]
      );
      return `Credencial "${title}" salva no Cofre de ${clientRows[0].name}.`;
    }

    if (name === 'create_meta_campaign') {
      const {
        client_id, name: campName, objective, daily_budget,
        adset_name, age_min = 18, age_max = 65,
        genders = 'all', cities = [], countries = ['BR'],
        interests = [], placements = 'all',
        ad_body, ad_headline, ad_description, ad_cta = 'LEARN_MORE',
        destination_url = 'https://onmid.com.br', audience_notes,
      } = input as {
        client_id: string; name: string; objective: string; daily_budget: number;
        adset_name?: string; age_min?: number; age_max?: number;
        genders?: 'all' | 'male' | 'female';
        cities?: string[]; countries?: string[];
        interests?: string[]; placements?: string;
        ad_body?: string; ad_headline?: string; ad_description?: string;
        ad_cta?: string; destination_url?: string; audience_notes?: string;
      };

      // Resolve ad account + token
      const { rows: links } = await pool.query(
        "SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('meta_ads','meta') LIMIT 1",
        [client_id]
      );
      if (!links[0]) return '❌ Nenhuma conta Meta Ads vinculada a este cliente. Use link_account para vincular primeiro.';
      const { rows: connRows } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1', [links[0].connection_id]);
      if (!connRows[0]) return '❌ Conexão Meta não encontrada. Verifique as integrações do cliente.';
      const token = await getFreshMetaToken(connRows[0]);
      const acctNode = String(links[0].account_id).startsWith('act_') ? links[0].account_id : `act_${links[0].account_id}`;

      // Resolve Facebook Page ID (needed as promoted_object for LEADS/SALES)
      let fbPageId: string | null = null;
      try {
        const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name&limit=10&access_token=${token}`);
        if (pagesRes.ok) {
          const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string }> };
          fbPageId = pagesData.data?.[0]?.id ?? null;
        }
      } catch { /* non-fatal */ }

      const report: string[] = [
        `📊 Relatório de criação — Meta Ads`,
        `Conta: ${acctNode}`,
        `${'─'.repeat(44)}`,
      ];

      // ── Helper: search Meta geo/interest ──────────────
      async function searchMetaCities(names: string[]): Promise<Array<{ key: string; name: string }>> {
        const found: Array<{ key: string; name: string }> = [];
        await Promise.allSettled(names.map(async (cityName) => {
          const r = await fetch(`https://graph.facebook.com/v21.0/search?type=adgeolocation&q=${encodeURIComponent(cityName)}&location_types=["city"]&country_code=BR&access_token=${token}`);
          if (!r.ok) return;
          const d = await r.json() as { data?: { key: string; name: string; region?: string }[] };
          const match = d.data?.[0];
          if (match) found.push({ key: match.key, name: match.region ? `${match.name}, ${match.region}` : match.name });
        }));
        return found;
      }

      async function searchMetaInterests(terms: string[]): Promise<Array<{ id: string; name: string }>> {
        const found: Array<{ id: string; name: string }> = [];
        await Promise.allSettled(terms.map(async (term) => {
          const r = await fetch(`https://graph.facebook.com/v21.0/search?type=adinterest&q=${encodeURIComponent(term)}&locale=pt_BR&access_token=${token}`);
          if (!r.ok) return;
          const d = await r.json() as { data?: { id: string; name: string }[] };
          if (d.data?.[0]) found.push({ id: d.data[0].id, name: d.data[0].name });
        }));
        return found;
      }

      function createBlackPng(w: number, h: number): Buffer {
        const crcTable = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
          crcTable[i] = c;
        }
        function crc32(data: Buffer): number {
          let crc = 0xFFFFFFFF;
          for (const b of data) crc = (crcTable[(crc ^ b) & 0xFF]!) ^ (crc >>> 8);
          return (crc ^ 0xFFFFFFFF) >>> 0;
        }
        function pngChunk(type: string, data: Buffer): Buffer {
          const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
          const typeBuf = Buffer.from(type, 'ascii');
          const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
          return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
        }
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
        ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
        const rowSize = 1 + w * 3;
        const raw = Buffer.alloc(h * rowSize, 0); // all zeros = black
        const compressed = deflateSync(raw);
        return Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          pngChunk('IHDR', ihdr),
          pngChunk('IDAT', compressed),
          pngChunk('IEND', Buffer.alloc(0)),
        ]);
      }

      // ── STEP 1: Campaign ──────────────────────────────
      const campRes = await fetch(`https://graph.facebook.com/v21.0/${acctNode}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campName,
          objective,
          status: 'ACTIVE',
          special_ad_categories: [],
          daily_budget: Math.round(Number(daily_budget) * 100),
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          access_token: token,
        }),
      });
      const campData = await campRes.json() as { id?: string; error?: { message?: string; error_user_msg?: string } };

      if (!campRes.ok || !campData.id) {
        const err = campData.error?.error_user_msg ?? campData.error?.message ?? `HTTP ${campRes.status}`;
        report.push(`❌ Campanha: FALHA — ${err}`);
        return report.join('\n');
      }
      const campaignId = campData.id;
      report.push(`✅ Campanha criada (ATIVA — conjuntos pausados)`);
      report.push(`   Nome: ${campName}`);
      report.push(`   Objetivo: ${objective}`);
      report.push(`   Orçamento diário: R$ ${Number(daily_budget).toFixed(2)}`);
      report.push(`   Estratégia de lance: Menor custo (automático)`);
      report.push(`   ID: ${campaignId}`);
      report.push('');

      // ── STEP 2: Resolve targeting ─────────────────────
      const [resolvedCities, resolvedInterests] = await Promise.all([
        cities.length > 0 ? searchMetaCities(cities) : Promise.resolve([]),
        interests.length > 0 ? searchMetaInterests(interests) : Promise.resolve([]),
      ]);

      const geoLocations: Record<string, unknown> = {};
      if (resolvedCities.length > 0) {
        geoLocations.cities = resolvedCities.map(c => ({ key: c.key }));
      } else {
        geoLocations.countries = countries.length > 0 ? countries : ['BR'];
      }

      const targeting: Record<string, unknown> = {
        geo_locations: geoLocations,
        age_min: Number(age_min),
        age_max: Number(age_max),
      };
      if (genders === 'male')   targeting.genders = [1];
      if (genders === 'female') targeting.genders = [2];
      if (resolvedInterests.length > 0) {
        targeting.flexible_spec = [{ interests: resolvedInterests.map(i => ({ id: i.id, name: i.name })) }];
      }

      // Placements
      switch (placements) {
        case 'instagram_only':
          targeting.publisher_platforms = ['instagram'];
          targeting.instagram_positions = ['stream', 'story', 'reels', 'explore', 'explore_home'];
          break;
        case 'facebook_only':
          targeting.publisher_platforms = ['facebook'];
          targeting.facebook_positions = ['feed', 'video_feeds', 'story', 'reels'];
          break;
        case 'instagram_feed_reels':
          targeting.publisher_platforms = ['instagram'];
          targeting.instagram_positions = ['stream', 'reels'];
          break;
        case 'facebook_feed':
          targeting.publisher_platforms = ['facebook'];
          targeting.facebook_positions = ['feed'];
          break;
        // 'all': no placement restrictions (Advantage+ automatic)
      }

      // ── STEP 3: Ad Set ────────────────────────────────
      const OBJECTIVE_TO_GOAL: Record<string, string> = {
        OUTCOME_LEADS:         'LEAD_GENERATION',
        OUTCOME_SALES:         'OFFSITE_CONVERSIONS',
        OUTCOME_TRAFFIC:       'LINK_CLICKS',
        OUTCOME_AWARENESS:     'REACH',
        OUTCOME_ENGAGEMENT:    'POST_ENGAGEMENT',
        OUTCOME_APP_PROMOTION: 'APP_INSTALLS',
      };
      const OBJECTIVE_TO_BILLING: Record<string, string> = {
        OUTCOME_TRAFFIC:    'LINK_CLICKS',
        OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
      };
      const OBJECTIVE_TO_DEST: Record<string, string> = {
        OUTCOME_LEADS:   'ON_AD',
        OUTCOME_SALES:   'WEBSITE',
        OUTCOME_TRAFFIC: 'WEBSITE',
      };
      const optimizationGoal  = OBJECTIVE_TO_GOAL[objective] ?? 'REACH';
      const billingEvent      = OBJECTIVE_TO_BILLING[objective] ?? 'IMPRESSIONS';
      const resolvedAdsetName = adset_name ?? `Conjunto 1 — ${campName}`;

      const adsetPayload: Record<string, unknown> = {
        name: resolvedAdsetName,
        campaign_id: campaignId,
        optimization_goal: optimizationGoal,
        billing_event: billingEvent,
        targeting,
        status: 'PAUSED',
        start_time: new Date().toISOString(),
        access_token: token,
      };
      const destType = OBJECTIVE_TO_DEST[objective];
      if (destType) adsetPayload.destination_type = destType;

      // promoted_object is required for LEADS (page) and SALES (pixel)
      if (objective === 'OUTCOME_LEADS' && fbPageId) {
        adsetPayload.promoted_object = { page_id: fbPageId };
      } else if (objective === 'OUTCOME_SALES' && fbPageId) {
        adsetPayload.promoted_object = { page_id: fbPageId };
      }

      const adsetRes = await fetch(`https://graph.facebook.com/v21.0/${acctNode}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adsetPayload),
      });
      const adsetData = await adsetRes.json() as { id?: string; error?: { message?: string; error_user_msg?: string } };

      if (!adsetRes.ok || !adsetData.id) {
        const err = adsetData.error?.error_user_msg ?? adsetData.error?.message ?? `HTTP ${adsetRes.status}`;
        report.push(`⚠️ Conjunto de anúncios: FALHA`);
        report.push(`   Motivo: ${err}`);
        report.push(`   Campanha criada (ID: ${campaignId}) — adicione o conjunto manualmente.`);
      } else {
        const adsetId = adsetData.id;
        const genderLabel = genders === 'male' ? 'Masculino' : genders === 'female' ? 'Feminino' : 'Todos';
        const geoLabel = resolvedCities.length > 0
          ? resolvedCities.map(c => c.name).join(', ')
          : countries.join(', ');
        report.push(`✅ Conjunto de anúncios criado`);
        report.push(`   Nome: ${resolvedAdsetName}`);
        report.push(`   Otimização: ${optimizationGoal}`);
        report.push(`   Público: ${age_min}–${age_max} anos | ${genderLabel}`);
        report.push(`   Localização: ${geoLabel}`);
        if (resolvedInterests.length > 0) report.push(`   Interesses: ${resolvedInterests.map(i => i.name).join(', ')}`);
        if (placements !== 'all') report.push(`   Posicionamento: ${placements}`);
        if (resolvedCities.length < cities.length) {
          const notFound = cities.filter((_, i) => !resolvedCities[i]);
          report.push(`   ⚠️ Cidades não encontradas: ${notFound.join(', ')} (usando país como fallback)`);
        }
        report.push(`   ID: ${adsetId}`);
        report.push('');

        // ── STEP 3b: Upload placeholder image ─────────────
        try {
          const pngBuf = createBlackPng(1080, 1080);
          const imgForm = new FormData();
          const pngArrayBuf = pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength) as ArrayBuffer;
          imgForm.append('filename', new Blob([pngArrayBuf], { type: 'image/png' }), 'placeholder.png');
          imgForm.append('access_token', token);
          const imgRes = await fetch(`https://graph.facebook.com/v21.0/${acctNode}/adimages`, {
            method: 'POST', body: imgForm,
          });
          const imgData = await imgRes.json() as { images?: Record<string, { hash: string }> };
          const imageHash = imgData.images?.['placeholder.png']?.hash;

          if (imageHash && fbPageId) {
            // ── STEP 4: AdCreative ──────────────────────────
            const linkData: Record<string, unknown> = {
              image_hash: imageHash,
              link: destination_url,
              call_to_action: { type: ad_cta },
            };
            if (ad_body)        linkData.message     = ad_body;
            if (ad_headline)    linkData.name        = ad_headline;
            if (ad_description) linkData.description = ad_description;

            const creativeRes = await fetch(`https://graph.facebook.com/v21.0/${acctNode}/adcreatives`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `Criativo — ${campName}`,
                object_story_spec: { page_id: fbPageId, link_data: linkData },
                access_token: token,
              }),
            });
            const creativeData = await creativeRes.json() as { id?: string; error?: { message?: string; error_user_msg?: string } };

            if (creativeData.id) {
              // ── STEP 5: Ad ──────────────────────────────────
              const adRes = await fetch(`https://graph.facebook.com/v21.0/${acctNode}/ads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: `Anúncio — ${campName}`,
                  adset_id: adsetId,
                  creative: { creative_id: creativeData.id },
                  status: 'PAUSED',
                  access_token: token,
                }),
              });
              const adData = await adRes.json() as { id?: string; error?: { message?: string; error_user_msg?: string } };
              if (adData.id) {
                report.push(`✅ Anúncio criado (PAUSADO)`);
                report.push(`   ID: ${adData.id}`);
                report.push(`   Criativo: imagem preta placeholder — troque pelo criativo definitivo`);
              } else {
                const adErr = adData.error?.error_user_msg ?? adData.error?.message ?? 'erro desconhecido';
                report.push(`⚠️ Anúncio: FALHA — ${adErr}`);
              }
            } else {
              const cErr = creativeData.error?.error_user_msg ?? creativeData.error?.message ?? 'erro desconhecido';
              report.push(`⚠️ Criativo: FALHA — ${cErr}`);
            }
          } else {
            report.push(`⚠️ Imagem: não foi possível obter hash — suba o criativo manualmente`);
          }
        } catch (imgErr) {
          report.push(`⚠️ Anúncio: erro ao gerar placeholder — ${String(imgErr)}`);
        }
        report.push('');
      }

      report.push('─'.repeat(44));
      report.push('✅ Campanha ATIVA — conjuntos de anúncios PAUSADOS');
      report.push('   Não veicula até você ativar um conjunto no Gerenciador.');
      report.push('');
      report.push('📋 Próximos passos:');
      report.push('   1. Troque a imagem preta pelo criativo definitivo no Gerenciador');
      report.push('   2. Edite texto, headline e CTA do anúncio');
      report.push('   3. Ative o conjunto quando o criativo estiver pronto');

      if (audience_notes) {
        report.push('');
        report.push(`💡 Análise de público-alvo:`);
        report.push(`   ${audience_notes}`);
      }

      return report.join('\n');
    }

    // ── Pacote A: execução Meta + Google ────────────────────────────────────
    if (name === 'get_meta_structure') {
      const clientId = input.client_id as string;
      const campaignFilter = (input.campaign_id as string | undefined) ?? null;
      const metaPeriod = resolveMetaPeriod((input.period as string) || 'last_30d', (input.date_from as string) ?? '', (input.date_to as string) ?? '');

      const { rows: links } = await pool.query(
        "SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('meta_ads','meta')",
        [clientId]
      );
      if (links.length === 0) return 'Nenhuma conta Meta Ads vinculada a esse cliente.';
      const { rows: connRows } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1 OR status = \'connected\' ORDER BY (id = $1) DESC LIMIT 1', [links[0].connection_id ?? '']);
      if (!connRows[0]) return 'Nenhuma conexão Meta ativa.';
      const token = await getFreshMetaToken(connRows[0]);
      const acctNode = String(links[0].account_id).startsWith('act_') ? links[0].account_id : `act_${links[0].account_id}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchJson = async (u: URL): Promise<any[]> => {
        const r = await fetch(u.toString());
        if (!r.ok) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = await r.json() as { data?: any[] };
        return d.data ?? [];
      };
      const mk = (edge: string, fields: string) => {
        const u = new URL(`https://graph.facebook.com/v21.0/${acctNode}/${edge}`);
        u.searchParams.set('fields', fields);
        u.searchParams.set('limit', '150');
        u.searchParams.set('access_token', token);
        return u;
      };
      const mkIns = (level: string) => {
        const u = mk('insights', `campaign_id,${level}_id,${level}_name,spend,impressions,clicks,actions`);
        u.searchParams.set('level', level);
        applyMetaDateToUrl(u, metaPeriod);
        return u;
      };
      const [adsetsMeta, adsMeta, adsetIns, adIns] = await Promise.all([
        fetchJson(mk('adsets', 'id,name,status,daily_budget,campaign_id,campaign{name}')),
        fetchJson(mk('ads', 'id,name,status,adset_id,campaign_id')),
        fetchJson(mkIns('adset')),
        fetchJson(mkIns('ad')),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insByAdset = new Map<string, any>(adsetIns.map(r => [r.adset_id, r]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insByAd = new Map<string, any>(adIns.map(r => [r.ad_id, r]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shape = (metaObj: any, ins: any) => {
        const spend = parseFloat(ins?.spend || '0');
        const leads = countMetaResults(ins?.actions ?? []);
        return {
          id: metaObj.id, nome: metaObj.name, status: metaObj.status,
          campanha_id: metaObj.campaign_id, campanha: metaObj.campaign?.name,
          orcamento_diario: metaObj.daily_budget != null ? Number(metaObj.daily_budget) / 100 : undefined,
          gasto: Math.round(spend * 100) / 100, leads,
          cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
          impressoes: parseInt(ins?.impressions || '0', 10), cliques: parseInt(ins?.clicks || '0', 10),
        };
      };
      const conjuntos = adsetsMeta
        .filter(a => !campaignFilter || a.campaign_id === campaignFilter)
        .map(a => shape(a, insByAdset.get(a.id)))
        .sort((a, b) => b.gasto - a.gasto).slice(0, 25);
      const anuncios = adsMeta
        .filter(a => !campaignFilter || a.campaign_id === campaignFilter)
        .map(a => ({ ...shape(a, insByAd.get(a.id)), conjunto_id: a.adset_id }))
        .sort((a, b) => b.gasto - a.gasto).slice(0, 25);
      if (conjuntos.length === 0 && anuncios.length === 0) return 'Nenhum conjunto/anúncio encontrado (confira o campaign_id e o período).';
      return JSON.stringify({ conta: acctNode, observacao: 'leads = contagem canônica (formulário + conversa); orçamento em conjuntos sem valor = campanha CBO (orçamento na campanha)', conjuntos, anuncios });
    }

    if (name === 'execute_ad_action') {
      const clientId = input.client_id as string;
      const canal = input.canal as 'meta' | 'google';
      const objetoTipo = input.objeto_tipo as OptimizerObjetoTipo;
      const objetoId = String(input.objeto_id ?? '');
      const acaoRaw = String(input.acao ?? '');
      const novoOrcamento = input.novo_orcamento_diario != null ? Number(input.novo_orcamento_diario) : undefined;
      const acaoMap: Record<string, OptimizerAcaoTipo> = { pausar: 'PAUSAR', ativar: 'ATIVAR', ajustar_orcamento: 'AJUSTAR_ORCAMENTO' };
      const acao = acaoMap[acaoRaw];
      if (!acao || !objetoId) return 'Parâmetros inválidos: informe objeto_id e acao (pausar|ativar|ajustar_orcamento).';
      if (acao === 'AJUSTAR_ORCAMENTO' && (!novoOrcamento || novoOrcamento <= 0)) return 'Informe novo_orcamento_diario (em R$) maior que zero.';

      const platform = canal === 'google' ? "('google_ads','google')" : "('meta_ads','meta')";
      const { rows: links } = await pool.query(
        `SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ${platform} LIMIT 1`,
        [clientId]
      );
      if (!links[0]) return `Nenhuma conta ${canal === 'google' ? 'Google' : 'Meta'} vinculada a esse cliente.`;

      // Meta com orçamento em CAMPANHA (CBO): executeOptimizerAction só cobre adset — faz direto na Graph.
      if (canal === 'meta' && acao === 'AJUSTAR_ORCAMENTO' && objetoTipo === 'campaign') {
        const { rows: connRows } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1 OR status = \'connected\' ORDER BY (id = $1) DESC LIMIT 1', [links[0].connection_id ?? '']);
        if (!connRows[0]) return 'Nenhuma conexão Meta ativa.';
        const token = await getFreshMetaToken(connRows[0]);
        const res = await fetch(`https://graph.facebook.com/v21.0/${objetoId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daily_budget: Math.round(novoOrcamento! * 100), access_token: token }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
          return `❌ Falha ao ajustar orçamento da campanha: ${err.error?.message ?? `Meta ${res.status}`}`;
        }
        return `✅ Orçamento diário da campanha ${objetoId} ajustado para R$ ${novoOrcamento!.toFixed(2)}.`;
      }

      // Google + ajustar_orcamento: precisa do budget_resource_name da campanha.
      let budgetResourceName: string | undefined;
      let loginCustomerId: string | null = null;
      const customerId = canal === 'google' ? String(links[0].account_id ?? '').replace(/\D/g, '') : null;
      if (canal === 'google') {
        const probeQuery = acao === 'AJUSTAR_ORCAMENTO'
          ? `SELECT campaign.id, campaign.campaign_budget FROM campaign WHERE campaign.id = ${objetoId.replace(/\D/g, '')}`
          : 'SELECT customer.id FROM customer LIMIT 1';
        const probe = await lunaGoogleSearch(customerId!, probeQuery);
        if (!probe) return '❌ Não consegui acessar essa conta Google (token/permissão MCC). Verifique a conexão em Integrações.';
        loginCustomerId = probe.login;
        if (acao === 'AJUSTAR_ORCAMENTO') {
          budgetResourceName = probe.results?.[0]?.campaign?.campaignBudget;
          if (!budgetResourceName) return '❌ Campanha não encontrada nessa conta Google (confira o objeto_id).';
        }
      }

      const result = await executeOptimizerAction({
        canal, acao, objeto_tipo: objetoTipo, objeto_id: objetoId,
        parametros: { novo_orcamento_diario: novoOrcamento, budget_resource_name: budgetResourceName },
        connection_id: links[0].connection_id ?? '',
        account_id: customerId,
        login_customer_id: loginCustomerId,
      });
      if (!result.ok) return `❌ Falha: ${result.error}`;
      const acaoLabel = acao === 'PAUSAR' ? 'pausado' : acao === 'ATIVAR' ? 'ativado' : `com orçamento ajustado para R$ ${novoOrcamento!.toFixed(2)}`;
      return `✅ ${objetoTipo === 'campaign' ? 'Campanha' : objetoTipo === 'adset' ? 'Conjunto' : 'Anúncio'} ${objetoId} ${acaoLabel} no ${canal === 'google' ? 'Google Ads' : 'Meta Ads'}.`;
    }

    if (name === 'duplicate_meta_campaign') {
      const clientId = input.client_id as string;
      const campaignId = String(input.campaign_id ?? '');
      const { rows: links } = await pool.query(
        "SELECT connection_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('meta_ads','meta') LIMIT 1",
        [clientId]
      );
      if (!links[0]) return 'Nenhuma conta Meta vinculada a esse cliente.';
      const { rows: connRows } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1 OR status = \'connected\' ORDER BY (id = $1) DESC LIMIT 1', [links[0].connection_id ?? '']);
      if (!connRows[0]) return 'Nenhuma conexão Meta ativa.';
      const token = await getFreshMetaToken(connRows[0]);
      const body: Record<string, unknown> = { deep_copy: true, status_option: 'PAUSED', access_token: token };
      if (input.new_name) body.rename_options = JSON.stringify({ rename_suffix: '' });
      const res = await fetch(`https://graph.facebook.com/v21.0/${campaignId}/copies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { copied_campaign_id?: string; ad_object_ids?: unknown[]; error?: { message?: string; error_user_msg?: string } };
      if (!res.ok) return `❌ Falha ao duplicar: ${data.error?.error_user_msg ?? data.error?.message ?? `Meta ${res.status}`}`;
      const newId = data.copied_campaign_id ?? 'desconhecido';
      if (input.new_name && newId !== 'desconhecido') {
        await fetch(`https://graph.facebook.com/v21.0/${newId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.new_name, access_token: token }),
        }).catch(() => {});
      }
      return `✅ Campanha duplicada! Nova campanha: ${newId} (PAUSADA — revise conjuntos/anúncios e ative quando quiser).`;
    }

    // ── Pacote C: cérebro do sistema ────────────────────────────────────────
    if (name === 'create_google_campaign') {
      const clientId = input.client_id as string;
      const nome = String(input.name ?? '').trim();
      const budget = Number(input.daily_budget);
      const finalUrl = String(input.final_url ?? '').trim();
      if (!nome || !budget || budget <= 0 || !finalUrl) return 'Informe name, daily_budget e final_url.';

      // Valida a copy do RSA ANTES de criar qualquer coisa (limites reais do Google).
      const headlines = (Array.isArray(input.headlines) ? input.headlines : [])
        .map((h: unknown) => String(h).trim()).filter(Boolean).map((h: string) => h.slice(0, 30)).slice(0, 15);
      const descriptions = (Array.isArray(input.descriptions) ? input.descriptions : [])
        .map((d: unknown) => String(d).trim()).filter(Boolean).map((d: string) => d.slice(0, 90)).slice(0, 4);
      const keywords = (Array.isArray(input.keywords) ? input.keywords : [])
        .map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 20);
      if (headlines.length < 3) return 'O anúncio RSA exige no mínimo 3 títulos (até 30 caracteres cada). Gere os títulos e chame de novo.';
      if (descriptions.length < 2) return 'O anúncio RSA exige no mínimo 2 descrições (até 90 caracteres cada). Gere as descrições e chame de novo.';
      if (keywords.length === 0) return 'Informe as palavras-chave da campanha de Pesquisa.';
      const matchType = ({ broad: 'BROAD', phrase: 'PHRASE', exact: 'EXACT' } as Record<string, string>)[String(input.match_type ?? 'phrase')] ?? 'PHRASE';

      const { rows: links } = await pool.query(
        "SELECT account_id FROM public.client_account_links WHERE client_id = $1 AND platform IN ('google_ads','google') LIMIT 1",
        [clientId],
      );
      const customerId = String(links[0]?.account_id ?? '').replace(/\D/g, '');
      if (!customerId) return 'Nenhuma conta Google Ads vinculada a esse cliente.';

      // Probe: resolve token + login-customer-id que funcionam (mesmo caminho das leituras).
      const probe = await lunaGoogleSearch(customerId, 'SELECT customer.id FROM customer LIMIT 1');
      if (!probe) return '❌ Não consegui acessar essa conta Google (token/permissão MCC). Verifique a conexão em Integrações.';
      const { token, login } = probe;

      const report: string[] = [
        '📊 Relatório de criação — Google Ads',
        `Conta: ${customerId}`,
        '────────────────────────────────────────────',
      ];

      // Geo: resolve cidades → geo_target_constant; sem cidade (ou nenhuma achada) = Brasil.
      const geoRns: string[] = [];
      const cidades = (Array.isArray(input.cities) ? input.cities : []).map((c: unknown) => String(c).trim()).filter(Boolean);
      for (const cidade of cidades.slice(0, 10)) {
        const geo = await lunaGoogleSearch(customerId,
          `SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name
             FROM geo_target_constant
            WHERE geo_target_constant.name = '${cidade.replace(/'/g, "\\'")}'
              AND geo_target_constant.country_code = 'BR'
              AND geo_target_constant.target_type = 'City'
              AND geo_target_constant.status = 'ENABLED' LIMIT 1`);
        const rn = geo?.results?.[0]?.geoTargetConstant?.resourceName;
        if (rn) geoRns.push(rn);
      }
      if (geoRns.length === 0) geoRns.push('geoTargetConstants/2076'); // Brasil
      const geoLabel = cidades.length > 0 && geoRns[0] !== 'geoTargetConstants/2076' ? cidades.join(', ') : 'Brasil';

      // 1) Orçamento (não compartilhado)
      const budgetRes = await lunaGoogleMutate(customerId, token, login, 'campaignBudgets', [{
        create: {
          name: `${nome} — Orçamento ${Date.now()}`,
          amountMicros: String(Math.round(budget * 1_000_000)),
          explicitlyShared: false,
          deliveryMethod: 'STANDARD',
        },
      }]);
      if ('error' in budgetRes) return `❌ Falha ao criar o orçamento: ${budgetRes.error}`;
      const budgetRn = budgetRes.resourceNames[0];

      // 2) Campanha de Pesquisa (PAUSADA — gestor revisa e ativa)
      const campRes = await lunaGoogleMutate(customerId, token, login, 'campaigns', [{
        create: {
          name: nome,
          status: 'PAUSED',
          advertisingChannelType: 'SEARCH',
          campaignBudget: budgetRn,
          targetSpend: {}, // Maximizar cliques
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: false,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
        },
      }]);
      if ('error' in campRes) return [...report, `❌ Campanha: FALHA — ${campRes.error}`].join('\n');
      const campRn = campRes.resourceNames[0];
      const campId = campRn.split('/').pop();
      report.push('✅ Campanha criada (PAUSADA — revise e ative no painel)');
      report.push(`   Nome: ${nome}`);
      report.push(`   Tipo: Pesquisa (só Google Search)`);
      report.push(`   Orçamento diário: R$ ${budget.toFixed(2)} · Lances: Maximizar cliques`);
      report.push(`   ID: ${campId}`);
      report.push('');

      // 3) Segmentação: localização + idioma português
      const critRes = await lunaGoogleMutate(customerId, token, login, 'campaignCriteria', [
        ...geoRns.map(rn => ({ create: { campaign: campRn, location: { geoTargetConstant: rn } } })),
        { create: { campaign: campRn, language: { languageConstant: 'languageConstants/1014' } } },
      ]);
      report.push('error' in critRes
        ? `⚠️ Segmentação: FALHA (${critRes.error}) — ajuste localização/idioma no painel`
        : `✅ Segmentação: ${geoLabel} · Português`);

      // 4) Grupo de anúncios
      const agRes = await lunaGoogleMutate(customerId, token, login, 'adGroups', [{
        create: { name: `Grupo 1 — ${nome}`, campaign: campRn, type: 'SEARCH_STANDARD', status: 'ENABLED' },
      }]);
      if ('error' in agRes) return [...report, `⚠️ Grupo de anúncios: FALHA — ${agRes.error}`, `   Campanha criada (ID ${campId}) — finalize grupo/anúncio no painel.`].join('\n');
      const agRn = agRes.resourceNames[0];
      report.push(`✅ Grupo de anúncios criado`);

      // 5) Palavras-chave
      const kwRes = await lunaGoogleMutate(customerId, token, login, 'adGroupCriteria',
        keywords.map((kw: string) => ({ create: { adGroup: agRn, status: 'ENABLED', keyword: { text: kw, matchType } } })));
      report.push('error' in kwRes
        ? `⚠️ Palavras-chave: FALHA (${kwRes.error}) — adicione no painel`
        : `✅ ${keywords.length} palavra(s)-chave [${matchType}]: ${keywords.slice(0, 8).join(', ')}${keywords.length > 8 ? '…' : ''}`);

      // 6) Anúncio responsivo de pesquisa
      const adRes = await lunaGoogleMutate(customerId, token, login, 'adGroupAds', [{
        create: {
          adGroup: agRn,
          status: 'ENABLED',
          ad: {
            finalUrls: [finalUrl],
            responsiveSearchAd: {
              headlines: headlines.map((t: string) => ({ text: t })),
              descriptions: descriptions.map((t: string) => ({ text: t })),
            },
          },
        },
      }]);
      report.push('error' in adRes
        ? `⚠️ Anúncio RSA: FALHA (${adRes.error}) — crie o anúncio no painel`
        : `✅ Anúncio RSA criado (${headlines.length} títulos · ${descriptions.length} descrições → ${finalUrl})`);

      report.push('');
      report.push('▶️ Próximo passo: revisar no painel do Google Ads e ATIVAR a campanha (está pausada de propósito).');
      return report.join('\n');
    }

    if (name === 'get_optimizer_analysis') {
      const clientId = input.client_id as string;
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (COALESCE(conta_plataforma, 'meta'))
                cliente_nome, conta_plataforma, semana_analise, estado_da_conta, resumo_executivo, resultado, created_at
           FROM public.optimizer_ai_logs
          WHERE cliente_id = $1 AND erro IS NULL
          ORDER BY COALESCE(conta_plataforma, 'meta'), created_at DESC`,
        [clientId]
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (rows.length === 0) return 'Nenhuma análise do Otimizador encontrada para esse cliente.';
      const out = rows.map(r => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultado: any = typeof r.resultado === 'string' ? JSON.parse(r.resultado as string) : r.resultado;
        return {
          plataforma: r.conta_plataforma ?? 'meta',
          semana: r.semana_analise,
          data: r.created_at,
          estado_da_conta: r.estado_da_conta,
          resumo_executivo: r.resumo_executivo,
          cruzamento_com_metas: resultado?.cruzamento_com_metas ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          acoes: (resultado?.acoes_automaticas ?? []).slice(0, 8).map((a: any) => ({ acao: a.acao_tipo ?? a.acao, objeto: a.objeto_nome ?? a.nome, status: a.status, motivo: (a.justificativa ?? a.motivo ?? '').slice(0, 200) })),
        };
      });
      return JSON.stringify(out).slice(0, 8000);
    }

    if (name === 'get_client_goals') {
      const clientId = input.client_id as string;
      const [goals, planning] = await Promise.all([
        pool.query('SELECT type, label, format, target, partial, realized FROM public.client_goals WHERE client_id = $1', [clientId]).catch(() => ({ rows: [] })),
        pool.query('SELECT tkm, cpl_meta, stages FROM public.client_planning WHERE client_id = $1', [clientId]).catch(() => ({ rows: [] })),
      ]);
      if (goals.rows.length === 0 && planning.rows.length === 0) return 'Cliente sem meta/planejamento cadastrado.';
      return JSON.stringify({
        meta: goals.rows[0] ?? null,
        planejamento: planning.rows[0] ?? null,
        observacao: 'target = meta do período; tkm = ticket médio; cpl_meta = CPL alvo; stages = funil planejado (etapa + taxa de conversão).',
      });
    }

    if (name === 'get_lead_attribution' || name === 'get_demographics') {
      const clientId = input.client_id as string;
      const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const url = name === 'get_lead_attribution'
        ? `${baseUrl}/api/tracking/leads?clientId=${encodeURIComponent(clientId)}&days=${Number(input.days) || 30}&limit=40`
        : `${baseUrl}/api/tracking/demografia?clientId=${encodeURIComponent(clientId)}`;
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return `Não consegui buscar (${name === 'get_lead_attribution' ? 'rastreio' : 'demografia'}) — HTTP ${res?.status ?? 'sem resposta'}.`;
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = data;
      if (name === 'get_lead_attribution' && d?.leads) d.leads = d.leads.slice(0, 25);
      return JSON.stringify(d).slice(0, 9000);
    }

    if (name === 'get_social_monitor') {
      const clientId = input.client_id as string | undefined;
      const { rows } = await pool.query(
        `SELECT s.client_id, c.name AS cliente, s.ig_username, s.followers, s.last_post_at, s.posts_30d,
                s.avg_likes, s.avg_comments, s.reach_28d, s.red_after_days, s.error, s.fetched_at
           FROM public.social_monitor_snapshots s
           LEFT JOIN public.clients c ON c.id = s.client_id
          WHERE s.monitored = TRUE ${clientId ? 'AND s.client_id = $1' : ''}
          ORDER BY s.last_post_at ASC NULLS FIRST`,
        clientId ? [clientId] : []
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (rows.length === 0) return 'Nenhum snapshot do monitor de redes sociais (rode a coleta em Radar → Redes Sociais).';
      const now = Date.now();
      const out = rows.map(r => ({
        cliente: r.cliente ?? r.client_id,
        instagram: r.ig_username,
        dias_sem_post: r.last_post_at ? Math.floor((now - new Date(r.last_post_at as string).getTime()) / 86400_000) : null,
        regua_vermelho_dias: r.red_after_days,
        seguidores: r.followers, posts_30d: r.posts_30d,
        alcance_28d: r.reach_28d, media_curtidas: r.avg_likes, media_comentarios: r.avg_comments,
        erro: r.error, coletado_em: r.fetched_at,
      }));
      return JSON.stringify(out).slice(0, 9000);
    }

    if (name === 'get_ai_costs') {
      const clientId = input.client_id as string | undefined;
      const mesAno = input.mes_ano as string | undefined;
      const conds: string[] = [];
      const params: unknown[] = [];
      if (clientId) { params.push(clientId); conds.push(`u.client_id = $${params.length}`); }
      if (mesAno) { params.push(mesAno); conds.push(`u.mes_ano = $${params.length}`); }
      const { rows } = await pool.query(
        `SELECT u.client_id, c.name AS cliente, u.mes_ano, u.chamadas_ia, u.tokens_usados, u.custo_estimado_usd
           FROM public.ia_uso_mensal u LEFT JOIN public.clients c ON c.id = u.client_id
          ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
          ORDER BY u.mes_ano DESC, u.custo_estimado_usd DESC LIMIT 60`,
        params
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (rows.length === 0) return 'Nenhum uso de IA registrado para esse filtro.';
      return JSON.stringify(rows);
    }

    // ── Pacote B: CRM profundo ──────────────────────────────────────────────
    if (name === 'search_crm_leads') {
      const clientId = input.client_id as string;
      const limit = Math.min(50, Number(input.limit) || 20);
      const conds = ['client_id = $1'];
      const params: unknown[] = [clientId];
      if (input.query) {
        const digits = String(input.query).replace(/\D/g, '');
        params.push(`%${input.query}%`);
        if (digits.length >= 4) {
          params.push(`%${digits}%`);
          conds.push(`(nome ILIKE $${params.length - 1} OR numero LIKE $${params.length})`);
        } else {
          conds.push(`nome ILIKE $${params.length}`);
        }
      }
      if (input.status) { params.push(input.status); conds.push(`status = $${params.length}`); }
      if (input.days) { params.push(Number(input.days)); conds.push(`created_at >= NOW() - ($${params.length} || ' days')::interval`); }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT id, nome, numero, email, status, temperatura, origin, campaign_name, adset_name, ad_name,
                utm_source, regiao_uf, fechou, valor_rs, time_interno, created_at
           FROM public.crm_leads WHERE ${conds.join(' AND ')}
          ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      if (rows.length === 0) return 'Nenhum lead encontrado com esses filtros.';
      return JSON.stringify(rows);
    }

    if (name === 'get_lead_conversation') {
      const clientId = input.client_id as string;
      const limit = Math.min(60, Number(input.limit) || 30);
      let leadId = input.lead_id as string | undefined;
      let leadRow: { id: string; nome: string | null; numero: string | null; status: string | null } | undefined;
      if (leadId) {
        const { rows } = await pool.query('SELECT id, nome, numero, status FROM public.crm_leads WHERE client_id = $1 AND id = $2::uuid', [clientId, leadId]);
        leadRow = rows[0];
      } else if (input.phone) {
        const digits = String(input.phone).replace(/\D/g, '');
        const { rows } = await pool.query(
          `SELECT id, nome, numero, status FROM public.crm_leads WHERE client_id = $1 AND regexp_replace(COALESCE(numero,''), '\\D', '', 'g') LIKE $2 ORDER BY created_at DESC LIMIT 1`,
          [clientId, `%${digits.slice(-8)}%`]
        );
        leadRow = rows[0];
      }
      if (!leadRow) return 'Lead não encontrado (confira lead_id/phone e o cliente). Use search_crm_leads.';
      leadId = leadRow.id;
      const { rows: msgs } = await pool.query(
        `SELECT direction, text, created_at FROM public.crm_messages WHERE lead_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [leadId, limit]
      ).catch(() => ({ rows: [] as { direction: string; text: string | null; created_at: string }[] }));
      if (msgs.length === 0) return `Lead ${leadRow.nome ?? leadRow.numero} encontrado, mas sem mensagens registradas.`;
      const conversa = msgs.reverse().map(m => ({
        de: m.direction === 'in' ? 'LEAD' : 'ATENDENTE',
        texto: (m.text ?? '').slice(0, 400),
        em: m.created_at,
      }));
      return JSON.stringify({ lead: { id: leadRow.id, nome: leadRow.nome, numero: leadRow.numero, etapa: leadRow.status }, mensagens: conversa }).slice(0, 9000);
    }

    if (name === 'move_crm_lead') {
      const clientId = input.client_id as string;
      const leadId = String(input.lead_id ?? '');
      const newStatus = String(input.new_status ?? '').trim();
      const { rows: leadRows } = await pool.query(
        'SELECT id, nome, numero, status, funnel_id, valor_rs, ctwa_clid FROM public.crm_leads WHERE client_id = $1 AND id = $2::uuid',
        [clientId, leadId]
      );
      const lead = leadRows[0];
      if (!lead) return 'Lead não encontrado nesse cliente. Use search_crm_leads para achar o id certo.';
      // Só etapas REAIS do funil — mesma lição da IA do Kanban (status órfão some da tela).
      const { rows: stageRows } = lead.funnel_id
        ? await pool.query('SELECT label FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position', [lead.funnel_id])
        : await pool.query(
            `SELECT s.label FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id WHERE f.client_id = $1 ORDER BY s.position`,
            [clientId]
          );
      const labels = stageRows.map(r => r.label as string);
      if (labels.length > 0 && !labels.includes(newStatus)) {
        return `Etapa "${newStatus}" não existe no funil desse cliente. Etapas válidas: ${labels.join(' | ')}.`;
      }
      await pool.query('UPDATE public.crm_leads SET status = $1 WHERE client_id = $2 AND id = $3::uuid', [newStatus, clientId, leadId]);
      try {
        await dispararEventosPorStatus(pool, clientId, newStatus, { id: lead.id, phone: lead.numero ?? '', ctwaClid: lead.ctwa_clid ?? null }, lead.valor_rs != null ? Number(lead.valor_rs) : null);
      } catch { /* conversão é best-effort */ }
      return `✅ Lead ${lead.nome ?? lead.numero} movido de "${lead.status ?? '—'}" para "${newStatus}".`;
    }

    if (name === 'get_crm_stats') {
      const clientId = input.client_id as string;
      const days = Number(input.days) || 90;
      const [stages, byStatus, byOrigin, byTemp, fechados, monthly] = await Promise.all([
        pool.query(`SELECT s.label FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id WHERE f.client_id = $1 ORDER BY s.position`, [clientId]).catch(() => ({ rows: [] })),
        pool.query(`SELECT status, COUNT(*)::int AS total FROM public.crm_leads WHERE client_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval GROUP BY status ORDER BY total DESC`, [clientId, days]),
        pool.query(`SELECT COALESCE(origin,'desconhecida') AS origem, COUNT(*)::int AS total FROM public.crm_leads WHERE client_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval GROUP BY 1 ORDER BY total DESC`, [clientId, days]),
        pool.query(`SELECT COALESCE(temperatura,'sem') AS temperatura, COUNT(*)::int AS total FROM public.crm_leads WHERE client_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval GROUP BY 1`, [clientId, days]),
        pool.query(`SELECT COUNT(*)::int AS fechados, COALESCE(SUM(CASE WHEN valor_rs::text ~ '^[0-9.,]+$' THEN REPLACE(valor_rs::text, ',', '.')::numeric ELSE 0 END), 0) AS faturamento FROM public.crm_leads WHERE client_id = $1 AND fechou = TRUE AND created_at >= NOW() - ($2 || ' days')::interval`, [clientId, days]).catch(() => ({ rows: [{ fechados: 0, faturamento: 0 }] })),
        pool.query(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes, COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE fechou)::int AS fechados FROM public.crm_leads WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '6 months' GROUP BY 1 ORDER BY 1`, [clientId]),
      ]);
      return JSON.stringify({
        janela_dias: days,
        etapas_do_funil: stages.rows.map(r => (r as { label: string }).label),
        leads_por_etapa: byStatus.rows,
        leads_por_origem: byOrigin.rows,
        leads_por_temperatura: byTemp.rows,
        fechamentos: fechados.rows[0],
        evolucao_mensal_6m: monthly.rows,
      });
    }

    // ── Pacote D: agendamento ───────────────────────────────────────────────
    if (name === 'schedule_luna_task') {
      const { titulo, instrucao, tipo, run_at, em_minutos, hora, dia_semana, dia_mes, whatsapp_phone, permitir_acoes } = input as {
        titulo: string; instrucao: string; tipo: string; run_at?: string; em_minutos?: number; hora?: string;
        dia_semana?: number; dia_mes?: number; whatsapp_phone?: string; permitir_acoes?: boolean;
      };
      if (!['once', 'daily', 'weekly', 'monthly'].includes(tipo)) return 'tipo deve ser once, daily, weekly ou monthly.';
      // Tempo relativo ("daqui a 30 min"): o SERVIDOR calcula — imune a erro de fuso/relógio da IA.
      const nextRun = tipo === 'once' && Number(em_minutos) > 0
        ? new Date(Date.now() + Math.min(60 * 24 * 30, Number(em_minutos)) * 60_000)
        : computeNextRun(tipo, { run_at, hora, dia_semana, dia_mes });
      if (!nextRun) return tipo === 'once' ? 'Para tarefa única, informe em_minutos (relativo) ou run_at no formato YYYY-MM-DD HH:MM (horário de Brasília).' : 'Não consegui calcular a próxima execução — confira hora/dia_semana/dia_mes.';
      if (nextRun.getTime() < Date.now() - 60_000) return `run_at está no passado (${fmtBrt(nextRun)}). Informe uma data futura.`;
      await ensureLunaTasksTable(pool);
      const sendInst = whatsapp_phone ? await getLunaSendInstance(pool) : null;
      if (whatsapp_phone && !sendInst) {
        return '❌ Não agendei: nenhuma instância de envio configurada pra Luna (o administrador precisa definir em Luna → Agendamentos → Instância de envio). Sem ela, o WhatsApp não seria entregue.';
      }
      const { rows } = await pool.query(
        `INSERT INTO public.luna_tasks (titulo, instrucao, tipo, hora, dia_semana, dia_mes, whatsapp_phone, zapi_client_id, permitir_acoes, next_run_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [titulo, instrucao, tipo, hora ?? null, dia_semana ?? null, dia_mes ?? null, whatsapp_phone ?? null, null, permitir_acoes === true, nextRun.toISOString()]
      );
      const recorrencia = tipo === 'once' ? 'única' : tipo === 'daily' ? 'diária' : tipo === 'weekly' ? 'semanal' : 'mensal';
      return `✅ Tarefa agendada!\nTítulo: ${titulo}\nRecorrência: ${recorrencia}\nPróxima execução: ${fmtBrt(nextRun)} (Brasília)\n${whatsapp_phone ? `Resultado será enviado no WhatsApp ${whatsapp_phone} pela instância "${sendInst!.name}"` : 'Resultado ficará salvo (veja com list_luna_tasks)'}\nID: ${rows[0].id}`;
    }

    if (name === 'list_luna_tasks') {
      await ensureLunaTasksTable(pool);
      const { rows } = await pool.query(
        `SELECT id, titulo, tipo, hora, dia_semana, dia_mes, whatsapp_phone, permitir_acoes, enabled, next_run_at, last_run_at, LEFT(COALESCE(last_result,''), 300) AS last_result
           FROM public.luna_tasks ORDER BY enabled DESC, next_run_at ASC LIMIT 30`
      );
      if (rows.length === 0) return 'Nenhuma tarefa agendada.';
      return JSON.stringify(rows.map(r => ({
        ...r,
        proxima_execucao_brt: r.enabled ? fmtBrt(r.next_run_at) : null,
        ultima_execucao_brt: fmtBrt(r.last_run_at),
      })));
    }

    if (name === 'cancel_luna_task') {
      await ensureLunaTasksTable(pool);
      const { rows } = await pool.query('UPDATE public.luna_tasks SET enabled = FALSE WHERE id = $1::uuid RETURNING titulo', [String(input.task_id ?? '')]);
      if (rows.length === 0) return 'Tarefa não encontrada.';
      return `✅ Tarefa "${rows[0].titulo}" cancelada.`;
    }

    return 'Ferramenta desconhecida.';
  } catch (err) {
    return `Erro: ${String(err)}`;
  } finally {
    await pool.end();
  }
}

export async function execExternalTool(tool: ExternalTool, input: Record<string, unknown>): Promise<string> {
  try {
    if (tool.type === 'webhook') {
      const cfg = tool.config as { url: string; method?: string; headers?: Record<string, string> };
      const res = await fetch(cfg.url, {
        method: cfg.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) },
        body: JSON.stringify({ input, tool: tool.name, timestamp: new Date().toISOString() }),
      });
      if (!res.ok) return `Webhook retornou erro HTTP ${res.status}`;
      const text = await res.text();
      return text || 'Webhook executado com sucesso.';
    }

    if (tool.type === 'zapi_whatsapp') {
      const cfg = tool.config as { zapi_client_id?: string; instance_id?: string; token?: string; security_token?: string };
      const phone = String(input.phone ?? '');
      const message = String(input.message ?? '');
      if (!phone || !message) return 'Parâmetros phone e message são obrigatórios.';

      let instanceId = cfg.instance_id ?? '';
      let token = cfg.token ?? '';
      let securityToken = cfg.security_token;

      // Look up credentials from existing zapi_clients if referenced by ID
      if (cfg.zapi_client_id) {
        const pool2 = makeServerPool();
        try {
          const { rows } = await pool2.query(
            'SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1 LIMIT 1',
            [cfg.zapi_client_id]
          );
          if (rows[0]) { instanceId = rows[0].instance_id; token = rows[0].token; securityToken = rows[0].security_token ?? undefined; }
        } finally { await pool2.end(); }
      }

      if (!instanceId || !token) return 'Configuração Z-API incompleta — instance_id e token são obrigatórios.';
      const result = await sendText({ instanceId, token, clientToken: securityToken }, phone, message);
      return result.ok ? 'Mensagem WhatsApp enviada com sucesso.' : `Erro ao enviar: ${result.error}`;
    }

    return 'Tipo de ferramenta não suportado.';
  } catch (err) {
    return `Erro: ${String(err)}`;
  }
}
