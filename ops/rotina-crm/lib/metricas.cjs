// Métricas de atendimento de UM cliente: janela de 30 dias pela data da MENSAGEM,
// mais os últimos 7 dias contra os 7 anteriores. Saída JSON.
// Uso: node - <clientId>
const { Pool } = require('pg');
(async () => {
  const [clientId] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  const BASE = `
    base AS (
      SELECT m.id, m.lead_id, m.direction, m.created_at, m.autor_nome
        FROM public.crm_messages m JOIN public.crm_leads l ON l.id = m.lead_id
       WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false AND m.created_at IS NOT NULL
         AND m.created_at > NOW() - INTERVAL '75 days'
    ),
    msg AS (
      SELECT b.*, LAG(b.direction) OVER w AS dir_ant, LAG(b.created_at) OVER w AS em_ant,
             MIN(b.created_at) FILTER (WHERE b.direction = 'out') OVER (w ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS prox_out,
             MIN(b.created_at) FILTER (WHERE b.direction = 'in')  OVER (w ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS prox_in
        FROM base b WINDOW w AS (PARTITION BY b.lead_id ORDER BY b.created_at, b.id)
    )`;
  const janela = async (desde, ate) => (await pool.query(
    `WITH ${BASE},
     t AS (SELECT *, EXTRACT(EPOCH FROM (prox_out - created_at))::float AS resp,
                  EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') AS hora,
                  EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') AS dow,
                  -- Prazo de quem escreve fora do expediente (seg–sex 8h–18h e sábado 8h–10h):
                  -- noite de seg a qui → dia seguinte 12h; sexta à noite e sábado antes das 8h → sábado 10h;
                  -- sábado depois das 10h e domingo → segunda 12h. Fim de semana não é culpa do time.
                  (CASE WHEN EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5
                             AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') < 8
                          THEN (created_at AT TIME ZONE 'America/Sao_Paulo')::date + TIME '12:00'
                        WHEN EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 4
                          THEN (created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1 + TIME '12:00'
                        WHEN EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') = 5
                          THEN (created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1 + TIME '10:00'
                        WHEN EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') = 6
                             AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') < 8
                          THEN (created_at AT TIME ZONE 'America/Sao_Paulo')::date + TIME '10:00'
                        WHEN EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') = 6
                          THEN (created_at AT TIME ZONE 'America/Sao_Paulo')::date + 2 + TIME '12:00'
                        ELSE (created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1 + TIME '12:00'
                   END) AT TIME ZONE 'America/Sao_Paulo' AS prazo
             FROM msg WHERE created_at >= NOW() - $2::interval AND created_at < NOW() - $3::interval)
     SELECT COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'in')::int AS conversas_cliente,
            COUNT(*) FILTER (WHERE direction = 'in')::int AS msgs_cliente,
            COUNT(*) FILTER (WHERE direction = 'out')::int AS msgs_loja,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out'))::int AS turnos,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp IS NULL)::int AS turnos_sem_resposta,
            ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY resp) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp IS NOT NULL) / 60)::numeric, 1) AS mediana_resposta_min,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp <= 300)::int AS ate_5min,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp > 3600)::int AS mais_1h,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp IS NOT NULL)::int AS respondidos,
            ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY resp) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp IS NOT NULL AND NOT ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10))) / 60)::numeric, 1) AS mediana_fora_horario_min,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND NOT ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10)))::int AS turnos_fora_horario,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10)))::int AS turnos_horario_comercial,
            ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY resp) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND resp IS NOT NULL AND ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10))) / 60)::numeric, 1) AS mediana_horario_comercial_min,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10)) AND resp <= 300)::int AS ate_5min_horario_comercial,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10)) AND resp > 3600)::int AS mais_1h_horario_comercial,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND NOT ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10)) AND prox_out IS NOT NULL AND prox_out <= prazo)::int AS fora_horario_respondidos_no_prazo,
            COUNT(*) FILTER (WHERE direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out') AND NOT ((hora >= 8 AND hora < 18 AND dow BETWEEN 1 AND 5) OR (dow = 6 AND hora >= 8 AND hora < 10)) AND ((prox_out IS NOT NULL AND prox_out > prazo) OR (prox_out IS NULL AND NOW() > prazo)))::int AS fora_horario_estourou_prazo,
            COUNT(*) FILTER (WHERE direction = 'out' AND em_ant IS NOT NULL AND created_at - em_ant >= INTERVAL '48 hours')::int AS retomadas,
            COUNT(*) FILTER (WHERE direction = 'out' AND em_ant IS NOT NULL AND created_at - em_ant >= INTERVAL '48 hours' AND prox_in IS NOT NULL)::int AS retomadas_responderam
       FROM t`, [clientId, desde, ate])).rows[0];
  const ult30 = await janela('30 days', '0 days');
  const ult7 = await janela('7 days', '0 days');
  const ant7 = await janela('14 days', '7 days');
  const extra = (await pool.query(
    `WITH ${BASE},
     ativos AS (SELECT DISTINCT lead_id FROM base WHERE created_at > NOW() - INTERVAL '30 days'),
     ult AS (SELECT DISTINCT ON (lead_id) lead_id, direction, created_at FROM base ORDER BY lead_id, created_at DESC),
     cap AS (SELECT a.lead_id, BOOL_OR(b.direction = 'in') AS tem_in, BOOL_OR(b.direction = 'out') AS tem_out
               FROM ativos a JOIN base b ON b.lead_id = a.lead_id GROUP BY a.lead_id)
     SELECT (SELECT COUNT(*) FROM cap WHERE tem_in AND NOT tem_out)::int AS conversas_sem_nenhuma_msg_da_loja,
            (SELECT COUNT(*) FROM cap WHERE tem_in)::int AS conversas_com_msg_cliente,
            (SELECT COUNT(*) FROM ult u JOIN ativos a USING (lead_id) WHERE u.direction = 'in' AND u.created_at < NOW() - INTERVAL '48 hours')::int AS paradas_esperando_loja_48h,
            (SELECT ROUND(AVG(EXTRACT(EPOCH FROM NOW() - u.created_at) / 86400)::numeric, 1) FROM ult u JOIN ativos a USING (lead_id) WHERE u.direction = 'in' AND u.created_at < NOW() - INTERVAL '48 hours') AS dias_medios_esperando,
            (SELECT COUNT(*) FROM ult u JOIN ativos a USING (lead_id) WHERE u.direction = 'in' AND u.created_at >= NOW() - INTERVAL '48 hours')::int AS esperando_menos_48h`,
    [clientId])).rows[0];
  const tent = (await pool.query(
    `WITH b AS (SELECT m.lead_id, m.direction, m.created_at FROM public.crm_messages m JOIN public.crm_leads l ON l.id = m.lead_id
                 WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false),
          fo AS (SELECT lead_id, MIN(created_at) AS fo FROM b WHERE direction = 'out' GROUP BY lead_id HAVING MIN(created_at) > NOW() - INTERVAL '30 days'),
          r AS (SELECT fo.lead_id, (SELECT MIN(created_at) FROM b WHERE b.lead_id = fo.lead_id AND direction = 'in' AND created_at > fo.fo) AS resp,
                       EXISTS (SELECT 1 FROM b WHERE b.lead_id = fo.lead_id AND direction = 'in' AND created_at < fo.fo) AS escreveu_antes FROM fo),
          d AS (SELECT r.*, (SELECT COUNT(DISTINCT (created_at AT TIME ZONE 'America/Sao_Paulo')::date) FROM b WHERE b.lead_id = r.lead_id AND direction = 'out' AND (r.resp IS NULL OR created_at < r.resp)) AS dias FROM r)
     SELECT COUNT(*)::int AS tentados, COUNT(*) FILTER (WHERE resp IS NULL)::int AS sem_interacao,
            COUNT(*) FILTER (WHERE resp IS NULL AND NOT escreveu_antes)::int AS nunca_escreveram,
            ROUND(AVG(dias) FILTER (WHERE resp IS NULL)::numeric, 1) AS media_tentativas_sem_interacao FROM d`, [clientId])).rows[0];
  const canais = (await pool.query(
    `SELECT COALESCE(NULLIF(l.canal, ''), 'sem canal') AS canal, COUNT(DISTINCT l.id)::int AS conversas,
            COUNT(DISTINCT l.id) FILTER (WHERE l.fechou)::int AS fecharam
       FROM public.crm_leads l JOIN public.crm_messages m ON m.lead_id = l.id AND m.created_at > NOW() - INTERVAL '30 days'
      WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [clientId])).rows;
  const etapas = (await pool.query(
    `SELECT COALESCE(NULLIF(l.status, ''), 'sem etapa') AS etapa, COUNT(DISTINCT l.id)::int AS leads
       FROM public.crm_leads l JOIN public.crm_messages m ON m.lead_id = l.id AND m.created_at > NOW() - INTERVAL '30 days'
      WHERE l.client_id = $1 AND COALESCE(l.time_interno, false) = false GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [clientId])).rows;
  const autores = (await pool.query(
    `SELECT m.autor_nome, COUNT(*)::int AS msgs FROM public.crm_messages m JOIN public.crm_leads l ON l.id = m.lead_id
      WHERE l.client_id = $1 AND m.direction = 'out' AND m.autor_nome IS NOT NULL AND m.created_at > NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 2 DESC`, [clientId])).rows;
  const hist = (await pool.query(
    `SELECT created_at, nota_geral, classificacao, resultado->'notas_criterios' AS criterios, resultado->'principais_problemas' AS problemas
       FROM public.crm_atendimento_auditorias WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`, [clientId])).rows[0] || null;
  const primeira = (await pool.query(`SELECT MIN(m.created_at) AS desde FROM public.crm_messages m JOIN public.crm_leads l ON l.id = m.lead_id WHERE l.client_id = $1`, [clientId])).rows[0];
  const nome = (await pool.query(`SELECT name FROM public.clients WHERE id = $1`, [clientId])).rows[0]?.name;
  process.stdout.write(JSON.stringify({ clientId, cliente: nome, gerado_em: new Date().toISOString(), historico_no_sistema_desde: primeira.desde,
    ultimos_30_dias: ult30, ultimos_7_dias: ult7, semana_anterior: ant7, captura_e_fila: extra, tentativas_contato_30d: tent,
    canais_30d: canais, etapas_dos_leads_ativos_30d: etapas, autores_registrados_30d: autores, auditoria_anterior: hist }));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
