import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

function parseSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
}

async function ensureColumns(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_url TEXT;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_result JSONB;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_analyzed_at TIMESTAMPTZ;
  `);
}

export type FunnelEntry = {
  date: string;    // YYYY-MM-DD
  stage: string;   // stage name from sheet
  amount?: number; // only for closing/revenue entries
};

export type SheetsAnalysisResult = {
  entries: FunnelEntry[];
  stages: string[];  // ordered funnel stages detected
  total: number;
  note?: string;
};

export async function analyzeClientSheets(
  sheetsUrl: string,
  googleApiKey: string,
  anthropicKey: string,
): Promise<SheetsAnalysisResult> {
  const spreadsheetId = parseSpreadsheetId(sheetsUrl);
  if (!spreadsheetId) throw new Error('URL de planilha inválida.');

  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${googleApiKey}`);
  if (!metaRes.ok) {
    if (metaRes.status === 403) throw new Error('Planilha privada. Defina como "qualquer pessoa com o link pode visualizar".');
    throw new Error('Erro ao acessar a planilha. Verifique se o link está correto e a planilha é pública.');
  }

  const meta = await metaRes.json() as { sheets: { properties: { title: string } }[] };
  const sheetNames = meta.sheets.map(s => s.properties.title);

  const allSheetData: { name: string; rows: string[][] }[] = [];
  for (const name of sheetNames) {
    const dataRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(name)}?key=${googleApiKey}`
    );
    if (!dataRes.ok) continue;
    const data = await dataRes.json() as { values?: string[][] };
    if (data.values && data.values.length > 1) {
      allSheetData.push({ name, rows: data.values.slice(0, 200) });
    }
  }

  if (allSheetData.length === 0) throw new Error('Planilha vazia ou sem dados.');

  const sheetsText = allSheetData.map(sheet => {
    const rows = sheet.rows.map(row => row.join('\t')).join('\n');
    return `=== ABA: ${sheet.name} ===\n${rows}`;
  }).join('\n\n');

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Analise esta planilha de CRM/vendas e extraia cada lead individualmente com seu estágio no funil de vendas.

Para cada linha que representa um lead/contato:
1. Identifique a data (coluna de data, normalmente uma das primeiras — normalize para YYYY-MM-DD)
2. Identifique o estágio atual no funil: "Lead", "Atendimento", "Agendamento", "Comparecimento", "Fechamento" ou equivalentes presentes na planilha
3. Se o estágio for fechamento/venda (ex: "Comprou", "Efetivado", "Fechado", "Vendido", "Convertido"), inclua o valor monetário da coluna de valor/orçamento
4. Ignore linhas de cabeçalho, linhas vazias e linhas sem data
5. Valores monetários: remova "R$", pontos de milhar, converta vírgula decimal para ponto (ex: "R$ 1.500,00" → 1500.00)
6. Datas: normalize para YYYY-MM-DD (ex: "17/04/2025" → "2025-04-17")

Identifique também todos os estágios do funil em ordem crescente (do mais inicial ao fechamento/perda).

Retorne APENAS JSON válido neste formato exato, sem texto adicional:
{
  "entries": [
    { "date": "2025-04-17", "stage": "Fechamento", "amount": 1500.00 },
    { "date": "2025-04-18", "stage": "Agendamento" },
    { "date": "2025-04-19", "stage": "Lead" }
  ],
  "stages": ["Lead", "Atendimento", "Agendamento", "Comparecimento", "Fechamento"],
  "total": 1500.00,
  "note": "breve observação de como interpretou os dados"
}

Planilha:
${sheetsText}`,
      }],
    }),
  });

  if (!claudeRes.ok) throw new Error('Erro ao analisar com IA.');

  const claudeData = await claudeRes.json() as { content: { text: string }[] };
  const text = claudeData.content[0]?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? text) as SheetsAnalysisResult;

  parsed.total = parsed.entries.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  return parsed;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const { rows: [client] } = await pool.query(
      `SELECT sheets_url, sheets_result, sheets_analyzed_at FROM public.clients WHERE id = $1`, [id]
    );
    return Response.json({
      sheetsUrl: client?.sheets_url ?? null,
      sheetsResult: client?.sheets_result ?? null,
      sheetsAnalyzedAt: client?.sheets_analyzed_at ?? null,
    });
  } finally {
    await pool.end();
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sheetsUrl } = await req.json() as { sheetsUrl: string };
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    await pool.query(`UPDATE public.clients SET sheets_url = $1 WHERE id = $2`, [sheetsUrl || null, id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { sheetsUrl?: string };

  const pool = makeServerPool();
  let url = body.sheetsUrl;

  try {
    await ensureColumns(pool);
    if (!url) {
      const { rows: [client] } = await pool.query(`SELECT sheets_url FROM public.clients WHERE id = $1`, [id]);
      url = client?.sheets_url;
    }
    if (!url) return Response.json({ error: 'Nenhuma planilha vinculada.' }, { status: 400 });

    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) return Response.json({ error: 'GOOGLE_API_KEY não configurada.' }, { status: 500 });
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

    const result = await analyzeClientSheets(url, googleApiKey, anthropicKey);

    await pool.query(
      `UPDATE public.clients SET sheets_result = $1, sheets_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify(result), id]
    );

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao analisar planilha.';
    return Response.json({ error: msg }, { status: 400 });
  } finally {
    await pool.end();
  }
}
