import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { makeServerPool } from '@/lib/server-db';

import { origemIntegravel, resumirOrigens, dedupLote, dedupPorTelefone, idExterno, chaveTelefone, sinaisDoStatus, indexarOcorrencias } from '@/lib/importacao-origem';

/** Tipo da planilha, escolhido na importação. Ver comentário em LeadParaFunil. */
export type TipoPlanilha = 'lead' | 'venda' | 'hibrido';
function normalizarTipoPlanilha(v: unknown): TipoPlanilha {
  return v === 'lead' || v === 'venda' ? v : 'hibrido';
}

/**
 * external_id ESTÁVEL para o ledger de Vendas (que não tem telefone nem ID de
 * negócio). Sem isso, reimportar o mesmo relatório de faturamento inseria tudo
 * de novo e DOBRAVA a receita a cada importação — o bug central que o Matheus
 * relatou. Com uma chave derivada de (paciente + data de fechamento + valor +
 * detalhe), o reimport faz UPDATE em vez de duplicar. Parcelas do mesmo paciente
 * têm valores diferentes, então não colapsam entre si.
 */
function sintetizarIdVenda(
  clientId: string,
  r: { leadName: string | null; dataFechamento: string | null; revenue: number; notes: string | null },
  ocorrencia = 0,
): string {
  const base = [clientId, (r.leadName ?? '').trim().toLowerCase(), r.dataFechamento ?? '', r.revenue, (r.notes ?? '').slice(0, 60)].join('|');
  // ⚠️ O sufixo só entra a partir da SEGUNDA ocorrência, de propósito: mudar a
  // chave de todas as linhas faria a próxima importação inserir o ledger
  // inteiro de novo — exatamente o bug que esta função existe pra evitar.
  // Assim a 1ª linha mantém o id histórico e só a repetição ganha id próprio.
  //
  // Existe repetição legítima: entrada e parcela do MESMO orçamento, no mesmo
  // minuto, com o mesmo valor (visto na Sorrifácil ingleses, 19/08/2026 —
  // R$ 3.114,50 lançados como entrada e como a prazo). Sem o sufixo, uma das
  // duas sumia.
  const chave = ocorrencia > 0 ? `${base}|#${ocorrencia}` : base;
  return 'venda:' + createHash('sha1').update(chave).digest('hex').slice(0, 32);
}

/** Um grupo de arquivos com o MESMO cabeçalho — mesmo mapeamento serve pros dois. */
export type SpreadsheetFormato = {
  assinatura: string;
  arquivos: { nome: string; linhas: number }[];
  headers: string[];
  rowCount: number;
  mapping: SpreadsheetColumnMapping;
  distinctValues: Record<string, string[]>;
  preview: Record<string, unknown>[];
};

