import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { google as googleapis } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { sendText, sendDocument } from '@/lib/zapi';
import { generateReportPdf } from '@/lib/report-pdf';
import { getFreshMetaToken } from '@/lib/meta-token';
import { resolveMetaPeriod, resolveGaqlPeriod, applyMetaDateToUrl } from '@/lib/period-utils';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_INSTRUCTIONS = `Você é Luna, assistente inteligente da Onmid Marketing.`;

// --- DB helpers ---

async function getInstructions(): Promise<string> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query("SELECT instructions FROM public.agent_instructions WHERE id = 'default'");
    return rows[0]?.instructions ?? DEFAULT_INSTRUCTIONS;
  } catch { return DEFAULT_INSTRUCTIONS; } finally { await pool.end(); }
}

type KnowledgeItem = { id: string; title: string; type: string; content: string; mime_type?: string };

async function getKnowledge(): Promise<KnowledgeItem[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query('SELECT id, title, type, content, mime_type FROM public.agent_knowledge ORDER BY created_at ASC');
    return rows;
  } catch { return []; } finally { await pool.end(); }
}

type ExternalTool = { id: string; name: string; description: string; type: string; config: Record<string, unknown>; enabled: boolean };

async function getExternalTools(): Promise<ExternalTool[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query("SELECT id, name, description, type, config, enabled FROM public.agent_external_tools WHERE enabled = true ORDER BY created_at ASC");
    return rows;
  } catch { return []; } finally { await pool.end(); }
}

// --- Core system tools ---

