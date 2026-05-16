import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { sendText } from '@/lib/zapi';
import { getFreshMetaToken } from '@/lib/meta-token';

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
        period: { type: 'string', description: 'Período: THIS_MONTH, LAST_7_DAYS, LAST_30_DAYS, LAST_MONTH, TODAY (padrão: THIS_MONTH)' },
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
        period: { type: 'string', description: 'Período: THIS_MONTH, LAST_7_DAYS, LAST_30_DAYS, LAST_MONTH (padrão: THIS_MONTH)' },
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
        period: { type: 'string', description: 'Período do relatório (padrão: THIS_MONTH)' },
      },
      required: ['client_id'],
    },
  },
];

// --- Tool executors ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execSystemTool(name: string, input: Record<string, any>): Promise<string> {
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

    if (name === 'get_meta_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'THIS_MONTH';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/campaigns?clientId=${clientId}&platform=meta&period=${period}`);
      if (!res.ok) return 'Erro ao buscar campanhas Meta.';
      const data = await res.json() as { campaigns?: unknown[] } | unknown[];
      const campaigns = Array.isArray(data) ? data : (data as { campaigns?: unknown[] }).campaigns ?? [];
      if (campaigns.length === 0) return 'Nenhuma campanha Meta encontrada para esse período.';
      return JSON.stringify((campaigns as unknown[]).slice(0, 30));
    }

    if (name === 'get_google_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'THIS_MONTH';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/campaigns?clientId=${clientId}&platform=google&period=${period}`);
      if (!res.ok) return 'Erro ao buscar campanhas Google.';
      const data = await res.json() as { campaigns?: unknown[] } | unknown[];
      const campaigns = Array.isArray(data) ? data : (data as { campaigns?: unknown[] }).campaigns ?? [];
      if (campaigns.length === 0) return 'Nenhuma campanha Google encontrada.';
      return JSON.stringify((campaigns as unknown[]).slice(0, 30));
    }

    if (name === 'get_account_balances') {
      const clientId = input.client_id as string;
      const { rows: links } = await pool.query('SELECT platform, connection_id FROM public.client_account_links WHERE client_id = $1', [clientId]);
      if (links.length === 0) return 'Nenhuma conta vinculada.';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const balances: Record<string, unknown> = {};
      const meta = links.find((l) => l.platform === 'meta');
      const google = links.find((l) => l.platform === 'google');
      if (meta) {
        try { const r = await fetch(`${baseUrl}/api/meta/account-balances?connectionId=${meta.connection_id}`); if (r.ok) balances.meta = await r.json(); } catch { /* ignore */ }
      }
      if (google) {
        try { const r = await fetch(`${baseUrl}/api/google/account-balances?connectionId=${google.connection_id}`); if (r.ok) balances.google = await r.json(); } catch { /* ignore */ }
      }
      return JSON.stringify(balances);
    }

    if (name === 'update_meta_campaign_status') {
      const { campaign_id, status, client_id } = input as { campaign_id: string; status: 'PAUSED' | 'ACTIVE'; client_id: string };
      // Find the Meta connection for this client
      const { rows: links } = await pool.query(
        "SELECT connection_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'meta' LIMIT 1",
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
      const period = (input.period as string) || 'THIS_MONTH';

      const { rows: clientRows } = await pool.query('SELECT name, segment FROM public.clients WHERE id = $1', [clientId]);
      if (!clientRows[0]) return 'Cliente não encontrado.';

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const [metaRes, googleRes] = await Promise.allSettled([
        fetch(`${baseUrl}/api/campaigns?clientId=${clientId}&platform=meta&period=${period}`).then(r => r.ok ? r.json() : null),
        fetch(`${baseUrl}/api/campaigns?clientId=${clientId}&platform=google&period=${period}`).then(r => r.ok ? r.json() : null),
      ]);

      const metaCampaigns = metaRes.status === 'fulfilled' && metaRes.value
        ? (Array.isArray(metaRes.value) ? metaRes.value : (metaRes.value as { campaigns?: unknown[] }).campaigns ?? []) : [];
      const googleCampaigns = googleRes.status === 'fulfilled' && googleRes.value
        ? (Array.isArray(googleRes.value) ? googleRes.value : (googleRes.value as { campaigns?: unknown[] }).campaigns ?? []) : [];

      return JSON.stringify({
        client: clientRows[0],
        period,
        meta: { campaigns: metaCampaigns.slice(0, 20) },
        google: { campaigns: googleCampaigns.slice(0, 20) },
      });
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
      const cfg = tool.config as { instance_id: string; token: string; security_token?: string };
      const phone = String(input.phone ?? '');
      const message = String(input.message ?? '');
      if (!phone || !message) return 'Parâmetros phone e message são obrigatórios.';
      const result = await sendText(
        { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.security_token },
        phone, message
      );
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
                result = await execSystemTool(block.name, block.input);
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
