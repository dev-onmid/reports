// Conversas com mensagem nova desde a última análise da rotina, de UM cliente.
// Roda dentro do container onmid-reports (node -), saída JSON no stdout.
// Uso: node - <clientId> [maxLeads]
const { Pool } = require('pg');
(async () => {
  const [clientId, maxArg] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const max = Math.min(Math.max(parseInt(maxArg || '150', 10) || 150, 1), 400);
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  await pool.query(`CREATE TABLE IF NOT EXISTS public.crm_rotina_analise (
    lead_id UUID PRIMARY KEY, client_id TEXT NOT NULL, analisado_em TIMESTAMPTZ NOT NULL, ultima_msg_em TIMESTAMPTZ)`);
  const stages = (await pool.query(
    `SELECT s.funnel_id::text AS funnel_id, s.label, s.position, s.etapa_funil
       FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id
      WHERE f.client_id = $1 ORDER BY s.funnel_id, s.position`, [clientId])).rows;
  // Corte: a última análise da rotina; sem ela, a última da IA; nunca mais de 7 dias atrás.
  const leads = (await pool.query(
    `WITH alvo AS (
       SELECT l.id, GREATEST(COALESCE(r.analisado_em, l.ia_ultimo_analise, NOW() - INTERVAL '3 days'), NOW() - INTERVAL '7 days') AS corte
         FROM public.crm_leads l
         LEFT JOIN public.crm_rotina_analise r ON r.lead_id = l.id
        WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false
     )
     SELECT l.id::text AS id, l.nome, l.canal, l.status, l.temperatura, l.valor_negocio, l.valor_rs, l.fechou,
            l.motivo_perda, l.funnel_id::text AS funnel_id, l.created_at, l.updated_at, LEFT(l.observacao, 300) AS observacao,
            a.corte, MAX(m.created_at) AS ultima_msg
       FROM alvo a
       JOIN public.crm_leads l ON l.id = a.id
       JOIN public.crm_messages m ON m.lead_id = a.id AND m.created_at > a.corte
      GROUP BY l.id, a.corte
      ORDER BY MAX(m.created_at) DESC
      LIMIT $2`, [clientId, max])).rows;
  const ids = leads.map(l => l.id);
  const msgs = ids.length ? (await pool.query(
    `SELECT lead_id::text AS lead_id, direction, created_at, LEFT(COALESCE(text, ''), 400) AS text, autor_nome
       FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.lead_id ORDER BY m.created_at DESC) rn
               FROM public.crm_messages m WHERE m.lead_id = ANY($1::uuid[])) x
      WHERE rn <= 40 ORDER BY lead_id, created_at`, [ids])).rows : [];
  const porLead = new Map();
  for (const m of msgs) { if (!porLead.has(m.lead_id)) porLead.set(m.lead_id, []); porLead.get(m.lead_id).push(m); }
  const out = {
    clientId, pulled_at: new Date().toISOString(), stages,
    leads: leads.map(l => ({ ...l, mensagens: (porLead.get(l.id) || []).map(m => ({
      d: m.direction, em: m.created_at, novo: new Date(m.created_at) > new Date(l.corte), t: m.text, autor: m.autor_nome || null })) })),
  };
  process.stdout.write(JSON.stringify(out));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
