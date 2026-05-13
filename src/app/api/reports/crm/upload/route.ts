import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const MONTH_STATUS_MAP: Record<string, string> = {
  'lead frio': 'meeting_scheduled',
  'lead morno': 'meeting_scheduled',
  'lead quente': 'meeting_scheduled',
  'reunião agendada': 'meeting_scheduled',
  'perca qualificada': 'meeting_scheduled',
  'reunião realizada': 'meeting_done',
  'ganho': 'won',
  'fechado': 'won',
  'venda': 'won',
  'vendido': 'won',
  'perdido': 'lost',
  'descartado': 'lost',
  'cancelado': 'lost',
};

function guessStatusCategory(val: string): string {
  const lower = val.toLowerCase().trim();
  for (const [key, cat] of Object.entries(MONTH_STATUS_MAP)) {
    if (lower.includes(key)) return cat;
  }
  return 'lead';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  const s = String(val);
  const parts = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (parts) {
    const [, d, m, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}

async function detectColumnsWithClaude(
  headers: string[],
  sampleRows: Record<string, unknown>[],
  apiKey: string,
): Promise<{ mapping: Record<string, string | null>; statusMapping: Record<string, string[]> }> {
  const prompt = `Você está analisando uma planilha de CRM. Identifique as colunas.

Colunas disponíveis: ${JSON.stringify(headers)}

Primeiras linhas (amostra):
${sampleRows.slice(0, 5).map((r) => JSON.stringify(r)).join('\n')}

Retorne APENAS JSON (sem markdown) com dois campos:
{
  "mapping": {
    "date": "nome exato da coluna de data de criação do lead (null se não existir)",
    "name": "nome exato da coluna de nome do lead/cliente (null se não existir)",
    "phone": "nome exato da coluna de telefone (null se não existir)",
    "city": "nome exato da coluna de cidade (null se não existir)",
    "source": "nome exato da coluna de origem/canal (null se não existir)",
    "status": "nome exato da coluna de status/etapa do funil (null se não existir)",
    "revenue": "nome exato da coluna de valor/faturamento (null se não existir)"
  },
  "statusMapping": {
    "meeting_scheduled": ["listar valores da coluna status que indicam reunião agendada"],
    "meeting_done": ["listar valores que indicam reunião realizada"],
    "won": ["listar valores que indicam venda/ganho"],
    "lost": ["listar valores que indicam perdido/descartado"]
  }
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error('Claude API error');
  const json = await res.json() as { content: Array<{ text: string }> };
  const text = json.content[0]?.text ?? '{}';

  try {
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    // Fallback: try to detect columns heuristically
    const mapping: Record<string, string | null> = {
      date: headers.find(h => /data|date|criação|created/i.test(h)) ?? null,
      name: headers.find(h => /nome|name|client/i.test(h)) ?? null,
      phone: headers.find(h => /tel|phone|fone|celular/i.test(h)) ?? null,
      city: headers.find(h => /cida|city|municip/i.test(h)) ?? null,
      source: headers.find(h => /origem|source|canal|mídia/i.test(h)) ?? null,
      status: headers.find(h => /status|etapa|fase|situação/i.test(h)) ?? null,
      revenue: headers.find(h => /valor|revenue|faturamento|receita|ticket/i.test(h)) ?? null,
    };
    return { mapping, statusMapping: {} };
  }
}

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_uploads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      column_mapping JSONB,
      status_mapping JSONB,
      row_count INTEGER DEFAULT 0,
      raw_rows JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      upload_id UUID,
      client_id TEXT NOT NULL,
      lead_date DATE,
      lead_name TEXT,
      phone TEXT,
      source TEXT,
      city TEXT,
      status_raw TEXT,
      status_category TEXT,
      revenue NUMERIC DEFAULT 0,
      raw JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const clientId = formData.get('clientId') as string | null;

  if (!file || !clientId) return Response.json({ error: 'Arquivo e clientId são obrigatórios.' }, { status: 400 });

  // Dynamically import xlsx to avoid issues if not yet installed
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    return Response.json({ error: 'Pacote xlsx não instalado. Execute: npm install xlsx' }, { status: 500 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) return Response.json({ error: 'Planilha vazia.' }, { status: 400 });

  const headers = Object.keys(rows[0]);
  const { mapping, statusMapping } = await detectColumnsWithClaude(headers, rows, apiKey);

  const pool = makeServerPool();
  try {
    await ensureTables(pool);

    // Delete existing upload for this client (replace mode)
    await pool.query(`DELETE FROM public.crm_uploads WHERE client_id = $1`, [clientId]);
    await pool.query(`DELETE FROM public.crm_leads WHERE client_id = $1`, [clientId]);

    const { rows: [upload] } = await pool.query(
      `INSERT INTO public.crm_uploads (client_id, filename, column_mapping, status_mapping, row_count, raw_rows)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [clientId, file.name, JSON.stringify(mapping), JSON.stringify(statusMapping), rows.length, JSON.stringify(rows.slice(0, 2000))],
    );

    // Normalize and insert leads
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const row of batch) {
        const statusRaw = mapping.status ? String(row[mapping.status] ?? '') : '';
        let statusCat = '';
        if (statusMapping && Object.keys(statusMapping).length > 0) {
          for (const [cat, vals] of Object.entries(statusMapping)) {
            if ((vals as string[]).some((v: string) => v.toLowerCase() === statusRaw.toLowerCase())) {
              statusCat = cat;
              break;
            }
          }
        }
        if (!statusCat) statusCat = guessStatusCategory(statusRaw);

        const revRaw = mapping.revenue ? row[mapping.revenue] : null;
        const revenue = revRaw ? parseFloat(String(revRaw).replace(/[^\d.,]/g, '').replace(',', '.')) || 0 : 0;

        await pool.query(
          `INSERT INTO public.crm_leads (upload_id, client_id, lead_date, lead_name, phone, source, city, status_raw, status_category, revenue, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            upload.id, clientId,
            mapping.date ? parseDate(row[mapping.date]) : null,
            mapping.name ? String(row[mapping.name] ?? '') : null,
            mapping.phone ? String(row[mapping.phone] ?? '') : null,
            mapping.source ? String(row[mapping.source] ?? '') : null,
            mapping.city ? String(row[mapping.city] ?? '') : null,
            statusRaw || null,
            statusCat,
            revenue,
            JSON.stringify(row),
          ],
        );
      }
    }

    return Response.json({
      uploadId: upload.id,
      rowCount: rows.length,
      mapping,
      statusMapping,
      preview: rows.slice(0, 3),
      headers,
    });
  } finally {
    await pool.end();
  }
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, client_id, filename, row_count, column_mapping, created_at
         FROM public.crm_uploads WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [clientId],
    );
    return Response.json(rows);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42P01') return Response.json([]);
    throw e;
  } finally {
    await pool.end();
  }
}
