import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { sendText } from '@/lib/zapi';
import { logAiUsage } from '@/lib/ai-usage-logger';
import {
  getInstructions, systemTools, execSystemTool,
  ensureLunaTasksTable, computeNextRun,
} from '@/lib/luna-tools';

// Agendador da Luna — executa tarefas de public.luna_tasks sem usuário presente.
// Chamado pelo GitHub Actions (luna-scheduler.yml) a cada 15 min com ?secret=.
// Mesma família de secrets do follow-up worker (CRON_SECRET da Vercel é write-only).
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Ferramentas liberadas no modo headless. Ações que mexem em campanha/CRM só
// entram quando a tarefa foi criada com permitir_acoes=true (decisão explícita
// do usuário no agendamento). Criação de usuário/pagamentos/cofre NUNCA roda
// sem humano presente.
const HEADLESS_READ_TOOLS = new Set([
  'list_clients', 'get_client_accounts', 'get_crm_data', 'get_meta_campaigns', 'get_google_campaigns',
  'get_monthly_history', 'get_account_balances', 'list_zapi_clients', 'list_users', 'list_client_payments',
  'get_meta_structure', 'get_optimizer_analysis', 'get_client_goals', 'get_lead_attribution',
  'get_demographics', 'get_social_monitor', 'get_ai_costs', 'search_crm_leads', 'get_lead_conversation',
  'get_crm_stats', 'generate_report_pdf', 'send_report_pdf_whatsapp', 'list_luna_tasks',
]);
const HEADLESS_ACTION_TOOLS = new Set([
  'execute_ad_action', 'update_meta_campaign_status', 'duplicate_meta_campaign', 'move_crm_lead',
]);

type LunaTask = {
  id: string; titulo: string; instrucao: string; tipo: string;
  hora: string | null; dia_semana: number | null; dia_mes: number | null;
  whatsapp_phone: string | null; zapi_client_id: string | null; permitir_acoes: boolean;
};

async function runHeadlessAgent(task: LunaTask): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const instructions = await getInstructions();
  const allowed = systemTools.filter(t =>
    HEADLESS_READ_TOOLS.has(t.name) || (task.permitir_acoes && HEADLESS_ACTION_TOOLS.has(t.name)));

  const system = `${instructions}

---
## Modo tarefa agendada (sem usuário presente)
- Você está executando a tarefa agendada "${task.titulo}". NINGUÉM vai responder perguntas — nunca pergunte, decida e execute.
- Hoje é ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
- Sua ÚLTIMA mensagem de texto é o resultado final${task.whatsapp_phone ? ' e será enviada por WhatsApp' : ''}. Escreva em português claro, formato WhatsApp: use *negrito* e listas com "-", NUNCA tabelas markdown.
- Se algum dado não vier (conta desconectada, sem leads), diga isso honestamente no resultado em vez de inventar.`;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task.instrucao }];
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = '';

  for (let iter = 0; iter < 8; iter++) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system,
      tools: allowed,
      messages,
    });
    inputTokens += resp.usage.input_tokens;
    outputTokens += resp.usage.output_tokens;

    const textParts = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    if (textParts.length > 0) finalText = textParts.map(b => b.text).join('\n');

    if (resp.stop_reason !== 'tool_use') break;
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    messages.push({ role: 'assistant', content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const out = await execSystemTool(tu.name, tu.input as Record<string, unknown>).catch(err => `Erro: ${String(err)}`);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out).slice(0, 20000) });
    }
    messages.push({ role: 'user', content: results });
  }

  return { text: finalText || 'Tarefa executada, mas sem texto final gerado.', inputTokens, outputTokens };
}

async function deliverWhatsApp(pool: ReturnType<typeof makeServerPool>, task: LunaTask, text: string): Promise<string | null> {
  if (!task.whatsapp_phone) return null;
  const { rows } = task.zapi_client_id
    ? await pool.query(`SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1`, [task.zapi_client_id])
    : await pool.query(`SELECT instance_id, token, security_token FROM public.zapi_clients WHERE active = TRUE AND COALESCE(provider,'zapi') <> 'evolution' ORDER BY created_at ASC LIMIT 1`);
  const inst = rows[0] as { instance_id: string; token: string; security_token: string | null } | undefined;
  if (!inst) return 'sem conexão Z-API disponível';
  const r = await sendText(
    { instanceId: inst.instance_id, token: inst.token, clientToken: inst.security_token ?? undefined },
    task.whatsapp_phone,
    `🤖 *Luna — ${task.titulo}*\n\n${text}`.slice(0, 4000),
  );
  return r.ok ? null : (r.error ?? 'falha no envio');
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  if (valid.length === 0 || !valid.includes(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pool = makeServerPool();
  const started = Date.now();
  const ran: Array<{ id: string; titulo: string; ok: boolean; erro?: string }> = [];
  try {
    await ensureLunaTasksTable(pool);
    const { rows: due } = await pool.query<LunaTask>(
      `SELECT id, titulo, instrucao, tipo, hora, dia_semana, dia_mes, whatsapp_phone, zapi_client_id, permitir_acoes
         FROM public.luna_tasks
        WHERE enabled = TRUE AND next_run_at <= NOW()
        ORDER BY next_run_at ASC LIMIT 3`
    );

    for (const task of due) {
      // Orçamento de tempo: não começa tarefa nova com menos de 15s sobrando.
      if (Date.now() - started > 45_000) break;
      try {
        const { text, inputTokens, outputTokens } = await runHeadlessAgent(task);
        const deliveryError = await deliverWhatsApp(pool, task, text);
        const resultNote = deliveryError ? `${text}\n\n[Falha no WhatsApp: ${deliveryError}]` : text;
        const next = task.tipo === 'once' ? null : computeNextRun(task.tipo, task);
        await pool.query(
          `UPDATE public.luna_tasks SET last_run_at = NOW(), last_result = $1,
                  enabled = $2, next_run_at = COALESCE($3, next_run_at)
            WHERE id = $4`,
          [resultNote.slice(0, 6000), next != null, next?.toISOString() ?? null, task.id]
        );
        void logAiUsage({ source: 'luna_scheduler', model: 'claude-sonnet-4-6', inputTokens, outputTokens });
        ran.push({ id: task.id, titulo: task.titulo, ok: !deliveryError, erro: deliveryError ?? undefined });
      } catch (err) {
        // Falha na execução: registra e empurra 1h pra frente (evita loop de erro a cada 15min).
        await pool.query(
          `UPDATE public.luna_tasks SET last_run_at = NOW(), last_result = $1,
                  next_run_at = CASE WHEN tipo = 'once' THEN next_run_at ELSE NOW() + INTERVAL '1 hour' END,
                  enabled = (tipo <> 'once')
            WHERE id = $2`,
          [`ERRO: ${String(err)}`.slice(0, 2000), task.id]
        ).catch(() => {});
        ran.push({ id: task.id, titulo: task.titulo, ok: false, erro: String(err) });
      }
    }

    return Response.json({ ok: true, due: due.length, ran });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
