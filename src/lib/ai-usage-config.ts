export const USD_TO_BRL = 5.80;

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001':  { input: 1.00,  output: 5.00 },
  'claude-haiku-4-5':           { input: 1.00,  output: 5.00 },
};

export type AiEstimate = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  labelPt: string;
};

export const ESTIMATES: Record<string, AiEstimate> = {
  report_performance: { model: 'claude-sonnet-4-6', inputTokens: 4000, outputTokens: 6000,  labelPt: 'Relatório Performance' },
  report_delivery:    { model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 2000,  labelPt: 'Relatório Delivery' },
  mindmap:            { model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 1500,  labelPt: 'Mapa Mental' },
  luna_chat:          { model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 1000,  labelPt: 'Luna (por mensagem)' },
  insights:           { model: 'claude-haiku-4-5-20251001', inputTokens: 500,  outputTokens: 700,  labelPt: 'Insights Dashboard' },
  copy:               { model: 'claude-haiku-4-5-20251001', inputTokens: 400,  outputTokens: 600,  labelPt: 'Variações de Copy' },
  whatsapp:           { model: 'claude-haiku-4-5-20251001', inputTokens: 400,  outputTokens: 800,  labelPt: 'Variações WhatsApp' },
  crm_analysis:       { model: 'claude-haiku-4-5-20251001', inputTokens: 500,  outputTokens: 300,  labelPt: 'Análise CRM (por lead)' },
};

export function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? { input: 3.00, output: 15.00 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function estimateCostUsd(source: string): number {
  const est = ESTIMATES[source];
  if (!est) return 0;
  return calcCostUsd(est.model, est.inputTokens, est.outputTokens);
}

export function estimateCostBrl(source: string): number {
  return estimateCostUsd(source) * USD_TO_BRL;
}
