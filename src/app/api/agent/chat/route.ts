import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_INSTRUCTIONS = `Você é Luna, assistente inteligente da Onmid Marketing.`;

async function getInstructions(): Promise<string> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query("SELECT instructions FROM public.agent_instructions WHERE id = 'default'");
    return rows[0]?.instructions ?? DEFAULT_INSTRUCTIONS;
  } catch {
    return DEFAULT_INSTRUCTIONS;
  } finally {
    await pool.end();
  }
}

// --- Tool definitions ---

const tools: Anthropic.Tool[] = [
  {
    name: 'list_clients',
    description: 'Lista todos os clientes cadastrados no sistema com nome, segmento e status.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_client_accounts',
    description: 'Retorna as contas de anúncios (Meta Ads e Google Ads) vinculadas a um cliente específico.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        client_name: { type: 'string', description: 'Nome do cliente (opcional, para busca por nome)' },
      },
      required: [],
    },
  },
  {
    name: 'get_crm_data',
    description: 'Retorna leads do CRM para um cliente específico, incluindo status e informações de contato.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
        limit: { type: 'number', description: 'Número máximo de leads a retornar (padrão: 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_meta_campaigns',
    description: 'Busca campanhas e métricas do Meta Ads (Facebook/Instagram) para um cliente. Inclui gasto, impressões, cliques, CTR, leads e CPL.',
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
    description: 'Busca campanhas e métricas do Google Ads para um cliente. Inclui gasto, impressões, cliques, CTR e conversões.',
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
    description: 'Retorna o saldo disponível nas contas de anúncios (Meta e/ou Google) de um cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_id: { type: 'string', description: 'ID do cliente' },
      },
      required: ['client_id'],
    },
  },
];

// --- Tool executors ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execTool(name: string, input: Record<string, any>): Promise<string> {
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
      if (!clientId) return 'Cliente não encontrado. Use list_clients para ver todos os clientes.';
      const { rows } = await pool.query(
        'SELECT platform, account_id, account_name, currency FROM public.client_account_links WHERE client_id = $1 ORDER BY platform',
        [clientId]
      );
      if (rows.length === 0) return `Nenhuma conta de anúncios vinculada ao cliente ${clientId}.`;
      return JSON.stringify(rows);
    }

    if (name === 'get_crm_data') {
      const limit = Number(input.limit) || 20;
      const clientId = input.client_id as string | undefined;
      const query = clientId
        ? 'SELECT name, phone, email, status, created_at FROM public.crm_leads WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2'
        : 'SELECT name, phone, email, status, client_id, created_at FROM public.crm_leads ORDER BY created_at DESC LIMIT $1';
      const params = clientId ? [clientId, limit] : [limit];
      const { rows } = await pool.query(query, params);
      if (rows.length === 0) return 'Nenhum lead encontrado.';
      return JSON.stringify(rows);
    }

    if (name === 'get_meta_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'THIS_MONTH';
      const { rows: links } = await pool.query(
        "SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'meta'",
        [clientId]
      );
      if (links.length === 0) return 'Nenhuma conta Meta Ads vinculada a esse cliente.';

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const results = await Promise.allSettled(
        links.map(async (link) => {
          const url = `${baseUrl}/api/campaigns?clientId=${clientId}&platform=meta&period=${period}`;
          const res = await fetch(url);
          if (!res.ok) return null;
          return res.json();
        })
      );
      const campaigns = results
        .filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled' && r.value !== null)
        .flatMap((r) => {
          const v = r.value as { campaigns?: unknown[] } | unknown[] | null;
          return Array.isArray(v) ? v : (v as { campaigns?: unknown[] })?.campaigns ?? [];
        });
      if (campaigns.length === 0) return 'Nenhuma campanha Meta encontrada para esse período.';
      return JSON.stringify(campaigns.slice(0, 30));
    }

    if (name === 'get_google_campaigns') {
      const clientId = input.client_id as string;
      const period = (input.period as string) || 'THIS_MONTH';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const url = `${baseUrl}/api/campaigns?clientId=${clientId}&platform=google&period=${period}`;
      const res = await fetch(url);
      if (!res.ok) return 'Erro ao buscar campanhas Google.';
      const data = await res.json() as { campaigns?: unknown[] } | unknown[];
      const campaigns = Array.isArray(data) ? data : (data as { campaigns?: unknown[] }).campaigns ?? [];
      if (campaigns.length === 0) return 'Nenhuma campanha Google encontrada para esse período.';
      return JSON.stringify((campaigns as unknown[]).slice(0, 30));
    }

    if (name === 'get_account_balances') {
      const clientId = input.client_id as string;
      const { rows: links } = await pool.query(
        'SELECT platform, connection_id, account_id FROM public.client_account_links WHERE client_id = $1',
        [clientId]
      );
      if (links.length === 0) return 'Nenhuma conta de anúncios vinculada.';

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const balances: Record<string, unknown> = {};

      const metaLinks = links.filter((l) => l.platform === 'meta');
      const googleLinks = links.filter((l) => l.platform === 'google');

      if (metaLinks.length > 0) {
        try {
          const connId = metaLinks[0].connection_id;
          const res = await fetch(`${baseUrl}/api/meta/account-balances?connectionId=${connId}`);
          if (res.ok) balances.meta = await res.json();
        } catch { /* ignore */ }
      }
      if (googleLinks.length > 0) {
        try {
          const connId = googleLinks[0].connection_id;
          const res = await fetch(`${baseUrl}/api/google/account-balances?connectionId=${connId}`);
          if (res.ok) balances.google = await res.json();
        } catch { /* ignore */ }
      }

      return JSON.stringify(balances);
    }

    return 'Ferramenta desconhecida.';
  } catch (err) {
    return `Erro ao executar ferramenta: ${String(err)}`;
  } finally {
    await pool.end();
  }
}

// --- Streaming agent loop ---

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });

  const body = await req.json() as { messages: Anthropic.MessageParam[]; role?: string };
  const { messages, role } = body;
  if (!messages?.length) return Response.json({ error: 'Mensagens obrigatórias' }, { status: 400 });

  const instructions = await getInstructions();
  const encoder = new TextEncoder();

  function send(controller: ReadableStreamDefaultController, event: Record<string, unknown>) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages: Anthropic.MessageParam[] = [...messages];

        // Agentic loop: keep going until stop_reason is 'end_turn' with no tool use
        for (let iteration = 0; iteration < 10; iteration++) {
          const response = await client.messages.create({
            model: 'claude-opus-4-7',
            max_tokens: 4096,
            system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }],
            tools,
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
                toolUseBlocks.push({
                  type: 'tool_use',
                  id: currentToolId,
                  name: currentToolName,
                  input: parsedInput,
                });
                currentToolName = '';
                currentToolInput = '';
              }
            } else if (event.type === 'message_stop') {
              break;
            }
          }

          if (toolUseBlocks.length === 0) break;

          // Execute tools and build result messages
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assistantContent: any[] = toolUseBlocks;

          const toolResults = await Promise.all(
            toolUseBlocks.map(async (block) => {
              const result = await execTool(block.name, block.input);
              send(controller, { type: 'tool_done', name: block.name });
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: result,
              };
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
