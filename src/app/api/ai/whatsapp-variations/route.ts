import type { NextRequest } from 'next/server';
import { logAiUsage } from '@/lib/ai-usage-logger';
import { humanizarTexto } from '@/lib/whatsapp-texto';

export type WhatsAppVariation = {
  text: string;
  label: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });
  }

  const { message } = await req.json() as { message: string };
  if (!message?.trim()) {
    return Response.json({ error: 'Mensagem não pode estar vazia.' }, { status: 400 });
  }

  const prompt = [
    'Você é um especialista em copywriting para WhatsApp no mercado brasileiro.',
    'Sua tarefa: gerar 4 variações de uma mensagem de WhatsApp para campanha de marketing.',
    '',
    'REGRAS OBRIGATÓRIAS:',
    '1. Mantenha EXATAMENTE o mesmo contexto, produto, oferta e benefício central.',
    '2. Identifique a chamada para ação (CTA) da mensagem original — preserve-a com pequenas adaptações de estilo.',
    '3. Cada variação DEVE ter abertura diferente: curiosidade, urgência, prova social, benefício direto.',
    '4. Cada variação DEVE ter um encerramento diferente antes do CTA: reforço emocional, escassez, exclusividade, benefício secundário.',
    '5. Use português brasileiro informal e natural — como falam as pessoas, não como escrevem relatórios.',
    '6. Mantenha as variáveis {nome} e {telefone} se existirem na mensagem original.',
    '7. NÃO use clichês como "Não perca essa oportunidade" ou "Aproveite agora".',
    '',
    'ESCREVA COMO QUEM DIGITA NO CELULAR, NÃO COMO FERRAMENTA DE DISPARO:',
    '8. ZERO formatação. Nunca use _underscore_, *asterisco*, ~til~, crase ou # — nem para dar',
    '   ênfase. No WhatsApp isso vira itálico/negrito e entrega na hora que o texto foi montado',
    '   num sistema. Quem escreve de verdade só digita a palavra.',
    '9. Nunca use travessão (—). Use hífen, vírgula ou simplesmente outra frase.',
    '10. Nada de lista com marcador nem item numerado. Pessoa não manda lista formatada numa conversa.',
    '11. Frase curta, uma ideia por linha, do jeito que sai no teclado. Pode começar com "oi",',
    '    "olha", "passando pra avisar". Contração é bem-vinda ("tá", "pra", "tô").',
    '12. No máximo UM emoji por mensagem, e só se couber naturalmente. Pode não ter nenhum.',
    '',
    'MENSAGEM ORIGINAL:',
    `"""`,
    message.trim(),
    `"""`,
    '',
    'Retorne APENAS um array JSON válido com exatamente 4 variações, sem texto adicional:',
    '[',
    '  {',
    '    "text": "Texto completo da variação",',
    '    "label": "Ângulo usado (ex: Curiosidade, Urgência, Prova Social, Benefício Direto)"',
    '  }',
    ']',
  ].join('\n');

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return Response.json({ error: `Erro na API Claude: ${err}` }, { status: 502 });
  }

  const claudeData = await claudeRes.json() as { content: Array<{ type: string; text: string }>; usage?: { input_tokens: number; output_tokens: number } };
  void logAiUsage({ source: 'whatsapp', model: 'claude-haiku-4-5-20251001', inputTokens: claudeData.usage?.input_tokens ?? 0, outputTokens: claudeData.usage?.output_tokens ?? 0 });
  const rawText = claudeData.content?.[0]?.text ?? '[]';

  let variations: WhatsAppVariation[];
  try {
    const match = rawText.match(/\[[\s\S]*\]/);
    variations = match ? JSON.parse(match[0]) : [];
  } catch {
    return Response.json({ error: 'Resposta inválida da IA.', raw: rawText }, { status: 502 });
  }

  // A regra 8 do prompt pede texto sem marcação, mas o modelo escorrega — e uma
  // variação com `_grátis_` sai no WhatsApp em itálico, entregando que foi
  // montada em ferramenta. A faxina fecha a porta; variação que virou vazia
  // depois dela é descartada em vez de ir para a tela como linha em branco.
  variations = variations
    .map(v => ({ text: humanizarTexto(v?.text), label: String(v?.label ?? '').trim() }))
    .filter(v => v.text.length > 0);

  return Response.json(variations);
}
