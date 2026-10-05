// Valida e grava a auditoria do dia de UM cliente na aba Atendimento.
// Recalcula a nota pela régua (25/30/30/10/5) em vez de confiar no texto, e só
// aceita lead citado que pertença ao cliente. Uma auditoria da rotina por dia.
// Uso: node - <clientId> <auditoria.json> <conversasAnalisadas> <lidas> [--dry]
const { Pool } = require('pg');
const fs = require('fs');
const MAX = { velocidade_sla: 25, qualidade_conversa: 30, conducao_comercial: 30, followup_recuperacao: 10, organizacao_crm: 5 };
const cls = n => n >= 85 ? 'Excelente' : n >= 70 ? 'Bom' : n >= 55 ? 'Atenção' : n >= 40 ? 'Crítico' : 'Grave';
// Corta por caractere (Array.from), nunca no meio de um emoji: meio surrogate derruba o INSERT JSON no Postgres.
const txt = (v, max = 2000) => Array.from(String(v ?? '').trim()).slice(0, max).join('');
const lista = (v, n = 12) => (Array.isArray(v) ? v : []).map(x => txt(x, 600)).filter(Boolean).slice(0, n);
(async () => {
  const [clientId, file, totalArg, lidasArg, flag] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = {};
  let nota = 0;
  for (const [k, max] of Object.entries(MAX)) {
    const v = Math.round(Number(a.notas_criterios?.[k]));
    if (!Number.isFinite(v) || v < 0 || v > max) throw new Error(`critério ${k} fora da régua 0..${max}: ${a.notas_criterios?.[k]}`);
    c[k] = v; nota += v;
  }
  for (const k of ['resumo_semana', 'recomendacao_final']) if (txt(a[k]).length < 40) throw new Error(`${k} vazio ou curto demais`);
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  const valido = async id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) &&
    (await pool.query(`SELECT 1 FROM public.crm_leads WHERE id = $1 AND client_id = $2`, [id, clientId])).rowCount === 1;
  const bons = [], perdidas = [], descartados = [];
  for (const b of (a.bons_exemplos || []).slice(0, 6)) (await valido(b.lead_id)) ? bons.push({ lead_id: b.lead_id, o_que_foi_bem: txt(b.o_que_foi_bem, 600), motivo_referencia: txt(b.motivo_referencia, 400) }) : descartados.push(b.lead_id);
  for (const o of (a.oportunidades_perdidas || []).slice(0, 8)) {
    if (!(await valido(o.lead_id))) { descartados.push(o.lead_id); continue; }
    const canal = (await pool.query(`SELECT canal FROM public.crm_leads WHERE id = $1`, [o.lead_id])).rows[0]?.canal || 'não informado';
    perdidas.push({ lead_id: o.lead_id, canal, o_que_queria: txt(o.o_que_queria, 300), onde_falhou: txt(o.onde_falhou, 600),
      acao_deveria: txt(o.acao_deveria, 400), gravidade: ['alta', 'média', 'baixa'].includes(o.gravidade) ? o.gravidade : 'média' });
  }
  const resultado = {
    nota_geral: nota, classificacao: cls(nota), notas_criterios: c,
    resumo_semana: txt(a.resumo_semana, 3000), principais_problemas: lista(a.principais_problemas, 8),
    plano_acao: Object.fromEntries(['urgentes', 'ajustes_script', 'treinamento_time', 'melhorias_processo', 'ajustes_crm_automacoes'].map(k => [k, lista(a.plano_acao?.[k], 5)])),
    bons_exemplos: bons, oportunidades_perdidas: perdidas,
    analise_fontes: (a.analise_fontes || []).slice(0, 8).map(f => ({ fonte: txt(f.fonte, 80), quantidade_leads: Number(f.quantidade_leads) || 0,
      taxa_avanco: txt(f.taxa_avanco, 200), principais_gargalos: txt(f.principais_gargalos, 300), qualidade_atendimento: txt(f.qualidade_atendimento, 60) })),
    analise_atendentes: (a.analise_atendentes || []).slice(0, 8).map(t => ({ atendente: txt(t.atendente, 80), pontos_fortes: txt(t.pontos_fortes, 300),
      pontos_melhoria: txt(t.pontos_melhoria, 300), qualidade_media: txt(t.qualidade_media, 60), taxa_sem_resposta: txt(t.taxa_sem_resposta, 80) || 'não informado',
      tempo_medio_resposta: txt(t.tempo_medio_resposta, 80) || 'não informado' })),
    recomendacao_final: txt(a.recomendacao_final, 2000),
  };
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const de = new Date(Date.now() - 3 * 3600e3 - 29 * 86400e3).toISOString().slice(0, 10);
  const modelo = `rotina-diaria (Claude Code na VPS — métricas de 30 dias + leitura de ${Number(lidasArg) || 0} conversas da semana)`;
  if (flag !== '--dry') {
    await pool.query(`DELETE FROM public.crm_atendimento_auditorias WHERE client_id = $1 AND modelo_usado LIKE 'rotina-diaria%'
                        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`, [clientId, hoje]);
    await pool.query(`INSERT INTO public.crm_atendimento_auditorias (client_id, period_from, period_to, nota_geral, classificacao, resultado, leads_analisados, modelo_usado)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [clientId, de, hoje, nota, cls(nota), JSON.stringify(resultado), Number(totalArg) || 0, modelo]);
  }
  console.log(JSON.stringify({ dry: flag === '--dry', nota, classificacao: cls(nota), bons: bons.length, perdidas: perdidas.length, ids_descartados: descartados }));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
