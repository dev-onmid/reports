// Lista (separados por espaço) os clientes que ainda têm conversa sem nota atual.
const { Pool } = require("pg");
(async () => {
  const ids = process.argv.slice(2).filter(s => /^client-\d+$/.test(s));
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  const r = await pool.query(`SELECT l.client_id, COUNT(*)::int n FROM public.crm_leads l
    WHERE l.client_id = ANY($1) AND COALESCE(l.time_interno, false) = false
      AND EXISTS (SELECT 1 FROM public.crm_messages m WHERE m.lead_id = l.id AND m.created_at > COALESCE(l.nota_atendimento_em, NOW() - INTERVAL '30 days'))
      AND EXISTS (SELECT 1 FROM public.crm_messages i WHERE i.lead_id = l.id AND i.direction = 'in' AND i.created_at > NOW() - INTERVAL '30 days')
    GROUP BY 1 ORDER BY 2 DESC`, [ids]);
  console.log(r.rows.map(x => x.client_id).join(" "));
  await pool.end();
})().catch(e => { console.error("ERRO", e.message); process.exit(1); });