export type SpreadsheetAnalysis = {
  headers: string[];
  clinicValues: string[];
  distinctValues: Record<string, string[]>;
  rowCount: number;
  mapping: SpreadsheetColumnMapping;
  preview: Record<string, unknown>[];
  /**
   * Todos os formatos detectados no envio. Relatórios diferentes (Leads e
   * Faturamento, por exemplo) têm colunas diferentes e NÃO podem dividir um
   * mapeamento — "DATA CADASTRO" e "DATA FATURAMENTO" cairiam no mesmo campo.
   * Cada um vem aqui com o seu, e a tela importa um por vez.
   */
  formatos: SpreadsheetFormato[];
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
      ADD COLUMN IF NOT EXISTS compareceu BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS agendou BOOLEAN DEFAULT FALSE,
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
      ADD COLUMN IF NOT EXISTS updated_at_external DATE,
      -- Separa VENDA de LEAD (default 'hibrido' = tudo que já existe, sem mudança).
      ADD COLUMN IF NOT EXISTS registro_tipo TEXT DEFAULT 'hibrido',
      -- Data de FECHAMENTO da venda; a receita é janelada por ela (não pela data
      -- de cadastro do lead), que é o "período de venda = fechamento" pedido.
      ADD COLUMN IF NOT EXISTS data_fechamento DATE
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
    compareceu?: boolean;
    agendou?: boolean;
    registroTipo?: TipoPlanilha;
    dataFechamento?: string | null;
    raw: string;
  }>,
) {
  if (rows.length === 0) return;

  const COLS = 27;
  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * COLS;
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
      // Booleanos que o funil de performance lê (Comparecimentos/Agendamentos).
      row.compareceu ?? false,
      row.agendou ?? false,
      row.registroTipo ?? 'hibrido',
      row.dataFechamento ?? null,
    );
    return `(${Array.from({ length: COLS }, (_, i) => `$${base + i + 1}`).join(',')})`;
  }).join(',');

  await pool.query(
    `INSERT INTO public.crm_leads
      (upload_id, client_id, lead_date, lead_name, phone, source, city, status_raw,
       data, nome, numero, canal, observacao, orcamento, pagamento, bairro, data_agendada,
       revenue, valor_rs, fechou, status_category, status, raw, compareceu, agendou,
       registro_tipo, data_fechamento)
     VALUES ${placeholders}
     -- SEM alvo de propósito: a producao tem uma unique (client_id, numero)
     -- criada FORA do repo; com alvo explicito, instalacao sem a constraint
     -- quebraria. Colisao residual (raro: numero igual cru que a chave
     -- normalizada nao casou) e pulada em vez de derrubar o lote de 150.
     ON CONFLICT DO NOTHING`,
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
/**
 * Upsert pelo TELEFONE, para planilha sem coluna de ID do negócio.
 *
 * Faz a ponte que o pedido do Matheus descreve: um lead que chegou pela
 * integração do WhatsApp já existe no CRM com atribuição completa (campanha,
 * criativo, ctwa_clid), e a planilha do CRM da clínica traz a informação que só
 * ela tem — que ele COMPROU. Casar por telefone atualiza aquele lead em vez de
 * criar um segundo, que apareceria como dois leads e contaria a venda duas
 * vezes no funil.
 *
 * Resolvido em JS e não com ON CONFLICT porque o CÓDIGO não cria índice único
 * por telefone em `crm_leads`. ⚠️ MAS a PRODUÇÃO tem um, criado fora do repo
 * (`crm_leads_client_numero_unique`, visto em erro real de 2026-08-11) — por
 * isso o lote é deduplicado por telefone antes do INSERT e o insertLeadBatch
 * usa ON CONFLICT DO NOTHING sem alvo (vale pra qualquer constraint, e não
 * quebra instalação que não tem nenhuma).
 */
async function upsertPorTelefone(
  pool: ReturnType<typeof makeServerPool>,
  rows: Array<{
    uploadId: string; clientId: string;
    leadDate: string | null; leadName: string | null; phone: string | null;
    channel: string | null; statusRaw: string | null; scheduledDate: string | null;
    budget: number; payment: string | null; neighborhood: string | null;
    notes: string | null; revenue: number; closed: boolean; raw: string;
    compareceu?: boolean; agendou?: boolean;
    registroTipo?: TipoPlanilha; dataFechamento?: string | null;
  }>,
) {
  if (rows.length === 0) return;
  const clientId = rows[0].clientId;

  // Dedupe DENTRO do lote: o mesmo lead aparece em exports de meses
  // diferentes importados juntos, e duas linhas novas com o mesmo número num
  // só INSERT estouram a unique de produção — derrubando a importação
  // inteira. Regras em dedupPorTelefone (importacao-origem.ts).
  rows = dedupPorTelefone(rows);

  const fones = rows.map(r => chaveTelefone(r.phone)).filter((f): f is string => Boolean(f));
  const existentes = new Map<string, string>();
  if (fones.length > 0) {
    const { rows: achados } = await pool.query<{ id: string; numero: string | null; phone: string | null }>(
      `SELECT id::text, numero, phone FROM public.crm_leads WHERE client_id = $1`,
      [clientId],
    );
    for (const a of achados) {
      // Indexa pelos dois campos: instalações antigas gravaram em `numero`,
      // as novas em `phone`.
      for (const v of [a.numero, a.phone]) {
        const k = chaveTelefone(v);
        if (k && !existentes.has(k)) existentes.set(k, a.id);
      }
    }
  }

  const novos: typeof rows = [];
  for (const r of rows) {
    const k = chaveTelefone(r.phone);
    const id = k ? existentes.get(k) : undefined;
    if (!id) { novos.push(r); continue; }

    // Só STATUS. Nome, telefone, canal, origem, campanha e criativo ficam como
    // estão — quem viu o lead chegar sabe disso melhor que a planilha.
    await pool.query(
      `UPDATE public.crm_leads SET
         status = COALESCE($2, status),
         status_raw = COALESCE($3, status_raw),
         status_category = COALESCE($4, status_category),
         -- fechou, compareceu e agendou só AVANÇAM: um export posterior com
         -- status diferente não desfaz venda, presença nem agendamento.
         fechou = public.crm_leads.fechou OR $5,
         compareceu = COALESCE(public.crm_leads.compareceu, false) OR $12,
         agendou = COALESCE(public.crm_leads.agendou, false) OR $13,
         revenue = $6, valor_rs = $6,
         orcamento = COALESCE($7, orcamento),
         pagamento = COALESCE($8, pagamento),
         data_agendada = COALESCE($9, data_agendada),
         observacao = COALESCE(NULLIF($10, ''), observacao),
         upload_id = $11
       WHERE id = $1::uuid`,
      [
        id,
        r.statusRaw || (r.closed ? 'Fechado' : null),
        r.statusRaw,
        r.closed ? 'won' : null,
        r.closed,
        r.revenue,
        r.budget,
        r.payment,
        r.scheduledDate,
        r.notes,
        r.uploadId,
        r.compareceu ?? false,
        r.agendou ?? false,
      ],
    );
  }

  for (let i = 0; i < novos.length; i += 150) {
    await insertLeadBatch(pool, novos.slice(i, i + 150));
  }
}

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
    compareceu?: boolean;
    agendou?: boolean;
    registroTipo?: TipoPlanilha;
    dataFechamento?: string | null;
    raw: string;
  }>,
) {
  if (rows.length === 0) return;

  const COLS = 30;
  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * COLS;
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
      row.compareceu ?? false,
      row.agendou ?? false,
      row.registroTipo ?? 'hibrido',
      row.dataFechamento ?? null,
    );
    return `(${Array.from({ length: COLS }, (_, i) => `$${base + i + 1}`).join(',')})`;
  }).join(',');

  await pool.query(
    `INSERT INTO public.crm_leads
      (upload_id, client_id, external_id,
       lead_date, lead_name, phone, source, city, status_raw,
       data, nome, numero, canal, bairro, data_agendada,
       stage, updated_at_external,
       orcamento, pagamento, observacao,
       revenue, valor_rs, fechou, status_category, status, raw, compareceu, agendou,
       registro_tipo, data_fechamento)
     VALUES ${placeholders}
     -- ATENCAO: o WHERE abaixo e OBRIGATORIO. O indice unico de
     -- (client_id, external_id) é PARCIAL (só vale com external_id NOT NULL), e
     -- o Postgres só reconhece um índice parcial se o ON CONFLICT repetir o
     -- mesmo predicado. Sem ele, o erro é
     -- "there is no unique or exclusion constraint matching the ON CONFLICT
     -- specification" — e a importação inteira falha. O mesmo tropeço já está
     -- anotado em webhook/whatsapp/[instanceId] e em webhooks/[token].
     ON CONFLICT (client_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
       upload_id = EXCLUDED.upload_id,
       -- ── IDENTIDADE E ATRIBUIÇÃO: só preenchem se estiverem VAZIAS ────────
       -- A planilha sabe o que ACONTECEU com o lead; ela não sabe de onde ele
       -- VEIO. Um lead que entrou pelo WhatsApp carrega ctwa_clid, campanha e
       -- criativo — sobrescrever com o "canal" do CRM da clínica apagaria a
       -- única informação que liga a venda ao anúncio. Mesmo COALESCE que o
       -- caminho do WhatsApp já usa em crm-conversation-sync.
       lead_date = COALESCE(public.crm_leads.lead_date, EXCLUDED.lead_date),
       data      = COALESCE(public.crm_leads.data, EXCLUDED.data),
       lead_name = COALESCE(NULLIF(public.crm_leads.lead_name, ''), EXCLUDED.lead_name),
       nome      = COALESCE(NULLIF(public.crm_leads.nome, ''), EXCLUDED.nome),
       phone     = COALESCE(NULLIF(public.crm_leads.phone, ''), EXCLUDED.phone),
       numero    = COALESCE(NULLIF(public.crm_leads.numero, ''), EXCLUDED.numero),
       source    = COALESCE(NULLIF(public.crm_leads.source, ''), EXCLUDED.source),
       canal     = COALESCE(NULLIF(public.crm_leads.canal, ''), EXCLUDED.canal),
       city      = COALESCE(NULLIF(public.crm_leads.city, ''), EXCLUDED.city),
       bairro    = COALESCE(NULLIF(public.crm_leads.bairro, ''), EXCLUDED.bairro),
       -- ── STATUS: a planilha manda, é pra isso que ela é reimportada ───────
       status_raw = EXCLUDED.status_raw,
       data_agendada = EXCLUDED.data_agendada,
       stage = EXCLUDED.stage,
       updated_at_external = EXCLUDED.updated_at_external,
       orcamento = EXCLUDED.orcamento,
       pagamento = EXCLUDED.pagamento,
       observacao = EXCLUDED.observacao,
       revenue = EXCLUDED.revenue, valor_rs = EXCLUDED.valor_rs,
       fechou = EXCLUDED.fechou,
       -- Ledger de vendas: reimport atualiza tipo/data de fechamento no lugar.
       registro_tipo = EXCLUDED.registro_tipo,
       data_fechamento = COALESCE(EXCLUDED.data_fechamento, public.crm_leads.data_fechamento),
       status_category = EXCLUDED.status_category,
       status = EXCLUDED.status,
       -- compareceu e agendou só AVANÇAM: quem já compareceu/agendou não deixa
       -- de ter feito isso porque um export posterior veio com status diferente.
       compareceu = public.crm_leads.compareceu OR EXCLUDED.compareceu,
       agendou = COALESCE(public.crm_leads.agendou, false) OR EXCLUDED.agendou,
       raw = EXCLUDED.raw
     WHERE public.crm_leads.updated_at_external IS NULL
        OR EXCLUDED.updated_at_external IS NULL
        OR EXCLUDED.updated_at_external >= public.crm_leads.updated_at_external`,
    values,
  ).catch(async (err: unknown) => {
    // ⚠️ A produção tem uma unique (client_id, numero) criada FORA do repo
    // (crm_leads_client_numero_unique). O ON CONFLICT acima só cobre o índice
    // de external_id — dois negócios com o MESMO telefone (ou telefone já
    // existente noutro lead) estouram a de numero e matariam o lote inteiro.
    // Fallback: esse lote cai pro casamento por TELEFONE, que atualiza em vez
    // de duplicar (e cujo insert já tolera conflito).
    const e = err as { code?: string; constraint?: string; message?: string };
    const eDeNumero = e?.code === '23505' && `${e?.constraint ?? ''}${e?.message ?? ''}`.includes('numero');
    if (!eDeNumero) throw err;
    await upsertPorTelefone(pool, rows);
  });
}

