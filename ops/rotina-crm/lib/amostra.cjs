// Amostra estratificada das conversas dos últimos 7 dias de UM cliente, para a
// leitura qualitativa da auditoria. Saída JSON.
// Uso: node - <clientId>
const { Pool } = require('pg');
// Início da avaliação por cliente (config.json → inicio_avaliacao): mensagens de antes
// não contam — ex.: Incorpast atendia por OUTRO WhatsApp até set/2026.
const INICIO = /^\d{4}-\d{2}-\d{2}$/.test(process.env.INICIO_AVALIACAO || '') ? process.env.INICIO_AVALIACAO : null;
const DESDE = (col) => INICIO ? `AND ${col} >= ('${INICIO}'::date::timestamp AT TIME ZONE 'America/Sao_Paulo')` : '';
(async () => {
  const [clientId] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  const ativos = `SELECT l.id, l.nome, l.canal, l.status, l.temperatura, l.fechou, l.motivo_perda, l.created_at,
       COUNT(m.*) FILTER (WHERE m.created_at > NOW() - INTERVAL '7 days') AS n7,
       (ARRAY_AGG(m.direction ORDER BY m.created_at DESC))[1] AS ult_dir, MAX(m.created_at) AS ult_em
     FROM public.crm_leads l JOIN public.crm_messages m ON m.lead_id = l.id ${DESDE('m.created_at')}
    WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false
    GROUP BY l.id HAVING MAX(m.created_at) > NOW() - INTERVAL '7 days'`;
  const pega = async (ordem, filtro, k, motivo, ja) => (await pool.query(
    `SELECT *, $3::text AS motivo FROM (${ativos}) a WHERE ${filtro} AND NOT (id = ANY($4::uuid[])) ORDER BY ${ordem} LIMIT $2`,
    [clientId, k, motivo, ja])).rows;
  const escolhidos = [];
  const ids = () => escolhidos.map(e => e.id);
  escolhidos.push(...await pega('ult_em ASC', "ult_dir = 'in'", 8, 'cliente esperando resposta', ids()));
  escolhidos.push(...await pega('n7 DESC', 'true', 6, 'conversa longa da semana', ids()));
  escolhidos.push(...await pega('ult_em DESC', '(fechou OR motivo_perda IS NOT NULL)', 4, 'ganho ou perda', ids()));
  escolhidos.push(...await pega('random()', 'true', 10, 'amostra geral', ids()));
  const msgs = escolhidos.length ? (await pool.query(
    `SELECT lead_id::text AS lead_id, direction, created_at, LEFT(COALESCE(text, ''), 300) AS text, autor_nome
       FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.lead_id ORDER BY m.created_at DESC) rn
               FROM public.crm_messages m WHERE m.lead_id = ANY($1::uuid[]) ${DESDE('m.created_at')}) x WHERE rn <= 40 ORDER BY lead_id, created_at`,
    [ids()])).rows : [];
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM (${ativos}) a`, [clientId])).rows[0].n;
  process.stdout.write(JSON.stringify({ clientId, conversas_ativas_7d: total, amostra: escolhidos.map(e => ({
    id: e.id, nome: e.nome, canal: e.canal, status: e.status, temperatura: e.temperatura, criado_em: e.created_at, motivo: e.motivo,
    mensagens: msgs.filter(m => m.lead_id === e.id).map(m => ({ d: m.direction, em: m.created_at, t: m.text, autor: m.autor_nome || null })) })) }));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
