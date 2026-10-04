import type { NextRequest } from 'next/server';
import { logAiUsage } from '@/lib/ai-usage-logger';
import { humanizarTexto, perfilDaMensagem, regrasDeFormato } from '@/lib/whatsapp-texto';

export type WhatsAppVariation = {
  text: string;
  label: string;
};

/** Teto de variações além da original: 9 + a original = 10 mensagens no rodízio (pedido de 2026-10-03). */
const MAX_VARIACOES = 9;

/** Ângulos de abertura — cada variação usa um diferente. Os 4 primeiros são os de sempre. */
const ANGULOS = [
  'Curiosidade', 'Urgência', 'Prova Social', 'Benefício Direto', 'Pergunta direta',
  'Novidade', 'Exclusividade', 'Cena do dia a dia', 'Oferta direto ao ponto',
];

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });
  }

  const { message, quantidade: qtdPedida, existentes } = await req.json() as {
    message: string;
    /** Quantas variações gerar (padrão 4 = 5 mensagens com a original; até 9 = 10). */
    quantidade?: number;
    /** Textos já na campanha — a IA não pode repetir nenhum (botão "Gerar mais 5"). */
    existentes?: string[];
  };
  const quantidade = Math.min(MAX_VARIACOES, Math.max(1, Math.round(Number(qtdPedida) || 4)));
  const jaExistem = Array.isArray(existentes) ? existentes.filter(t => typeof t === 'string' && t.trim()).slice(0, MAX_VARIACOES) : [];
  if (!message?.trim()) {
    return Response.json({ error: 'Mensagem não pode estar vazia.' }, { status: 400 });
  }

  // O formato das variações é CÓPIA do formato da original (parágrafos, emoji,
  // negrito, tamanho) - ver `regrasDeFormato`. Regra fixa aqui já quebrou uma vez.
  const perfil = perfilDaMensagem(message);

  const prompt = [
    'Você é um especialista em copywriting para WhatsApp no mercado brasileiro.',
    `Sua tarefa: gerar ${quantidade} variações de uma mensagem de WhatsApp para campanha de marketing.`,
    '',
    'REGRAS OBRIGATÓRIAS:',
    '1. Mantenha EXATAMENTE o mesmo contexto, produto, oferta e benefício central.',
    '2. Identifique a chamada para ação (CTA) da mensagem original — preserve-a com pequenas adaptações de estilo.',
    `3. Cada variação DEVE ter abertura diferente, uma de cada ângulo: ${ANGULOS.slice(jaExistem.length ? Math.min(jaExistem.length, ANGULOS.length - quantidade) : 0).slice(0, quantidade).join(', ')}.`,
    '4. Cada variação DEVE ter um encerramento diferente antes do CTA: reforço emocional, escassez, exclusividade, benefício secundário.',
    '5. Use português brasileiro informal e natural — como falam as pessoas, não como escrevem relatórios.',
    '6. Mantenha as variáveis {nome}, {primeiro_nome}, {nome_completo} e {telefone} EXATAMENTE como estão (com chaves) se existirem na mensagem original.',
    '7. NÃO use clichês como "Não perca essa oportunidade" ou "Aproveite agora".',
    '',
    'ESCREVA COMO QUEM DIGITA NO CELULAR, NÃO COMO FERRAMENTA DE DISPARO:',
    '8. Frase curta, uma ideia por frase. Pode começar com "oi", "olha", "passando pra avisar".',
    '   Contração é bem-vinda ("tá", "pra", "tô").',
    '9. Não encha linguiça: nada de explicar a oferta duas vezes nem de repetir as condições.',
    '',
    ...regrasDeFormato(perfil),
    '',
    ...(jaExistem.length ? [
      'A CAMPANHA JÁ TEM ESTAS VERSÕES — as novas precisam ser DIFERENTES de todas elas (outra abertura, outra frase, outro gancho; nada de reescrever trocando duas palavras):',
      ...jaExistem.map((t, i) => `--- versão existente ${i + 1} ---\n${t.trim()}`),
      '',
    ] : []),
    'MENSAGEM ORIGINAL:',
    `"""`,
    message.trim(),
    `"""`,
    '',
    `Retorne APENAS um array JSON válido com exatamente ${quantidade} variações, sem texto adicional:`,
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
      // ~350 tokens por variação de WhatsApp com folga para o JSON.
      max_tokens: Math.max(2048, quantidade * 450),
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
    .map(v => ({ text: humanizarTexto(v?.text, { manterMarcacao: perfil.negrito || perfil.italico, manterListas: perfil.listas }), label: String(v?.label ?? '').trim() }))
    .filter(v => v.text.length > 0)
    .slice(0, quantidade);

  return Response.json(variations);
}