// POST ?step=analyze — parse file and detect columns
// POST ?step=import  — process mappings and store data
export async function POST(req: NextRequest) {
  try {
    const step = req.nextUrl.searchParams.get('step') ?? 'analyze';
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const formData = await req.formData();
    // `getAll` em vez de `get`: o seletor aceita várias planilhas de uma vez, e
    // exports de meses diferentes são unificados num lote só.
    const arquivos = formData.getAll('file').filter((f): f is File => f instanceof File);
    const file = arquivos[0] ?? null;

    if (!file) return Response.json({ error: 'Arquivo obrigatório.' }, { status: 400 });

    let XLSX: typeof import('xlsx');
    try {
      XLSX = await import('xlsx');
    } catch {
      return Response.json({ error: 'Pacote xlsx não instalado. Execute: npm install xlsx' }, { status: 500 });
    }

    // Lê todos os arquivos e concatena. Planilha com cabeçalho DIFERENTE do
    // primeiro é recusada pelo nome, em vez de importada torto: aplicar o
    // mapeamento de um arquivo em outro colocaria data na coluna de valor sem
    // ninguém perceber até o faturamento não fechar.
    // Agrupa por ASSINATURA de cabeçalho. Arquivos do mesmo relatório (meses
    // diferentes) caem no mesmo grupo e compartilham o mapeamento; relatórios
    // diferentes viram grupos separados, cada um com o seu — sem isso,
    // "DATA CADASTRO" e "DATA FATURAMENTO" cairiam no mesmo campo e ninguém
    // perceberia até o Dashboard mostrar data errada.
    const grupos = new Map<string, { headers: string[]; rows: Record<string, unknown>[]; arquivos: { nome: string; linhas: number }[] }>();

    for (const f of arquivos) {
      let buf = Buffer.from(await f.arrayBuffer());
      let nome = f.name;
      // O navegador comprime antes de enviar (gzip) pra caber no teto de
      // 4,5 MB de corpo da Vercel — 5,7 MB de CSV cru derrubava a conexão
      // ANTES da rota rodar ("Erro de conexão"). Detecção por magic bytes,
      // não pelo nome: cobre qualquer origem do gzip.
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        const { gunzipSync } = await import('node:zlib');
        buf = gunzipSync(buf);
        nome = nome.replace(/\.gz$/i, '');
      }
      const wb = XLSX.read(buf, { type: 'buffer', raw: nome.match(/\.csv$/i) ? true : undefined });
      const sh = wb.Sheets[wb.SheetNames[0]];
      const r: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sh, { defval: '' });
      if (r.length === 0) continue;

      const h = Object.keys(r[0]);
      const chave = h.join('|');
      const g = grupos.get(chave);
      // `nome` (sem .gz), nunca `f.name`: a tela casa esses nomes com os
      // arquivos originais dela pra montar os lotes da importação.
      if (g) { g.rows.push(...r); g.arquivos.push({ nome, linhas: r.length }); }
      else grupos.set(chave, { headers: h, rows: r, arquivos: [{ nome, linhas: r.length }] });
    }

    if (grupos.size === 0) return Response.json({ error: 'Planilha vazia.' }, { status: 400 });

    // A ETAPA DE IMPORTAÇÃO processa um formato por chamada: a tela envia só os
    // arquivos daquele grupo. Se vier mais de um aqui, é a análise.
    const primeiro = [...grupos.values()][0];
    const rows = primeiro.rows;
    const porArquivo = primeiro.arquivos;
    const headers = primeiro.headers;

    // ── Step: analyze ──────────────────────────────────────────────────────────
    if (step === 'analyze') {
      if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

      // Uma detecção por FORMATO. Custa uma chamada de IA por grupo — dois
      // relatórios diferentes = duas chamadas; vários meses do mesmo = uma só.
      const formatos: SpreadsheetFormato[] = [];
      const clinicasDeTodos = new Set<string>();

      for (const [assinatura, g] of grupos) {
        const m = await detectColumnsWithClaude(g.headers, g.rows, apiKey);
        const dv: Record<string, string[]> = {};
        for (const h of g.headers) {
          const seen = new Set<string>(); const vals: string[] = [];
          for (const row of g.rows) {
            const v = String(row[h] ?? '').trim();
            if (v && !seen.has(v)) { seen.add(v); vals.push(v); }
            if (vals.length >= 500) break;
          }
          dv[h] = vals;
        }
        if (m.clinic) for (const row of g.rows) {
          const v = String(row[m.clinic] ?? '').trim();
          if (v) clinicasDeTodos.add(v);
        }
        formatos.push({
          assinatura, arquivos: g.arquivos, headers: g.headers,
          rowCount: g.rows.length, mapping: m, distinctValues: dv,
          preview: g.rows.slice(0, 3),
        });
      }

      const mapping = formatos[0].mapping;
      const clinicValues: string[] = [...clinicasDeTodos];
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
      return Response.json({
        // Campos de topo = primeiro formato, pra não quebrar quem já consome.
        headers,
        // Clínicas somadas de TODOS os formatos: o de-para clínica→cliente é
        // um só, mesmo quando os relatórios são diferentes.
        clinicValues,
        distinctValues,
        rowCount: rows.length,
        mapping,
        preview: rows.slice(0, 3),
        formatos,
      } satisfies SpreadsheetAnalysis);
    }

    // ── Step: import ───────────────────────────────────────────────────────────
    const tipoPlanilha = normalizarTipoPlanilha(formData.get('tipoPlanilha'));
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
    // ⚠️ Num relatório de FATURAMENTO a data que importa é a do FATURAMENTO, não
    // a do orçamento — o orçamento pode ser de meses antes (visto ao vivo: um
    // tratamento orçado em 01/06 e faturado em 21/08 caía em JUNHO). A
    // detecção automática pega a PRIMEIRA coluna que casa com /data/, que nesse
    // export é "DATA ORCAMENTO", e ninguém percebe. Só no tipo Venda, e só
    // quando existe uma coluna de data claramente de faturamento.
    const dataDeFaturamento = tipoPlanilha === 'venda'
      ? findHeader(headers, [/data.*(faturamento|fatura|recebimento|pagamento)/i]) : null;
    const dateCol = (dataDeFaturamento ?? dateColumnOverride) || null;
    const dataTrocada = dataDeFaturamento && dateColumnOverride && dataDeFaturamento !== dateColumnOverride
      ? { de: dateColumnOverride, para: dataDeFaturamento } : null;
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

    // O filtro de origem (allowlist ORIGENS_INTEGRAVEIS) vale para TODOS os
    // tipos, INCLUSIVE Vendas. O faturamento do dashboard é o dos canais que a
    // agência opera (WhatsApp/Chatwoot/Facebook/Instagram/Google/Site); Indicação,
    // Fachada/Passou em Frente e "Reavaliação/Já sou Paciente" NÃO entram — o
    // número de referência da clínica (validado com o Matheus) é exatamente o
    // total MENOS esses canais orgânicos. As linhas fora da allowlist viram
    // `receita_descartada` na resposta (transparência).
    const aplicaFiltroOrigem = true;

    const results: Record<string, number> = {};
    // Relatório do que foi cortado. Vai pra resposta de propósito: descarte
    // silencioso faria o usuário achar que a importação perdeu linhas.
    const resumoOrigem = channelCol && aplicaFiltroOrigem
      ? resumirOrigens(rows.map(r => r[channelCol]))
      : { aceitas: rows.length, descartadas: 0, origens: [] as { origem: string; linhas: number }[] };

    // O VALOR descartado, não só a contagem de linhas. Numa planilha real de
    // clínica, 63% das linhas fora da lista representaram 58% do faturamento
    // (R$ 604 mil de R$ 1,03 mi) — dizer só "325 linhas" esconderia a ordem de
    // grandeza do que não vai aparecer no Dashboard.
    let receitaDescartada = 0;
    if (channelCol && revenueCol && aplicaFiltroOrigem) {
      for (const r of rows) {
        if (!origemIntegravel(r[channelCol])) receitaDescartada += parseRevenue(r[revenueCol]);
      }
    }
    let duplicadasNoLote = 0;

    try {
      const rowsByClient = new Map<string, Record<string, unknown>[]>();

      for (const m of mappings) {
        if (!m.clientId) continue;

        let clientRows = clinicCol
          ? rows.filter(r => String(r[clinicCol] ?? '').trim() === m.clinicValue)
          : rows;

        // Corte da allowlist de origem. Acontece AQUI, antes de virar lead:
        // `crm_leads` é lida por 54 arquivos e 85 consultas, e filtrar em todas
        // seria inviável — uma esquecida faria o CRM mostrar um total e o
        // Dashboard outro. Pulado no tipo Venda (faturamento total, todo canal).
        if (channelCol && aplicaFiltroOrigem) clientRows = clientRows.filter(r => origemIntegravel(r[channelCol]));

        // Dedupe do lote quando há ID do negócio: importar meses diferentes faz
        // a mesma linha aparecer várias vezes, e vale a versão MAIS RECENTE —
        // ficar com a primeira congelaria o negócio numa etapa antiga.
        //
        // ⚠️ NUNCA no tipo Venda. Num relatório de LEADS o id do negócio é único
        // por linha; num LEDGER DE FATURAMENTO o mesmo orçamento gera VÁRIAS
        // linhas (entrada + parcelas, tratamentos faturados em datas
        // diferentes), e colapsá-las por esse id apaga faturamento real.
        // Medido no caso que trouxe este bug (Sorrifácil ingleses, agosto/2026,
        // `dealId` mapeado como "ORCAMENTO"): 13 orçamentos com 2 linhas cada,
        // R$ 43.118,70 descartados em silêncio de R$ 110.694,52 do mês.
        // A identidade do ledger é o `sintetizarIdVenda`, que distingue linha a
        // linha — não o número do orçamento.
        if (dealIdCol && tipoPlanilha !== 'venda') {
          const d = dedupLote(clientRows, r => String(r[dealIdCol] ?? '').trim() || JSON.stringify(r));
          duplicadasNoLote += d.duplicadas;
          clientRows = d.unicas;
        }

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
          const revenueBruto = revenueCol ? parseRevenue(row[revenueCol]) : 0;
          // Leads alimentam SÓ o funil: o valor não vira faturamento em lugar
          // nenhum (revenue = 0). Separar aqui, na gravação, protege TODAS as
          // telas que somam receita de crm_leads (relatório, portal, criativos…)
          // de contar a mesma venda de novo — não só o dashboard.
          const revenue = tipoPlanilha === 'lead' ? 0 : revenueBruto;
          const statusRaw = statusCol ? String(row[statusCol] ?? '').trim() || null : null;
          // O funil de performance lê os BOOLEANOS `compareceu`/`fechou`, não o
          // texto. Sem traduzir aqui, "Avaliação Realizada" nunca vira
          // comparecimento e a etapa fica zerada mesmo com o CRM correto.
          const sinais = sinaisDoStatus(statusRaw);
          return {
            compareceu: sinais.compareceu,
            agendou: sinais.agendou,
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
            // `fechou` pelo vocabulário da planilha OU pela regra antiga —
            // manter as duas evita quebrar quem já importava com outro texto.
            // No ledger de Vendas toda linha É uma venda concluída. Usa o valor
            // BRUTO no heurístico (o revenue já pode ter sido zerado no tipo Leads).
            closed: tipoPlanilha === 'venda'
              ? true
              : sinais.fechou || (statusCol ? isWonStatus(statusRaw) : revenueBruto > 0),
            registroTipo: tipoPlanilha,
            // Data de fechamento = a data mapeada no relatório de Vendas
            // (ex.: DATA FATURAMENTO). Só o tipo Venda janela a receita por ela.
            dataFechamento: tipoPlanilha === 'venda' ? (dateCol ? parseDate(row[dateCol]) : null) : null,
            raw: JSON.stringify(row),
          };
        };

        if (tipoPlanilha === 'venda') {
          // Ledger de faturamento: sem telefone nem ID, cada linha recebe um
          // external_id ESTÁVEL (sintetizarIdVenda) e vai pelo upsert — reimportar
          // o mesmo relatório ATUALIZA em vez de duplicar (era o bug do "mais que
          // deveria"). Dedupe dentro do lote pelo mesmo id (ON CONFLICT não pode
          // tocar a mesma linha 2x num INSERT).
          const porId = new Map<string, ReturnType<typeof toRow> & { externalId: string; stage: string | null; updatedAtExternal: string | null }>();
          // Quantas linhas idênticas já apareceram, por chave base. A ordem do
          // arquivo é a régua: o mesmo arquivo reimportado gera os mesmos
          // índices, então o upsert continua idempotente.
          const linhas = groupedRows.map(toRow);
          for (const { linha: r, ocorrencia } of indexarOcorrencias(linhas, l => sintetizarIdVenda(clientId, l))) {
            const externalId = sintetizarIdVenda(clientId, r, ocorrencia);
            porId.set(externalId, { ...r, externalId, stage: null, updatedAtExternal: r.dataFechamento });
          }
          const batchVendas = [...porId.values()];
          for (let i = 0; i < batchVendas.length; i += 150) {
            await upsertLeadBatch(pool, batchVendas.slice(i, i + 150));
          }
        } else if (dealIdCol) {
          // Upsert path — preserves deals from earlier imports (different
          // months) and only updates a deal if this row is at least as
          // recent, so it never overwrites a later status with an older one.
          // `idExterno` rejeita marcador de "ainda não tem": numa planilha real,
          // NUMERO ORCAMENTO vinha "-" em 1.556 de 1.853 linhas, e tratá-lo como
          // ID fundiria esses 1.556 leads num só.
          const externalIdOf = (row: Record<string, unknown>) => idExterno(row[dealIdCol]) ?? '';
          const updatedAtOf = (row: Record<string, unknown>) => updatedDateCol ? parseDate(row[updatedDateCol]) : null;

          // Dedupe within this single file first — ON CONFLICT can't update
          // the same row twice in one statement.
          // Linhas SEM id de verdade não podem ser descartadas nem agrupadas —
          // elas seguem pelo caminho do telefone, que é a identidade real.
          const semId = groupedRows.filter(r => !externalIdOf(r));

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

          // As sem ID vão pelo telefone, em vez de sumirem da importação.
          for (let i = 0; i < semId.length; i += 150) {
            await upsertPorTelefone(pool, semId.slice(i, i + 150).map(toRow));
          }
        } else {
          // Sem coluna de ID do negócio, a identidade do lead é o TELEFONE.
          //
          // ⚠️ Este caminho APAGAVA todos os leads e todo o histórico de uploads
          // anteriores do cliente antes de inserir ("cada import substitui
          // tudo"). Reimportar destruía o passado — inclusive o status já
          // trabalhado no CRM. Agora casa por telefone e atualiza só o status.
          //
          // Numa planilha real, o telefone era único em 1.852 de 1.853 linhas,
          // enquanto a coluna de orçamento vinha "-" em 84% delas: telefone é a
          // identidade confiável, número de orçamento não.
          for (let i = 0; i < groupedRows.length; i += 150) {
            const batch = groupedRows.slice(i, i + 150).map(toRow);
            await upsertPorTelefone(pool, batch);
          }
        }
      }

      return Response.json({
      ok: true,
      results,
      arquivos: porArquivo,
      linhas_lidas: rows.length,
      origem_descartadas: resumoOrigem.descartadas,
      origens_fora: resumoOrigem.origens.slice(0, 10),
      receita_descartada: receitaDescartada,
      duplicadas_no_lote: duplicadasNoLote,
      // Troca de coluna de data no ledger de Vendas. Vai pra resposta porque
      // corrigir em silêncio é a mesma doença de descartar em silêncio.
      data_trocada: dataTrocada,
    });
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