const systemTools: Anthropic.Tool[] = [
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
    description: 'Busca campanhas e métricas do Meta Ads para um cliente. Inclui gasto, impressões, cliques, CTR, leads e CPL. Também retorna o ID das campanhas para operações de pause/ativar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        period: { type: 'string', description: 'Período: this_month, last_7d, last_30d, last_month (padrão: this_month)' },
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
        period: { type: 'string', description: 'Período: this_month, last_7d, last_30d, last_month (padrão: this_month)' },
      },
      required: ['client_id'],
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
    description: 'Gera um relatório de performance completo para um cliente com dados do período.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        period: { type: 'string', description: 'Período do relatório (padrão: this_month)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'send_report_pdf_whatsapp',
    description: 'Gera um relatório de performance em PDF e envia via WhatsApp usando Z-API. Use quando o usuário pedir para enviar o relatório de um cliente pelo WhatsApp. Se não souber qual Z-API usar, pergunte ao usuário.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente para gerar o relatório' },
        phone: { type: 'string', description: 'Número do WhatsApp com DDI (ex: 5511999999999)' },
        period: { type: 'string', description: 'Período: this_month, last_month, last_30d, last_7d (padrão: this_month)' },
        caption: { type: 'string', description: 'Mensagem de texto que acompanha o PDF (opcional)' },
        zapi_client_id: { type: 'string', description: 'ID da conexão Z-API a usar. Se não souber, use list_zapi_clients primeiro.' },
      },
      required: ['client_id', 'phone'],
    },
  },
  {
    name: 'generate_report_pdf',
    description: 'Gera um relatório de performance em PDF e disponibiliza para download diretamente no chat. Use quando o usuário pedir para ver, gerar ou baixar um relatório em PDF no chat.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente para gerar o relatório' },
        period: { type: 'string', description: 'Período: this_month, last_month, last_30d, last_7d (padrão: this_month)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'list_zapi_clients',
    description: 'Lista as conexões Z-API disponíveis para envio de WhatsApp.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];

// --- Tool executors ---

async function saveReportToDb(
  pool: ReturnType<typeof makeServerPool>,
  pdfBuffer: Buffer,
  filename: string,
  clientName: string
): Promise<string> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.agent_report_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pdf_data BYTEA NOT NULL,
      filename TEXT NOT NULL,
      client_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    )
  `);
  const { rows } = await pool.query(
    `INSERT INTO public.agent_report_files (pdf_data, filename, client_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [pdfBuffer, filename, clientName]
  );
  return rows[0].id as string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execSystemTool(
  name: string,
  input: Record<string, any>,
  onEvent?: (event: Record<string, unknown>) => void
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
      const { rows } = clientId
        ? await pool.query('SELECT name, phone, email, status, created_at FROM public.crm_leads WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2', [clientId, limit])
        : await pool.query('SELECT name, phone, email, status, client_id, created_at FROM public.crm_leads ORDER BY created_at DESC LIMIT $1', [limit]);
      if (rows.length === 0) return 'Nenhum lead encontrado.';
      return JSON.stringify(rows);
    }

    if (name === 'get_meta_campaigns' || (name === 'generate_client_report' && input._platform === 'meta')) {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const metaPeriod = resolveMetaPeriod(period);

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

      const META_LEAD_ACTIONS = ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead','onsite_conversion.lead','onsite_web_lead','messaging_conversation_started_7d','total_messaging_connection'];

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
            const leads = ((row.actions ?? []) as { action_type: string; value: string }[])
              .filter(a => META_LEAD_ACTIONS.includes(a.action_type))
              .reduce((s, a) => s + parseInt(a.value || '0', 10), 0);
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

      if (name === 'generate_client_report') return JSON.stringify(campaigns.slice(0, 20));
      if (campaigns.length === 0) return 'Nenhuma campanha Meta encontrada para esse período. Verifique se a conta está vinculada corretamente.';
      return JSON.stringify(campaigns.slice(0, 30));
    }

    if (name === 'get_google_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const gaqlPeriod = resolveGaqlPeriod(period);
      const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';

      const { rows: links } = await pool.query(
        "SELECT account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'google_ads'",
        [clientId]
      );
      if (links.length === 0) return 'Nenhuma conta Google Ads vinculada a esse cliente.';

      const { rows: googleConns } = await pool.query("SELECT * FROM public.google_connections WHERE status = 'connected'");
      if (googleConns.length === 0) return 'Nenhuma conexão Google Ads ativa.';

      const accountIds = [...new Set(links.map((l) => l.account_id.replace(/\D/g, '')).filter(Boolean))];
      const campaigns: Record<string, unknown>[] = [];
      const seen = new Set<string>();

      await Promise.allSettled(googleConns.map(async (conn) => {
        // Refresh token
        const oauth2 = new googleapis.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2.setCredentials({ refresh_token: conn.refresh_token });
        let accessToken = conn.access_token;
        try {
          if (!conn.token_expiry || new Date(conn.token_expiry).getTime() < Date.now() + 5 * 60 * 1000) {
            const { credentials } = await oauth2.refreshAccessToken();
            accessToken = credentials.access_token ?? accessToken;
          }
        } catch { /* use existing */ }

        await Promise.allSettled(accountIds.map(async (accountId) => {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': DEV_TOKEN,
            'Content-Type': 'application/json',
          };
          const res = await fetch(`https://googleads.googleapis.com/v20/customers/${accountId}/googleAds:search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query: `SELECT campaign.id, campaign.name, campaign.status,
                        metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
                      FROM campaign
                      WHERE ${gaqlPeriod}
                        AND campaign.status IN ('ENABLED', 'PAUSED')
                        AND metrics.cost_micros > 0
                      ORDER BY metrics.cost_micros DESC LIMIT 30`,
            }),
          });
          if (!res.ok) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = await res.json() as { results?: any[] };
          for (const row of data.results ?? []) {
            const campaign = row.campaign ?? {};
            const metrics = row.metrics ?? {};
            const spend = Number(metrics.costMicros ?? 0) / 1_000_000;
            if (spend <= 0) continue;
            const key = `${accountId}:${campaign.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
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
      }));

      if (campaigns.length === 0) return 'Nenhuma campanha Google encontrada para esse período.';
      return JSON.stringify(campaigns.slice(0, 30));
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
      return `Campanha ${campaign_id} ${status === 'PAUSED' ? 'pausada' : 'ativada'} com sucesso.`;
    }

    if (name === 'generate_client_report') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const { rows: clientRows } = await pool.query('SELECT name, segment FROM public.clients WHERE id = $1', [clientId]);
      if (!clientRows[0]) return 'Cliente não encontrado.';
      // Reuse the meta/google campaign tools by setting a flag
      const [metaResult, googleResult] = await Promise.allSettled([
        execSystemTool('get_meta_campaigns', { client_id: clientId, period, _platform: 'meta' }),
        execSystemTool('get_google_campaigns', { client_id: clientId, period }),
      ]);
      return JSON.stringify({
        client: clientRows[0], period,
        meta_campaigns: metaResult.status === 'fulfilled' ? JSON.parse(metaResult.value) : [],
        google_campaigns: googleResult.status === 'fulfilled' ? JSON.parse(googleResult.value) : [],
      });
    }

    if (name === 'generate_report_pdf') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'this_month';
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [clientId]);
      if (!clientRows[0]) return 'Cliente não encontrado.';
      const clientName = clientRows[0].name as string;

      let metaCampaigns: Record<string, unknown>[] = [];
      let googleCampaigns: Record<string, unknown>[] = [];
      let crmLeads: Record<string, unknown>[] = [];

      try {
        const r = await execSystemTool('get_meta_campaigns', { client_id: clientId, period });
        if (r && !r.startsWith('Nenhuma') && !r.startsWith('Erro')) metaCampaigns = JSON.parse(r);
      } catch { /* ignore */ }
      try {
        const r = await execSystemTool('get_google_campaigns', { client_id: clientId, period });
        if (r && !r.startsWith('Nenhuma') && !r.startsWith('Erro')) googleCampaigns = JSON.parse(r);
      } catch { /* ignore */ }
      try {
        const r = await execSystemTool('get_crm_data', { client_id: clientId, limit: 30 });
        if (r && !r.startsWith('Nenhum') && !r.startsWith('Erro')) crmLeads = JSON.parse(r);
      } catch { /* ignore */ }

      const periodLabels: Record<string, string> = {
        'this_month': 'Mês Atual', 'last_month': 'Mês Anterior',
        'last_30d': 'Últimos 30 dias', 'last_7d': 'Últimos 7 dias',
      };
      const pdfBuffer = await generateReportPdf({
        clientName, period: periodLabels[period] ?? period,
        metaCampaigns, googleCampaigns, crmLeads,
      });
      const filename = `Relatorio_${clientName.replace(/\s+/g, '_')}_${period}.pdf`;
      const reportId = await saveReportToDb(pool, pdfBuffer, filename, clientName);
      onEvent?.({ type: 'file_attachment', url: `/api/agent/report/${reportId}`, filename, label: `Relatório ${clientName} — ${periodLabels[period] ?? period}` });
      return `PDF do relatório gerado com sucesso! O arquivo está disponível para download no chat.`;
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

      // Get client name
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [client_id]);
      if (!clientRows[0]) return 'Cliente não encontrado.';
      const clientName = clientRows[0].name as string;

      // Resolve Z-API connection
      let zapiConn: { instance_id: string; token: string; security_token?: string } | null = null;
      if (zapi_client_id) {
        const { rows } = await pool.query('SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1', [zapi_client_id]);
        if (rows[0]) zapiConn = rows[0];
      }
      // Fallback: first active Z-API
      if (!zapiConn) {
        const { rows } = await pool.query("SELECT instance_id, token, security_token FROM public.zapi_clients WHERE active = true ORDER BY created_at ASC LIMIT 1");
        if (rows[0]) zapiConn = rows[0];
      }
      // Also check external tools configured in Luna for Z-API
      if (!zapiConn) {
        const { rows } = await pool.query("SELECT config FROM public.agent_external_tools WHERE type = 'zapi_whatsapp' AND enabled = true LIMIT 1");
        if (rows[0]?.config?.instance_id) {
          zapiConn = { instance_id: rows[0].config.instance_id, token: rows[0].config.token, security_token: rows[0].config.security_token };
        }
      }
      if (!zapiConn) return 'Nenhuma conexão Z-API encontrada. Use list_zapi_clients para ver as disponíveis.';

      // Fetch campaign and CRM data
      let metaCampaigns: Record<string, unknown>[] = [];
      let googleCampaigns: Record<string, unknown>[] = [];
      let crmLeads: Record<string, unknown>[] = [];

      try {
        const metaRaw = await execSystemTool('get_meta_campaigns', { client_id, period });
        if (metaRaw && !metaRaw.startsWith('Nenhuma') && !metaRaw.startsWith('Erro')) metaCampaigns = JSON.parse(metaRaw);
      } catch { /* ignore */ }
      try {
        const googleRaw = await execSystemTool('get_google_campaigns', { client_id, period });
        if (googleRaw && !googleRaw.startsWith('Nenhuma') && !googleRaw.startsWith('Erro')) googleCampaigns = JSON.parse(googleRaw);
      } catch { /* ignore */ }
      try {
        const crmRaw = await execSystemTool('get_crm_data', { client_id, limit: 30 });
        if (crmRaw && !crmRaw.startsWith('Nenhum') && !crmRaw.startsWith('Erro')) crmLeads = JSON.parse(crmRaw);
      } catch { /* ignore */ }

      // Generate PDF
      const periodLabels: Record<string, string> = {
        'this_month': 'Mês Atual', 'last_month': 'Mês Anterior',
        'last_30d': 'Últimos 30 dias', 'last_7d': 'Últimos 7 dias',
      };
      const pdfBuffer = await generateReportPdf({
        clientName,
        period: periodLabels[period] ?? period,
        metaCampaigns,
        googleCampaigns,
        crmLeads,
      });

      const b64 = pdfBuffer.toString('base64');
      const fileName = `Relatorio_${clientName.replace(/\s+/g, '_')}_${period}.pdf`;
      const msgCaption = caption ?? `📊 Relatório de Performance — ${clientName}\nPeríodo: ${periodLabels[period] ?? period}\n\nGerado via Luna IA · Onmid Reports`;

      // Save to DB and emit chat download event
      const reportId = await saveReportToDb(pool, pdfBuffer, fileName, clientName);
      onEvent?.({ type: 'file_attachment', url: `/api/agent/report/${reportId}`, filename: fileName, label: `Relatório ${clientName} — ${periodLabels[period] ?? period}` });

      const result = await sendDocument(
        { instanceId: zapiConn.instance_id, token: zapiConn.token, clientToken: zapiConn.security_token },
        phone, b64, fileName, msgCaption
      );

      if (result.ok) return `✅ Relatório de ${clientName} enviado com sucesso para ${phone}! O arquivo também está disponível para download no chat.`;
      return `❌ PDF gerado mas falha ao enviar via WhatsApp: ${result.error}. O arquivo está disponível para download no chat.`;
    }

    return 'Ferramenta desconhecida.';
  } catch (err) {
    return `Erro: ${String(err)}`;
  } finally {
    await pool.end();
  }
}

