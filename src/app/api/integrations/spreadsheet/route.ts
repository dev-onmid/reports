import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export type SpreadsheetAnalysis = {
  headers: string[];
  clinicValues: string[];
  rowCount: number;
  mapping: {
    clinic: string | null;
    revenue: string | null;
    date: string | null;
    name: string | null;
  };
  preview: Record<string, unknown>[];
};

export type SpreadsheetMapping = {
  clinicValue: string;
  clientId: string;
  clientName: string;
};

function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
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

function parseRevenue(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

  const normalized = String(val)
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado ao processar planilha.';
}

async function detectColumnsWithClaude(
  headers: string[],
  sampleRows: Record<string, unknown>[],
  apiKey: string,
): Promise<SpreadsheetAnalysis['mapping']> {
  const prompt = `Você está analisando uma planilha exportada de um sistema CRM com dados de múltiplas clínicas/unidades.

Colunas disponíveis: ${JSON.stringify(headers)}

Primeiras linhas (amostra):
${sampleRows.slice(0, 5).map(r => JSON.stringify(r)).join('\n')}

Identifique:
- "clinic": coluna que identifica a clínica/unidade/empresa (pode ser "Clínica", "Unidade", "Cliente", "Empresa", "Nome da Empresa" etc.)
- "revenue": coluna de faturamento/valor/receita/ticket
- "date": coluna de data (criação, venda, atendimento)
- "name": coluna do nome do lead/paciente/cliente

Retorne APENAS JSON (sem markdown):
{
  "clinic": "nome exato da coluna de clínica (null se não existir)",
  "revenue": "nome exato da coluna de faturamento (null se não existir)",
  "date": "nome exato da coluna de data (null se não existir)",
  "name": "nome exato da coluna de nome (null se não existir)"
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
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error('Claude API error');
  const json = await res.json() as { content: Array<{ text: string }> };
  const text = json.content[0]?.text ?? '{}';

  try {
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    return {
      clinic: headers.find(h => /clínica|clinica|unidade|empresa|negócio|negocio/i.test(h)) ?? null,
      revenue: headers.find(h => /valor|faturamento|receita|ticket|revenue/i.test(h)) ?? null,
      date: headers.find(h => /data|date|criação|created/i.test(h)) ?? null,
      name: headers.find(h => /nome|name|paciente|lead/i.test(h)) ?? null,
    };
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
    ALTER TABLE public.crm_uploads
      ADD COLUMN IF NOT EXISTS column_mapping JSONB,
      ADD COLUMN IF NOT EXISTS status_mapping JSONB,
      ADD COLUMN IF NOT EXISTS row_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS raw_rows JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
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
  await pool.query(`
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS upload_id UUID,
      ADD COLUMN IF NOT EXISTS lead_date DATE,
      ADD COLUMN IF NOT EXISTS lead_name TEXT,
      ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS raw JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
  `);
}

async function insertLeadBatch(
  pool: ReturnType<typeof makeServerPool>,
  rows: Array<{
    uploadId: string;
    clientId: string;
    leadDate: string | null;
    leadName: string | null;
    revenue: number;
    raw: string;
  }>,
) {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 6;
    values.push(row.uploadId, row.clientId, row.leadDate, row.leadName, row.revenue, row.raw);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
  }).join(',');

  await pool.query(
    `INSERT INTO public.crm_leads (upload_id, client_id, lead_date, lead_name, revenue, raw)
     VALUES ${placeholders}`,
    values,
  );
}

// POST ?step=analyze — parse file and detect columns
// POST ?step=import  — process mappings and store data
export async function POST(req: NextRequest) {
  try {
    const step = req.nextUrl.searchParams.get('step') ?? 'analyze';
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return Response.json({ error: 'Arquivo obrigatório.' }, { status: 400 });

    let XLSX: typeof import('xlsx');
    try {
      XLSX = await import('xlsx');
    } catch {
      return Response.json({ error: 'Pacote xlsx não instalado. Execute: npm install xlsx' }, { status: 500 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) return Response.json({ error: 'Planilha vazia.' }, { status: 400 });

    const headers = Object.keys(rows[0]);

    // ── Step: analyze ──────────────────────────────────────────────────────────
    if (step === 'analyze') {
      if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

      const mapping = await detectColumnsWithClaude(headers, rows, apiKey);
      const clinicValues: string[] = [];
      if (mapping.clinic) {
        const seen = new Set<string>();
        for (const row of rows) {
          const v = String(row[mapping.clinic!] ?? '').trim();
          if (v && !seen.has(v)) { seen.add(v); clinicValues.push(v); }
        }
      }
      return Response.json({
        headers,
        clinicValues,
        rowCount: rows.length,
        mapping,
        preview: rows.slice(0, 3),
      } satisfies SpreadsheetAnalysis);
    }

    // ── Step: import ───────────────────────────────────────────────────────────
    const mappingsRaw = formData.get('mappings') as string | null;
    const clinicColumnOverride = formData.get('clinicColumn') as string | null;
    const revenueColumnOverride = formData.get('revenueColumn') as string | null;
    const dateColumnOverride = formData.get('dateColumn') as string | null;
    const nameColumnOverride = formData.get('nameColumn') as string | null;

    if (!mappingsRaw) return Response.json({ error: 'mappings obrigatório.' }, { status: 400 });

    const mappings: SpreadsheetMapping[] = JSON.parse(mappingsRaw);
    const clinicCol = clinicColumnOverride || null;
    const revenueCol = revenueColumnOverride || null;
    const dateCol = dateColumnOverride || null;
    const nameCol = nameColumnOverride || null;

    if (clinicCol && !headers.includes(clinicCol)) return Response.json({ error: `Coluna de clínica não encontrada: ${clinicCol}` }, { status: 400 });
    if (revenueCol && !headers.includes(revenueCol)) return Response.json({ error: `Coluna de faturamento não encontrada: ${revenueCol}` }, { status: 400 });
    if (dateCol && !headers.includes(dateCol)) return Response.json({ error: `Coluna de data não encontrada: ${dateCol}` }, { status: 400 });
    if (nameCol && !headers.includes(nameCol)) return Response.json({ error: `Coluna de nome não encontrada: ${nameCol}` }, { status: 400 });

    const pool = makeServerPool();
    await ensureTables(pool);

    const results: Record<string, number> = {};

    try {
      for (const m of mappings) {
        if (!m.clientId) continue;

        const clientRows = clinicCol
          ? rows.filter(r => String(r[clinicCol] ?? '').trim() === m.clinicValue)
          : rows;

        if (clientRows.length === 0) { results[m.clinicValue] = 0; continue; }

        // Remove existing spreadsheet data for this client before replacing it.
        await pool.query(`DELETE FROM public.crm_leads WHERE client_id = $1`, [m.clientId]);
        await pool.query(`DELETE FROM public.crm_uploads WHERE client_id = $1`, [m.clientId]);

        const { rows: [upload] } = await pool.query(
          `INSERT INTO public.crm_uploads (client_id, filename, column_mapping, row_count, raw_rows)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [m.clientId, file.name, JSON.stringify({ clinic: clinicCol, revenue: revenueCol, date: dateCol, name: nameCol }), clientRows.length, JSON.stringify(clientRows.slice(0, 500))],
        );

        for (let i = 0; i < clientRows.length; i += 150) {
          const batch = clientRows.slice(i, i + 150).map((row) => ({
            uploadId: upload.id as string,
            clientId: m.clientId,
            leadDate: dateCol ? parseDate(row[dateCol]) : null,
            leadName: nameCol ? String(row[nameCol] ?? '') : null,
            revenue: revenueCol ? parseRevenue(row[revenueCol]) : 0,
            raw: JSON.stringify(row),
          }));
          await insertLeadBatch(pool, batch);
        }
        results[m.clinicValue] = clientRows.length;
      }

      return Response.json({ ok: true, results });
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error('[spreadsheet-import]', error);
    return Response.json(
      { error: `Erro ao processar planilha: ${getErrorMessage(error)}` },
      { status: 500 },
    );
  }
}
