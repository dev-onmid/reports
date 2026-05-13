import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export const maxDuration = 60;

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

function parseSheetJson(text: string): SheetsAnalysisResult | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const raw = jsonMatch?.[0] ?? text;
  try {
    return JSON.parse(raw) as SheetsAnalysisResult;
  } catch {
    // JSON was truncated — extract complete entry objects from the partial response
    const entries: FunnelEntry[] = [];
    const entryRegex = /\{\s*"date"\s*:\s*"([^"]+)"\s*,\s*"stage"\s*:\s*"([^"]+)"(?:\s*,\s*"amount"\s*:\s*([\d.]+))?\s*\}/g;
    let m;
    while ((m = entryRegex.exec(raw)) !== null) {
      entries.push({ date: m[1], stage: m[2], ...(m[3] ? { amount: parseFloat(m[3]) } : {}) });
    }
    const stagesMatch = raw.match(/"stages"\s*:\s*\[([\s\S]*?)\]/);
    const stages = stagesMatch
      ? (stagesMatch[1].match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''))
      : [...new Set(entries.map(e => e.stage))];
    if (entries.length === 0) return null;
    return { entries, stages, total: entries.reduce((s, e) => s + (e.amount ?? 0), 0) };
  }
}

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
      allSheetData.push({ name, rows: data.values.slice(0, 120) });
    }
  }

  if (allSheetData.length === 0) throw new Error('Planilha vazia ou sem dados.');

  // Process tabs in batches of 3 to avoid token overflow
  const BATCH_SIZE = 3;
  const allEntries: FunnelEntry[] = [];
  const allStages: string[] = [];
  let note = '';

  for (let i = 0; i < allSheetData.length; i += BATCH_SIZE) {
    const batch = allSheetData.slice(i, i + BATCH_SIZE);
    const sheetsText = batch.map(sheet => {
      const rows = sheet.rows.map(row => row.join('\t')).join('\n');
      return `=== ABA: ${sheet.name} ===\n${rows}`;
    }).join('\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
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
  "note": "breve observação"
}

Planilha:
${sheetsText}`,
        }],
      }),
    });

    if (!claudeRes.ok) continue;

    const claudeData = await claudeRes.json() as { content: { text: string }[] };
    const rawText = claudeData.content[0]?.text ?? '';
    const batchResult = parseSheetJson(rawText);
    if (batchResult) {
      allEntries.push(...batchResult.entries);
      for (const s of batchResult.stages) {
        if (!allStages.includes(s)) allStages.push(s);
      }
      if (!note && batchResult.note) note = batchResult.note;
    }
  }

  if (allEntries.length === 0 && allStages.length === 0) throw new Error('Não foi possível extrair dados da planilha.');

  const total = allEntries.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  return { entries: allEntries, stages: allStages, total, note };
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
