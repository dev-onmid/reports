import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export type SpreadsheetAnalysis = {
  headers: string[];
  clinicValues: string[];
  distinctValues: Record<string, string[]>;
  rowCount: number;
  mapping: SpreadsheetColumnMapping;
  preview: Record<string, unknown>[];
};

export type SpreadsheetColumnMapping = {
  clinic: string | null;
  revenue: string | null;
  date: string | null;
  name: string | null;
  channel?: string | null;
  phone?: string | null;
  budget?: string | null;
  payment?: string | null;
  neighborhood?: string | null;
  notes?: string | null;
  scheduledDate?: string | null;
  status?: string | null;
  dealId?: string | null;
  stage?: string | null;
  updatedDate?: string | null;
};

export type SpreadsheetMapping = {
  clinicValue: string;
  clientId: string;
  clientName: string;
};

function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date && Number.isFinite(val.getTime())) return val.toISOString().split('T')[0];
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

// Some CRM exports keep the negotiated/potential value on every row regardless
// of outcome (won, lost or open) — revenue > 0 is not a safe "won" signal there.
// Prefer an explicit win keyword in the status column when one is mapped.
function isWonStatus(statusRaw: string | null): boolean {
  if (!statusRaw) return false;
  return /\bganho\b|\bwon\b|\bfechado\b|\bconvertido\b/i.test(statusRaw);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado ao processar planilha.';
}

function findHeader(headers: string[], patterns: RegExp[]): string | null {
  return headers.find(header => patterns.some(pattern => pattern.test(header))) ?? null;
}

function compactDetails(parts: Array<[string, unknown]>): string | null {
  const text = parts
    .map(([label, value]) => {
      const normalized = String(value ?? '').trim();
      return normalized ? `${label}: ${normalized}` : '';
    })
    .filter(Boolean)
    .join(' | ');
  return text || null;
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
- "channel": coluna de canal/origem/mídia/como conheceu
- "phone": coluna de telefone/celular/WhatsApp/número
- "budget": coluna de orçamento/proposta/valor orçado
- "payment": coluna de pagamento/forma de pagamento
- "neighborhood": coluna de bairro/cidade/região
- "notes": coluna de observações/comentários/detalhes
- "scheduledDate": coluna de data agendada/consulta/agendamento
- "status": coluna de status/situação (resultado: ganho/perdido/aberto)
- "dealId": coluna de ID único do negócio/lead (se existir — usado pra cruzar a mesma planilha exportada em meses diferentes)
- "stage": coluna de etapa do funil (ex: "Etapa", "Estágio", "Fase" — diferente de "status", representa em que ponto do funil o lead está, não o resultado final)
- "updatedDate": coluna de última atualização/última modificação do negócio (diferente de "date", que é a data de criação)

Retorne APENAS JSON (sem markdown):
{
  "clinic": "nome exato da coluna de clínica (null se não existir)",
  "revenue": "nome exato da coluna de faturamento (null se não existir)",
  "date": "nome exato da coluna de data (null se não existir)",
  "name": "nome exato da coluna de nome (null se não existir)",
  "channel": "nome exato da coluna de canal (null se não existir)",
  "phone": "nome exato da coluna de telefone (null se não existir)",
  "budget": "nome exato da coluna de orçamento (null se não existir)",
  "payment": "nome exato da coluna de pagamento (null se não existir)",
  "neighborhood": "nome exato da coluna de bairro/cidade (null se não existir)",
  "notes": "nome exato da coluna de observação (null se não existir)",
  "scheduledDate": "nome exato da coluna de data agendada (null se não existir)",
  "status": "nome exato da coluna de status (null se não existir)",
  "dealId": "nome exato da coluna de ID do negócio (null se não existir)",
  "stage": "nome exato da coluna de etapa do funil (null se não existir)",
  "updatedDate": "nome exato da coluna de última atualização (null se não existir)"
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
      channel: headers.find(h => /como\s+nos\s+conheceu|canal|origem|source|m[ií]dia/i.test(h)) ?? null,
      phone: headers.find(h => /telefone|celular|whats|phone|n[uú]mero/i.test(h)) ?? null,
      budget: headers.find(h => /or[cç]amento|proposta|valor\s+or[cç]ado/i.test(h)) ?? null,
      payment: headers.find(h => /pagamento|forma\s+de\s+pagamento/i.test(h)) ?? null,
      neighborhood: headers.find(h => /bairro|cidade|city|regi[aã]o/i.test(h)) ?? null,
      notes: headers.find(h => /observa[cç][aã]o|obs|coment[aá]rio|descri[cç][aã]o/i.test(h)) ?? null,
      scheduledDate: headers.find(h => /data\s+agendada|agendamento|consulta/i.test(h)) ?? null,
      status: headers.find(h => /status|situa[cç][aã]o/i.test(h)) ?? null,
      dealId: headers.find(h => /^id$/i.test(h.trim())) ?? null,
      stage: headers.find(h => /etapa|est[aá]gio|fase\s+do\s+funil/i.test(h)) ?? null,
      updatedDate: headers.find(h => /[uú]ltima\s+(atualiza[cç][aã]o|modifica[cç][aã]o|cria[cç][aã]o)/i.test(h)) ?? null,
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
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS status_raw TEXT,
      ADD COLUMN IF NOT EXISTS data DATE,
      ADD COLUMN IF NOT EXISTS nome TEXT,
      ADD COLUMN IF NOT EXISTS numero TEXT,
      ADD COLUMN IF NOT EXISTS canal TEXT,
      ADD COLUMN IF NOT EXISTS observacao TEXT,
      ADD COLUMN IF NOT EXISTS orcamento NUMERIC,
      ADD COLUMN IF NOT EXISTS pagamento TEXT,
      ADD COLUMN IF NOT EXISTS bairro TEXT,
      ADD COLUMN IF NOT EXISTS data_agendada DATE,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Fechado',
      ADD COLUMN IF NOT EXISTS status_category TEXT,
      ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
      ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS raw JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS external_id TEXT,
      ADD COLUMN IF NOT EXISTS stage TEXT,
      ADD COLUMN IF NOT EXISTS updated_at_external DATE
  `);
  // Lets multiple imports of the same export (different months) update the same
  // deal in place instead of duplicating it — required for "resgate" flows where
  // a deal's status changes in a later export.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_client_external_id_idx
      ON public.crm_leads (client_id, external_id)
      WHERE external_id IS NOT NULL
  `);
}

