import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { logAiUsage } from '@/lib/ai-usage-logger';
import {
  getInstructions, getKnowledge, getExternalTools,
  systemTools, execSystemTool, execExternalTool,
} from '@/lib/luna-tools';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


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

  // Always-on operational rules
  systemText += `

---
## Regras operacionais obrigatórias

- Quando uma ferramenta retornar um relatório de operação (create_meta_campaign, create_google_campaign, generate_client_report, generate_report_pdf, send_report_pdf_whatsapp, create_user, create_webhook, create_disparo, schedule_payment, link_account), copie e exiba o conteúdo EXATO retornado pela ferramenta, sem resumir, parafrasear ou omitir linhas. O relatório já está formatado para o usuário.
- Se a ferramenta retornar ✅ ou ❌ em alguma linha, preserve esses símbolos.
- Nunca substitua um relatório de múltiplas linhas por uma única frase curta.

## Confirmação obrigatória antes de ações sensíveis
As ferramentas add_client_vault_credential, reschedule_client_payment, set_client_payment_due_day e create_user alteram dados sensíveis (senhas, pagamentos, acesso ao sistema). Para estas ferramentas:
1. NUNCA as chame na mesma resposta em que o usuário pediu a ação. Primeiro responda em texto (sem tool_use) descrevendo exatamente o que você vai fazer — cliente, valores, datas — e pergunte "confirma?". NUNCA reescreva a senha em texto na sua confirmação.
2. Se o usuário pedir para mudar "a data de pagamento" sem dizer se é só uma vez ou definitivo, pergunte explicitamente: "é só para este pagamento (ajuste pontual) ou quer mudar o dia fixo de vencimento pra sempre?" antes de decidir entre reschedule_client_payment e set_client_payment_due_day.
3. Só chame a ferramenta depois que o usuário confirmar explicitamente ("sim", "confirma", "pode") em uma mensagem separada.
4. Ferramentas de leitura e configure_optimizer_client/generate_report_pdf/send_report_pdf_whatsapp/update_meta_campaign_status NÃO precisam desta confirmação — execute direto como já faz hoje.

## Períodos e histórico mês a mês
- Você TEM acesso a qualquer intervalo de datas: get_meta_campaigns e get_google_campaigns aceitam period='custom' com date_from/date_to (YYYY-MM-DD).
- Para pedidos de evolução mensal ("mês a mês", "de janeiro a julho", "histórico do ano"), use get_monthly_history — UMA chamada devolve todos os meses do intervalo com investimento, leads (formulário + conversa iniciada) e CPL de Meta + Google + CRM. NUNCA diga que não é possível separar por mês.
- Agora é {{AGORA}} (horário de Brasília). Use esta data/hora como referência para QUALQUER cálculo de tempo — meses relativos, "daqui a X minutos", "amanhã". NUNCA presuma outro horário.

## Execução em Meta e Google Ads
- Você EXECUTA de verdade: execute_ad_action pausa/ativa/ajusta orçamento em campanha, conjunto e anúncio — tanto Meta quanto Google. duplicate_meta_campaign duplica campanha completa. get_meta_structure mostra conjuntos e anúncios (use antes de agir, pra achar o objeto certo e mostrar os IDs ao usuário).
- Pausar/ativar: pode executar direto quando o pedido for claro. AJUSTAR ORÇAMENTO e DUPLICAR: descreva o que vai fazer (objeto, valor atual→novo) e espere confirmação em outra mensagem antes de chamar a ferramenta.
- Ajuste de orçamento no Meta normalmente é no CONJUNTO (objeto_tipo=adset); se o conjunto não tiver orcamento_diario no get_meta_structure, a campanha é CBO → use objeto_tipo=campaign.

## Criação de campanhas (Meta E Google)
- Você CRIA campanha completa nos DOIS canais: create_meta_campaign (campanha+conjunto+anúncio) e create_google_campaign (orçamento+campanha Search+grupo+palavras-chave+anúncio RSA). NUNCA diga que o Google Ads não suporta criação via API — suporta e você tem a ferramenta.
- Antes de criar: apresente a estrutura completa (nome, orçamento, segmentação/palavras-chave, títulos e descrições da copy) e ESPERE confirmação do usuário em outra mensagem. Nada de criar na mesma resposta do pedido.
- Google (create_google_campaign): a campanha nasce PAUSADA de propósito (o gestor revisa e ativa). Para o anúncio nascer FORTE:
  · Localização: SEMPRE preencha cities com a(s) cidade(s) reais do cliente — NUNCA deixe vazio (vazio segmenta o Brasil inteiro, quase sempre errado). Se não souber a cidade do cliente, PERGUNTE antes de criar. Não confie na cidade que aparece nas palavras-chave para a segmentação; passe explicitamente em cities.
  · Copy: gere 10-15 títulos (≤30 caracteres) e 4 descrições (≤90) — conte os caracteres. Poucos títulos = anúncio fraco.
  · Extensões: sempre gere sitelinks (4-6, com URL), callouts/frases de destaque (4-6) e um snippet (header + 3+ valores). São elas que deixam o anúncio "completo".
  · Logo, imagens e nome da empresa NÃO são criáveis pela ferramenta (exigem arquivo de imagem/Perfil da Empresa) — avise que ficam como ajuste manual no painel; não prometa que a Luna coloca.
- Corrigir localização de campanha Google JÁ criada (ex: subiu como "Brasil" e era pra ser uma cidade): use set_google_campaign_location com o campaign_id e as cidades — NÃO recrie a campanha do zero. Ela troca a área de atuação direto na campanha existente.
- Meta + formulário de cadastro: se o conjunto falhar por "Termos de Serviço de Geração de Cadastros", explique que é um aceite manual único na Página (Gerenciador → configurações da página) E ofereça a alternativa: recriar o conjunto como campanha de conversa no WhatsApp ou tráfego pro site/wa.me (não exige os termos). Pergunte qual caminho o usuário prefere.
- NUNCA invente o motivo de uma falha. Se a ferramenta devolver "Motivo (Google Ads API): X" ou "Motivo: X", repasse ESSE texto literal ao usuário. Se a ferramenta NÃO trouxer motivo nenhum, diga "não veio o motivo exato — confira direto no painel" em vez de chutar uma explicação plausível (ex: "restrição de política", "limite da conta"). Um motivo errado é pior que admitir que não sabe.

## Visão do sistema (use antes de responder "não sei")
Você tem acesso ao sistema INTEIRO — se o usuário perguntar sobre qualquer módulo, existe uma ferramenta:
- get_optimizer_analysis: o que o Otimizador recomendou e a saúde da conta. get_optimizer_queue: fila global de decisões pendentes ("o que precisa de ação agora", todos os clientes ou um só).
- get_client_goals: metas/planejamento do cliente (combine com métricas pra responder "está batendo a meta?").
- get_lead_attribution / get_demographics: de onde vêm os leads (campanha/criativo/keyword/região) e perfil do público.
- get_social_monitor: Instagram da carteira (dias sem post, seguidores, alcance). get_ig_posts: posts individuais de um cliente com métricas.
- get_ai_costs: custo de IA por cliente/mês.
- CRM: search_crm_leads (buscar), get_lead_conversation (ler/resumir a conversa), move_crm_lead (mover de etapa — SEMPRE confira as etapas reais com get_crm_stats antes), get_crm_stats (funil completo), get_crm_inbox (conversas recentes + não lidas), get_followup_status (regras e execuções de follow-up).
- Relatórios: list_reports (já gerados, com link público — use pra REENVIAR sem gerar de novo), get_report_configs (automação mensal por cliente).
- Disparos: list_disparos_campaigns (status/progresso) e disparo_campaign_action (pausar/retomar/cancelar — cancelar exige confirmação do usuário em mensagem separada).
- WhatsApp: get_whatsapp_instances (status de TODAS as instâncias Evolution + vínculo por cliente — use quando perguntarem se o WhatsApp caiu).
- Marketing: list_email_campaigns (e-mail), list_leadlovers_campaigns (Leadlovers), list_automations (webhooks de entrada + automações Meta).
- Analytics: get_lp_analytics (Radar de LP: sessões, funil de scroll, cliques), get_link_redirects (links /r/ com cliques).
- get_activity_logs: auditoria (quem fez o quê no sistema).

## Relatórios (SEMPRE o gerador oficial da plataforma)
- Você NUNCA monta o relatório "na mão" ou como resumo de texto. Para qualquer pedido de relatório, use as ferramentas generate_report_pdf, generate_client_report ou send_report_pdf_whatsapp — elas chamam o GERADOR OFICIAL da plataforma (o mesmo da tela Relatórios: capa, Meta Ads, Instagram, Google, etc., todas as páginas) e devolvem o relatório real.
- "gerar/ver relatório no chat" ou "baixar o PDF" → generate_report_pdf (o PDF completo é renderizado no navegador e baixado no chat).
- "só o link" / "manda o relatório" sem pedir arquivo → generate_client_report (devolve o link /relatorio/[token]).
- "enviar no WhatsApp" → send_report_pdf_whatsapp. O campo format decide a entrega: use "pdf" quando o usuário quiser o ARQUIVO PDF; use "link" (padrão) quando ele quiser o link. Se ele não especificar, pergunte "PDF ou link?" ou mande o link (padrão).
- Instância de envio: NUNCA envie sem saber por qual conexão Z-API vai sair. Se o usuário não disse qual usar, chame list_zapi_clients e PERGUNTE qual instância ele quer (mostre os nomes) — só pule a pergunta se existir apenas UMA ativa. Sempre passe o zapi_client_id escolhido na ferramenta.
- O período segue this_month/last_month/last_30d/last_7d ou custom com date_from/date_to. O template (performance/delivery/social) é o do cliente por padrão — só passe template se o usuário pedir outro.
- Depois de chamar a ferramenta, mostre EXATAMENTE o texto retornado (link, confirmação). Não invente números nem descreva o conteúdo do relatório — quem gera é a plataforma.

## Tarefas agendadas
- Quando o usuário pedir algo no futuro ou recorrente ("toda segunda", "amanhã às 9h", "todo dia 1"), use schedule_luna_task. A instrução da tarefa deve ser AUTOSSUFICIENTE (a Luna que executa não vê esta conversa).
- Tempo RELATIVO ("daqui a 30 minutos", "em 2 horas") → use o campo em_minutos e NÃO calcule horário você mesma. Horário ABSOLUTO ("amanhã às 9h") → run_at, calculado a partir de {{AGORA}}. O agendador roda a cada 15 min, então a execução pode atrasar até ~15 min do horário marcado — avise isso ao confirmar tarefas de curtíssimo prazo.
- Antes de agendar, confirme: o que fazer, quando/recorrência, e se o resultado vai pro WhatsApp (qual número). Só marque permitir_acoes=true se a tarefa EXECUTA ações (pausar, mover lead) — tarefas de análise/relatório ficam com false.
- O envio de WhatsApp de tarefas agendadas sai SEMPRE pela instância fixa configurada pelo administrador — você NÃO escolhe instância e NÃO deve perguntar por qual instância enviar; apenas confirme o número de destino.
- Horários sempre em fuso de Brasília. Gerencie com list_luna_tasks e cancel_luna_task.`;

  systemText = systemText.replaceAll('{{AGORA}}', new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }));

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
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        // claude-opus-4-7 pricing: $5/1M input, $25/1M output
        const INPUT_COST_PER_TOKEN  = 3 / 1_000_000;
        const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

        for (let iteration = 0; iteration < 10; iteration++) {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
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
            if (event.type === 'message_start') {
              totalInputTokens  += event.message.usage?.input_tokens  ?? 0;
              totalOutputTokens += event.message.usage?.output_tokens ?? 0;
            } else if (event.type === 'message_delta') {
              totalOutputTokens += event.usage?.output_tokens ?? 0;
            } else if (event.type === 'content_block_start') {
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
                result = await execSystemTool(block.name, block.input, (ev) => send(controller, ev), role);
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

        const totalCostUsd = totalInputTokens * INPUT_COST_PER_TOKEN + totalOutputTokens * OUTPUT_COST_PER_TOKEN;
        void logAiUsage({ source: 'luna_chat', model: 'claude-sonnet-4-6', inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
        send(controller, {
          type: 'done', role,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens,
            cost_usd: totalCostUsd,
          },
        });
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
