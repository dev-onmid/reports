import type { NextRequest } from 'next/server';
import { logAiUsage } from '@/lib/ai-usage-logger';

export type CopyVariation = {
  body: string;
  title: string;
  rationale: string;
};

type CopyPayload = {
  campaignName: string;
  platform: 'meta' | 'google';
  currentAds: Array<{ name: string; body: string; title: string }>;
  metrics?: {
    spend?: number;
    leads?: number;
    ctr?: number;
    cpl?: number;
  };
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });
  }

  const data = await req.json() as CopyPayload;
  const { campaignName, currentAds, metrics } = data;

  const lines: string[] = [
    'Você é um especialista em copywriting para anúncios de performance (Meta Ads / Google Ads) no mercado brasileiro.',
    'Gere 3 variações de copy para teste A/B com base nos anúncios atuais e métricas fornecidas.',
    '',
    `CAMPANHA: ${campaignName}`,
    '',
  ];

  if (metrics && (metrics.spend ?? 0) > 0) {
    lines.push('MÉTRICAS ATUAIS:');
    if (metrics.spend) lines.push(`- Investimento: R$ ${metrics.spend.toFixed(2)}`);
    if (metrics.leads) lines.push(`- Leads: ${metrics.leads}`);
    if (metrics.ctr) lines.push(`- CTR: ${metrics.ctr.toFixed(2)}%`);
    if (metrics.cpl) lines.push(`- CPL: R$ ${metrics.cpl.toFixed(2)}`);
    lines.push('');
  }

  if (currentAds.length > 0) {
    lines.push('ANÚNCIOS ATUAIS:');
    currentAds.slice(0, 3).forEach((ad, i) => {
      lines.push(`${i + 1}. "${ad.name}"`);
      if (ad.title) lines.push(`   Título: ${ad.title}`);
      if (ad.body) lines.push(`   Texto: ${ad.body}`);
    });
    lines.push('');
  }

  lines.push('Retorne APENAS um array JSON válido com 3 variações, sem texto adicional:');
  lines.push('[');
  lines.push('  {');
  lines.push('    "body": "Texto principal do anúncio (até 125 caracteres para feed)",');
  lines.push('    "title": "Título/Headline (até 40 caracteres)",');
  lines.push('    "rationale": "Por que essa variação pode performar melhor (1 frase)"');
  lines.push('  }');
  lines.push(']');
  lines.push('');
  lines.push('DIRETRIZES:');
  lines.push('- Cada variação deve testar um ângulo diferente (ex: benefício, urgência, prova social)');
  lines.push('- Use português brasileiro natural, não formal');
  lines.push('- Seja específico e evite clichês como "Não perca essa oportunidade"');
  lines.push('- Se o CPL estiver alto, foque em copy mais direto ao benefício principal');
  lines.push('- Se o CTR estiver baixo, foque em copy mais curioso/intrigante no título');

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: lines.join('\n') }],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return Response.json({ error: `Erro na API Claude: ${err}` }, { status: 502 });
  }

  const claudeData = await claudeRes.json() as { content: Array<{ type: string; text: string }>; usage?: { input_tokens: number; output_tokens: number } };
  void logAiUsage({ source: 'copy', model: 'claude-haiku-4-5-20251001', inputTokens: claudeData.usage?.input_tokens ?? 0, outputTokens: claudeData.usage?.output_tokens ?? 0 });
  const rawText = claudeData.content?.[0]?.text ?? '[]';

  let variations: CopyVariation[];
  try {
    const match = rawText.match(/\[[\s\S]*\]/);
    variations = match ? JSON.parse(match[0]) : [];
  } catch {
    return Response.json({ error: 'Resposta inválida da IA.', raw: rawText }, { status: 502 });
  }

  return Response.json(variations);
}
