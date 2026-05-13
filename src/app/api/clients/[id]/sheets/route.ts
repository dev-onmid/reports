import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

function parseSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
}

async function ensureColumn(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_url TEXT`);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureColumn(pool);
    const { rows: [client] } = await pool.query(`SELECT sheets_url FROM public.clients WHERE id = $1`, [id]);
    return Response.json({ sheetsUrl: client?.sheets_url ?? null });
  } finally {
    await pool.end();
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sheetsUrl } = await req.json() as { sheetsUrl: string };
  const pool = makeServerPool();
  try {
    await ensureColumn(pool);
    await pool.query(`UPDATE public.clients SET sheets_url = $1 WHERE id = $2`, [sheetsUrl || null, id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { sheetsUrl?: string };
  let url = body.sheetsUrl;

  if (!url) {
    const pool = makeServerPool();
    try {
      await ensureColumn(pool);
      const { rows: [client] } = await pool.query(`SELECT sheets_url FROM public.clients WHERE id = $1`, [id]);
      url = client?.sheets_url;
    } finally {
      await pool.end();
    }
  }

  if (!url) return Response.json({ error: 'Nenhuma planilha vinculada.' }, { status: 400 });

  const spreadsheetId = parseSpreadsheetId(url);
  if (!spreadsheetId) return Response.json({ error: 'URL de planilha inválida.' }, { status: 400 });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_API_KEY não configurada nas variáveis de ambiente.' }, { status: 500 });

  // Get sheet names
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${apiKey}`);
  if (!metaRes.ok) {
    if (metaRes.status === 403) {
      return Response.json({ error: 'Planilha privada. Defina como "qualquer pessoa com o link pode visualizar".' }, { status: 403 });
    }
    return Response.json({ error: 'Erro ao acessar a planilha. Verifique se o link está correto e a planilha é pública.' }, { status: 400 });
  }

  const meta = await metaRes.json() as { sheets: { properties: { title: string } }[] };
  const sheetNames = meta.sheets.map(s => s.properties.title);

  // Fetch data from each sheet (max 50 rows per sheet to keep context manageable)
  const allSheetData: { name: string; rows: string[][] }[] = [];
  for (const name of sheetNames) {
    const dataRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(name)}?key=${apiKey}`
    );
    if (!dataRes.ok) continue;
    const data = await dataRes.json() as { values?: string[][] };
    if (data.values && data.values.length > 1) {
      allSheetData.push({ name, rows: data.values.slice(0, 150) });
    }
  }

  if (allSheetData.length === 0) {
    return Response.json({ error: 'Planilha vazia ou sem dados.' }, { status: 400 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

  const sheetsText = allSheetData.map(sheet => {
    const rows = sheet.rows.map(row => row.join('\t')).join('\n');
    return `=== ABA: ${sheet.name} ===\n${rows}`;
  }).join('\n\n');

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Analise estas abas de uma planilha de vendas e identifique os valores financeiros de vendas/fechamentos.

Procure por:
1. Colunas chamadas "Valor Fechado", "Valor", "Venda", "Receita", "Faturamento" ou similares com valores monetários
2. Colunas de status com valores como "Comprou", "Efetivado", "Fechado", "Vendido", "Convertido" — nesse caso, some o campo de orçamento/proposta/valor correspondente daquela linha
3. Ignore linhas com status como "Não comprou", "Perdido", "Cancelado", "Lead", "Em andamento"

Para cada aba que tiver dados de vendas, calcule o total. Abas sem dados relevantes retorne amount 0.

Retorne APENAS JSON válido neste formato exato, sem texto adicional:
{
  "tabs": [
    { "name": "nome da aba", "amount": 1500.00, "count": 3, "source": "coluna usada" }
  ],
  "total": 1500.00,
  "note": "breve observação de como interpretou os dados"
}

Planilha:
${sheetsText}`,
      }],
    }),
  });

  if (!claudeRes.ok) return Response.json({ error: 'Erro ao analisar com IA.' }, { status: 500 });

  const claudeData = await claudeRes.json() as { content: { text: string }[] };
  const text = claudeData.content[0]?.text ?? '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch?.[0] ?? text);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Erro ao interpretar resposta da IA.', raw: text }, { status: 500 });
  }
}
