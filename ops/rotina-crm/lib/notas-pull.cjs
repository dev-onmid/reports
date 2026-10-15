// Conversas de UM cliente que precisam de nota de atendimento (0–5): tiveram
// mensagem nova desde a última nota (ou nos últimos 30 dias, se nunca tiveram)
// e o lead escreveu pelo menos uma vez — disparo sem resposta não é atendimento.
// Uso: node - <clientId> [maxLeads]
const { Pool } = require('pg');
// Início da avaliação por cliente (config.json → inicio_avaliacao): mensagens de antes
// não contam — ex.: Incorpast atendia por OUTRO WhatsApp até set/2026.
const INICIO = /^\d{4}-\d{2}-\d{2}$/.test(process.env.INICIO_AVALIACAO || '') ? process.env.INICIO_AVALIACAO : null;
const DESDE = (col) => INICIO ? `AND ${col} >= ('${INICIO}'::date::timestamp AT TIME ZONE 'America/Sao_Paulo')` : '';
(async () => {
  const [clientId, maxArg] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const max = Math.min(Math.max(parseInt(maxArg || '150', 10) || 150, 1), 400);
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  // ALTER pede lock exclusivo mesmo quando é no-op; só roda se faltar coluna.
  const { rows: [c] } = await pool.query(`SELECT COUNT(*)::int n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='crm_leads' AND column_name LIKE 'nota_atendimento%'`);
  if (c.n < 5) await pool.query(`ALTER TABLE public.crm_leads
    ADD COLUMN IF NOT EXISTS nota_atendimento SMALLINT, ADD COLUMN IF NOT EXISTS nota_atendimento_motivo TEXT,
    ADD COLUMN IF NOT EXISTS nota_atendimento_ajuste TEXT, ADD COLUMN IF NOT EXISTS nota_atendimento_trecho JSONB,
    ADD COLUMN IF NOT EXISTS nota_atendimento_em TIMESTAMPTZ`);
  const leads = (await pool.query(
    `SELECT l.id::text AS id, l.nome, l.canal, l.status, l.created_at, l.nota_atendimento AS nota_anterior,
            COALESCE(l.nota_atendimento_em, NOW() - INTERVAL '30 days') AS corte, MAX(m.created_at) AS ultima_msg
       FROM public.crm_leads l
       JOIN public.crm_messages m ON m.lead_id = l.id
      WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false
        AND m.created_at > COALESCE(l.nota_atendimento_em, NOW() - INTERVAL '30 days') ${DESDE('m.created_at')}
        AND EXISTS (SELECT 1 FROM public.crm_messages i WHERE i.lead_id = l.id AND i.direction = 'in'
                     AND i.created_at > NOW() - INTERVAL '30 days' ${DESDE('i.created_at')})
      GROUP BY l.id
      ORDER BY MAX(m.created_at) DESC
      LIMIT $2`, [clientId, max])).rows;
  const ids = leads.map(l => l.id);
  const msgs = ids.length ? (await pool.query(
    `SELECT lead_id::text AS lead_id, direction, created_at, LEFT(COALESCE(text, ''), 500) AS text, autor_nome
       FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.lead_id ORDER BY m.created_at DESC) rn
               FROM public.crm_messages m WHERE m.lead_id = ANY($1::uuid[]) ${DESDE('m.created_at')}) x
      WHERE rn <= 40 ORDER BY lead_id, created_at`, [ids])).rows : [];
  const porLead = new Map();
  for (const m of msgs) { if (!porLead.has(m.lead_id)) porLead.set(m.lead_id, []); porLead.get(m.lead_id).push(m); }
  process.stdout.write(JSON.stringify({
    clientId, pulled_at: new Date().toISOString(),
    leads: leads.map(l => ({ ...l, mensagens: (porLead.get(l.id) || []).map((m, i) => ({
      n: i + 1, d: m.direction, em: m.created_at, t: m.text, autor: m.autor_nome || null })) })),
  }));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