async function insertLeadBatch(
  pool: ReturnType<typeof makeServerPool>,
  rows: Array<{
    uploadId: string;
    clientId: string;
    leadDate: string | null;
    leadName: string | null;
    phone: string | null;
    channel: string | null;
    statusRaw: string | null;
    scheduledDate: string | null;
    budget: number;
    payment: string | null;
    neighborhood: string | null;
    notes: string | null;
    revenue: number;
    closed: boolean;
    raw: string;
  }>,
) {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 23;
    values.push(
      row.uploadId,
      row.clientId,
      row.leadDate,
      row.leadName,
      row.phone,
      row.channel,
      row.neighborhood,
      row.statusRaw,
      row.leadDate,
      row.leadName,
      row.phone,
      row.channel,
      row.notes,
      row.budget,
      row.payment,
      row.neighborhood,
      row.scheduledDate,
      row.revenue,
      row.revenue,
      row.closed,
      row.closed ? 'won' : null,
      row.statusRaw || (row.closed ? 'Fechado' : null),
      row.raw,
    );
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20},$${base + 21},$${base + 22},$${base + 23})`;
  }).join(',');

  await pool.query(
    `INSERT INTO public.crm_leads
      (upload_id, client_id, lead_date, lead_name, phone, source, city, status_raw,
       data, nome, numero, canal, observacao, orcamento, pagamento, bairro, data_agendada,
       revenue, valor_rs, fechou, status_category, status, raw)
     VALUES ${placeholders}`,
    values,
  );
}

// Used instead of insertLeadBatch when the spreadsheet has a deal ID column —
// upserts by (client_id, external_id) so re-importing a later export updates
// existing deals in place rather than duplicating them. Only overwrites a
// deal if the incoming row is at least as recently updated as what's stored.
// Writes the same duplicate column pairs (lead_date/data, revenue/valor_rs,
// etc.) as insertLeadBatch, since other code paths (CRM report data, chat)
// read crm_leads through either naming.
async function upsertLeadBatch(
  pool: ReturnType<typeof makeServerPool>,
  rows: Array<{
    uploadId: string;
    clientId: string;
    externalId: string;
    leadDate: string | null;
    leadName: string | null;
    phone: string | null;
    channel: string | null;
    statusRaw: string | null;
    stage: string | null;
    updatedAtExternal: string | null;
    scheduledDate: string | null;
    budget: number;
    payment: string | null;
    neighborhood: string | null;
    notes: string | null;
    revenue: number;
    closed: boolean;
    raw: string;
  }>,
) {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 26;
    values.push(
      row.uploadId, row.clientId, row.externalId,
      row.leadDate, row.leadName, row.phone, row.channel, row.neighborhood, row.statusRaw,
      row.leadDate, row.leadName, row.phone, row.channel, row.neighborhood, row.scheduledDate,
      row.stage, row.updatedAtExternal,
      row.budget, row.payment, row.notes,
      row.revenue, row.revenue, row.closed,
      row.closed ? 'won' : null,
      row.statusRaw || (row.closed ? 'Fechado' : null),
      row.raw,
    );
    return `(${Array.from({ length: 26 }, (_, i) => `$${base + i + 1}`).join(',')})`;
  }).join(',');

  await pool.query(
    `INSERT INTO public.crm_leads
      (upload_id, client_id, external_id,
       lead_date, lead_name, phone, source, city, status_raw,
       data, nome, numero, canal, bairro, data_agendada,
       stage, updated_at_external,
       orcamento, pagamento, observacao,
       revenue, valor_rs, fechou, status_category, status, raw)
     VALUES ${placeholders}
     ON CONFLICT (client_id, external_id) DO UPDATE SET
       upload_id = EXCLUDED.upload_id,
       lead_date = EXCLUDED.lead_date, data = EXCLUDED.data,
       lead_name = EXCLUDED.lead_name, nome = EXCLUDED.nome,
       phone = EXCLUDED.phone, numero = EXCLUDED.numero,
       source = EXCLUDED.source, canal = EXCLUDED.canal,
       city = EXCLUDED.city, bairro = EXCLUDED.bairro,
       status_raw = EXCLUDED.status_raw,
       data_agendada = EXCLUDED.data_agendada,
       stage = EXCLUDED.stage,
       updated_at_external = EXCLUDED.updated_at_external,
       orcamento = EXCLUDED.orcamento,
       pagamento = EXCLUDED.pagamento,
       observacao = EXCLUDED.observacao,
       revenue = EXCLUDED.revenue, valor_rs = EXCLUDED.valor_rs,
       fechou = EXCLUDED.fechou,
       status_category = EXCLUDED.status_category,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw
     WHERE public.crm_leads.updated_at_external IS NULL
        OR EXCLUDED.updated_at_external IS NULL
        OR EXCLUDED.updated_at_external >= public.crm_leads.updated_at_external`,
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
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: file.name.match(/\.csv$/i) ? true : undefined });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) return Response.json({ error: 'Planilha vazia.' }, { status: 400 });

    const headers = Object.keys(rows[0]);

    // ── Step: analyze ──────────────────────────────────────────────────────────
    if (step === 'analyze') {
      if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

      const mapping = await detectColumnsWithClaude(headers, rows, apiKey);
      const clinicValues: string[] = [];
      const distinctValues: Record<string, string[]> = {};
      for (const header of headers) {
        const seen = new Set<string>();
        const values: string[] = [];
        for (const row of rows) {
          const v = String(row[header] ?? '').trim();
          if (v && !seen.has(v)) {
            seen.add(v);
            values.push(v);
          }
          if (values.length >= 500) break;
        }
        distinctValues[header] = values;
      }
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
        distinctValues,
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
    const channelColumnOverride = formData.get('channelColumn') as string | null;
    const phoneColumnOverride = formData.get('phoneColumn') as string | null;
    const budgetColumnOverride = formData.get('budgetColumn') as string | null;
    const paymentColumnOverride = formData.get('paymentColumn') as string | null;
    const neighborhoodColumnOverride = formData.get('neighborhoodColumn') as string | null;
    const notesColumnOverride = formData.get('notesColumn') as string | null;
    const scheduledDateColumnOverride = formData.get('scheduledDateColumn') as string | null;
    const statusColumnOverride = formData.get('statusColumn') as string | null;
    const dealIdColumnOverride = formData.get('dealIdColumn') as string | null;
    const stageColumnOverride = formData.get('stageColumn') as string | null;
    const updatedDateColumnOverride = formData.get('updatedDateColumn') as string | null;

    if (!mappingsRaw) return Response.json({ error: 'mappings obrigatório.' }, { status: 400 });

    const mappings: SpreadsheetMapping[] = JSON.parse(mappingsRaw);
    const clinicCol = clinicColumnOverride || null;
    const revenueCol = revenueColumnOverride || null;
    const dateCol = dateColumnOverride || null;
    const nameCol = nameColumnOverride || null;
    const channelCol = channelColumnOverride || findHeader(headers, [/como\s+nos\s+conheceu/i, /canal/i, /origem/i, /source/i, /m[ií]dia/i]);
    const phoneCol = phoneColumnOverride || null;
    const budgetCol = budgetColumnOverride || null;
    const paymentCol = paymentColumnOverride || null;
    const neighborhoodCol = neighborhoodColumnOverride || null;
    const notesCol = notesColumnOverride || null;
    const scheduledDateCol = scheduledDateColumnOverride || null;
    const statusCol = statusColumnOverride || null;
    const dealIdCol = dealIdColumnOverride || null;
    const stageCol = stageColumnOverride || null;
    const updatedDateCol = updatedDateColumnOverride || null;
    const specialtiesCol = findHeader(headers, [/especialidades/i]);
    const treatmentsCol = findHeader(headers, [/tratamentos/i]);
    const saleTypeCol = findHeader(headers, [/tipo\s+venda/i]);
    const userCol = findHeader(headers, [/usu[aá]rio/i, /vendedor/i, /consultor/i]);

    if (clinicCol && !headers.includes(clinicCol)) return Response.json({ error: `Coluna de clínica não encontrada: ${clinicCol}` }, { status: 400 });
    if (revenueCol && !headers.includes(revenueCol)) return Response.json({ error: `Coluna de faturamento não encontrada: ${revenueCol}` }, { status: 400 });
    if (dateCol && !headers.includes(dateCol)) return Response.json({ error: `Coluna de data não encontrada: ${dateCol}` }, { status: 400 });
    if (nameCol && !headers.includes(nameCol)) return Response.json({ error: `Coluna de nome não encontrada: ${nameCol}` }, { status: 400 });
    if (channelCol && !headers.includes(channelCol)) return Response.json({ error: `Coluna de canal não encontrada: ${channelCol}` }, { status: 400 });
    if (phoneCol && !headers.includes(phoneCol)) return Response.json({ error: `Coluna de telefone não encontrada: ${phoneCol}` }, { status: 400 });
    if (budgetCol && !headers.includes(budgetCol)) return Response.json({ error: `Coluna de orçamento não encontrada: ${budgetCol}` }, { status: 400 });
    if (paymentCol && !headers.includes(paymentCol)) return Response.json({ error: `Coluna de pagamento não encontrada: ${paymentCol}` }, { status: 400 });
    if (neighborhoodCol && !headers.includes(neighborhoodCol)) return Response.json({ error: `Coluna de bairro não encontrada: ${neighborhoodCol}` }, { status: 400 });
    if (notesCol && !headers.includes(notesCol)) return Response.json({ error: `Coluna de observação não encontrada: ${notesCol}` }, { status: 400 });
    if (scheduledDateCol && !headers.includes(scheduledDateCol)) return Response.json({ error: `Coluna de data agendada não encontrada: ${scheduledDateCol}` }, { status: 400 });
    if (statusCol && !headers.includes(statusCol)) return Response.json({ error: `Coluna de status não encontrada: ${statusCol}` }, { status: 400 });
    if (dealIdCol && !headers.includes(dealIdCol)) return Response.json({ error: `Coluna de ID não encontrada: ${dealIdCol}` }, { status: 400 });
    if (stageCol && !headers.includes(stageCol)) return Response.json({ error: `Coluna de etapa não encontrada: ${stageCol}` }, { status: 400 });
    if (updatedDateCol && !headers.includes(updatedDateCol)) return Response.json({ error: `Coluna de última atualização não encontrada: ${updatedDateCol}` }, { status: 400 });

    const pool = makeServerPool();
    await ensureTables(pool);

    const results: Record<string, number> = {};

    try {
      const rowsByClient = new Map<string, Record<string, unknown>[]>();

      for (const m of mappings) {
        if (!m.clientId) continue;

        const clientRows = clinicCol
          ? rows.filter(r => String(r[clinicCol] ?? '').trim() === m.clinicValue)
          : rows;

        if (clientRows.length === 0) { results[m.clinicValue] = 0; continue; }
        results[m.clinicValue] = clientRows.length;

        const current = rowsByClient.get(m.clientId);
        if (current) {
          current.push(...clientRows);
        } else {
          rowsByClient.set(m.clientId, [...clientRows]);
        }
      }

      for (const [clientId, groupedRows] of rowsByClient) {
        const mappingSnapshot = JSON.stringify({
          clinic: clinicCol, revenue: revenueCol, date: dateCol, name: nameCol,
          channel: channelCol, phone: phoneCol, budget: budgetCol, payment: paymentCol,
          neighborhood: neighborhoodCol, notes: notesCol, scheduledDate: scheduledDateCol,
          status: statusCol, dealId: dealIdCol, stage: stageCol, updatedDate: updatedDateCol,
        });

        const { rows: [upload] } = await pool.query(
          `INSERT INTO public.crm_uploads (client_id, filename, column_mapping, row_count, raw_rows)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [clientId, file.name, mappingSnapshot, groupedRows.length, JSON.stringify(groupedRows.slice(0, 500))],
        );

        const toRow = (row: Record<string, unknown>) => {
          const revenue = revenueCol ? parseRevenue(row[revenueCol]) : 0;
          const statusRaw = statusCol ? String(row[statusCol] ?? '').trim() || null : null;
          return {
            uploadId: upload.id as string,
            clientId,
            leadDate: dateCol ? parseDate(row[dateCol]) : null,
            leadName: nameCol ? String(row[nameCol] ?? '') : null,
            phone: phoneCol ? String(row[phoneCol] ?? '').trim() || null : null,
            channel: channelCol ? String(row[channelCol] ?? '').trim() || null : null,
            statusRaw,
            scheduledDate: scheduledDateCol ? parseDate(row[scheduledDateCol]) : null,
            budget: budgetCol ? parseRevenue(row[budgetCol]) : 0,
            payment: paymentCol ? String(row[paymentCol] ?? '').trim() || null : null,
            neighborhood: neighborhoodCol ? String(row[neighborhoodCol] ?? '').trim() || null : null,
            notes: compactDetails([
              ['Observação', notesCol ? row[notesCol] : null],
              ['Especialidades', specialtiesCol ? row[specialtiesCol] : null],
              ['Tratamentos', treatmentsCol ? row[treatmentsCol] : null],
              ['Tipo venda', saleTypeCol ? row[saleTypeCol] : null],
              ['Usuário', userCol ? row[userCol] : null],
            ]),
            revenue,
            closed: statusCol ? isWonStatus(statusRaw) : revenue > 0,
            raw: JSON.stringify(row),
          };
        };

        if (dealIdCol) {
          // Upsert path — preserves deals from earlier imports (different
          // months) and only updates a deal if this row is at least as
          // recent, so it never overwrites a later status with an older one.
          const externalIdOf = (row: Record<string, unknown>) => String(row[dealIdCol] ?? '').trim();
          const updatedAtOf = (row: Record<string, unknown>) => updatedDateCol ? parseDate(row[updatedDateCol]) : null;

          // Dedupe within this single file first — ON CONFLICT can't update
          // the same row twice in one statement.
          const latestById = new Map<string, Record<string, unknown>>();
          for (const row of groupedRows) {
            const id = externalIdOf(row);
            if (!id) continue;
            const prev = latestById.get(id);
            if (!prev || (updatedAtOf(row) ?? '') >= (updatedAtOf(prev) ?? '')) latestById.set(id, row);
          }
          const dedupedRows = Array.from(latestById.values());

          for (let i = 0; i < dedupedRows.length; i += 150) {
            const batch = dedupedRows.slice(i, i + 150).map(row => ({
              ...toRow(row),
              externalId: externalIdOf(row),
              stage: stageCol ? String(row[stageCol] ?? '').trim() || null : null,
              updatedAtExternal: updatedAtOf(row),
            }));
            await upsertLeadBatch(pool, batch);
          }
        } else {
          // Legacy path — no deal ID available, so each import fully replaces
          // this client's spreadsheet-derived data (original behavior).
          await pool.query(`DELETE FROM public.crm_leads WHERE client_id = $1 AND upload_id <> $2`, [clientId, upload.id]);
          await pool.query(`DELETE FROM public.crm_uploads WHERE client_id = $1 AND id <> $2`, [clientId, upload.id]);

          for (let i = 0; i < groupedRows.length; i += 150) {
            const batch = groupedRows.slice(i, i + 150).map(toRow);
            await insertLeadBatch(pool, batch);
          }
        }
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