async function execExternalTool(tool: ExternalTool, input: Record<string, unknown>): Promise<string> {
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

// --- Streaming agent loop ---

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });

  const body = await req.json() as { messages: Anthropic.MessageParam[]; role?: string };
  const { messages, role } = body;
  if (!messages?.length) return Response.json({ error: 'Mensagens obrigatórias' }, { status: 400 });

  // Load everything in parallel
  const [instructions, knowledgeItems, externalTools] = await Promise.all([
    getInstructions(),
    getKnowledge(),
    getExternalTools(),
  ]);

  // Build system prompt with knowledge context
  const textKnowledge = knowledgeItems.filter(k => k.type !== 'pdf');
  let systemText = instructions;
  if (textKnowledge.length > 0) {
    systemText += '\n\n---\n## Base de Conhecimento\n\n';
    for (const item of textKnowledge) {
      systemText += `### ${item.title}\n${item.content.slice(0, 10000)}\n\n`;
    }
  }

  // Build dynamic external tools
  const dynTools: Anthropic.Tool[] = externalTools.map((t) => {
    const baseProps: Record<string, unknown> = {};
    if (t.type === 'zapi_whatsapp') {
      baseProps.phone = { type: 'string', description: 'Número do telefone com DDI (ex: 5511999999999)' };
      baseProps.message = { type: 'string', description: 'Texto da mensagem a enviar' };
    } else {
      baseProps.data = { type: 'object', description: 'Dados a enviar ao webhook' };
    }
    return {
      name: `ext_${t.id.replace(/-/g, '_')}`,
      description: t.description,
      input_schema: { type: 'object' as const, properties: baseProps, required: Object.keys(baseProps) },
    };
  });

  const allTools = [...systemTools, ...dynTools];

  // PDF knowledge items → inject as document blocks
  const pdfItems = knowledgeItems.filter(k => k.type === 'pdf');
  let augmentedMessages: Anthropic.MessageParam[] = [...messages];
  if (pdfItems.length > 0) {
    const docBlocks: Anthropic.DocumentBlockParam[] = pdfItems.map(pdf => ({
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: (pdf.mime_type || 'application/pdf') as 'application/pdf',
        data: pdf.content,
      },
      title: pdf.title,
    }));
    const pdfUserMsg: Anthropic.MessageParam = {
      role: 'user',
      content: [
        ...docBlocks,
        { type: 'text', text: 'Estes são documentos de referência que você deve consultar quando relevante.' },
      ],
    };
    const pdfAssistMsg: Anthropic.MessageParam = {
      role: 'assistant',
      content: 'Entendido. Li os documentos e os usarei como referência nas minhas respostas.',
    };
    augmentedMessages = [pdfUserMsg, pdfAssistMsg, ...messages];
  }

  const encoder = new TextEncoder();

  function send(controller: ReadableStreamDefaultController, event: Record<string, unknown>) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages = augmentedMessages;

        for (let iteration = 0; iteration < 10; iteration++) {
          const response = await client.messages.create({
            model: 'claude-opus-4-7',
            max_tokens: 4096,
            system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
            tools: allTools,
            messages: currentMessages,
            stream: true,
          });

          const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
          let currentToolInput = '';
          let currentToolId = '';
          let currentToolName = '';

          for await (const event of response) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                currentToolId = event.content_block.id;
                currentToolName = event.content_block.name;
                currentToolInput = '';
                send(controller, { type: 'tool_start', name: currentToolName });
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                send(controller, { type: 'text', text: event.delta.text });
              } else if (event.delta.type === 'input_json_delta') {
                currentToolInput += event.delta.partial_json;
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolName) {
                let parsedInput: Record<string, unknown> = {};
                try { parsedInput = JSON.parse(currentToolInput || '{}'); } catch { /* ignore */ }
                toolUseBlocks.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: parsedInput });
                currentToolName = '';
                currentToolInput = '';
              }
            } else if (event.type === 'message_stop') {
              break;
            }
          }

          if (toolUseBlocks.length === 0) break;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assistantContent: any[] = toolUseBlocks;

          const toolResults = await Promise.all(
            toolUseBlocks.map(async (block) => {
              let result: string;
              const extTool = externalTools.find(t => `ext_${t.id.replace(/-/g, '_')}` === block.name);
              if (extTool) {
                result = await execExternalTool(extTool, block.input);
              } else {
                result = await execSystemTool(block.name, block.input, (ev) => send(controller, ev));
              }
              send(controller, { type: 'tool_done', name: block.name });
              return { type: 'tool_result' as const, tool_use_id: block.id, content: result };
            })
          );

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: assistantContent },
            { role: 'user' as const, content: toolResults },
          ];
        }

        send(controller, { type: 'done', role });
      } catch (err) {
        send(controller, { type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
