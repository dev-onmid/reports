// Aplica as decisões da rotina no Kanban de UM cliente, com travas. SEM efeitos
// externos: nada de follow-up, nada de evento de conversão — só UPDATE direto.
// Uso: node - <clientId> <decisoes.jsonl> <manifesto.json> [--dry]
const { Pool } = require('pg');
const fs = require('fs');
const MOTIVOS = new Set(['preco', 'produto', 'prazo', 'concorrente', 'sem_retorno', 'adiado', 'nao_era_lead', 'outro']);
const TEMPS = new Set(['frio', 'morno', 'quente']);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ehPerda = l => /perd|perca|sem interesse|desist|cancel|nao fech|descart|desqualific/.test(norm(l));
const ehGanho = l => /fechad|ganh|comprou|vendid|venda|contrato|pago|matricul|cliente ativo/.test(norm(l));
(async () => {
  const [clientId, decFile, manFile, flag] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const dry = flag === '--dry';
  const manifesto = JSON.parse(fs.readFileSync(manFile, 'utf8'));
  const pulledAt = new Date(manifesto.pulled_at);
  const noPull = new Map(manifesto.leads.map(l => [l.id, l]));
  const decisoes = fs.readFileSync(decFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => {
    try { return JSON.parse(s); } catch { return { _erro: `linha ${i + 1} não é JSON` }; }
  });
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  await pool.query(`CREATE TABLE IF NOT EXISTS public.crm_rotina_log (
    id BIGSERIAL PRIMARY KEY, client_id TEXT NOT NULL, lead_id UUID, campo TEXT, de TEXT, para TEXT,
    nota TEXT, resultado TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS crm_rotina_log_cli_idx ON public.crm_rotina_log (client_id, created_at DESC)`);
  const stages = (await pool.query(
    `SELECT s.funnel_id::text AS funnel_id, s.label, s.position FROM public.crm_stages s
       JOIN public.crm_funnels f ON f.id = s.funnel_id WHERE f.client_id = $1`, [clientId])).rows;
  const r = { mudou: 0, sem_mudanca: 0, recusadas: [], marcados: 0 };
  const log = async (lead, campo, de, para, nota, resultado) => {
    if (!dry) await pool.query(`INSERT INTO public.crm_rotina_log (client_id, lead_id, campo, de, para, nota, resultado) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clientId, lead, campo, de == null ? null : String(de), para == null ? null : String(para), nota || null, resultado]);
  };
  const vistos = new Set();
  for (const d of decisoes) {
    if (d._erro) { r.recusadas.push(d._erro); continue; }
    const id = String(d.lead || '');
    if (!noPull.has(id)) { r.recusadas.push(`${id.slice(0, 8)}: não estava na lista de hoje`); continue; }
    if (vistos.has(id)) { r.recusadas.push(`${id.slice(0, 8)}: decisão repetida`); continue; }
    vistos.add(id);
    const { rows: [l] } = await pool.query(
      `SELECT id::text, status, temperatura, valor_negocio, valor_rs, fechou, motivo_perda, funnel_id::text AS funnel_id, updated_at, time_interno
         FROM public.crm_leads WHERE id = $1 AND client_id = $2`, [id, clientId]);
    if (!l || l.time_interno) { r.recusadas.push(`${id.slice(0, 8)}: lead não é deste cliente ou é time interno`); continue; }
    // Alguém mudou etapa/temperatura depois da leitura: a decisão humana vence.
    // ⚠️ Não usar updated_at: toda mensagem nova pelo webhook o atualiza.
    const lido = noPull.get(id);
    if (norm(lido.status) !== norm(l.status) || norm(lido.temperatura) !== norm(l.temperatura)) { r.recusadas.push(`${id.slice(0, 8)}: alterado por alguém depois da leitura`); await log(id, null, null, null, d.nota, 'conflito'); continue; }
    const sets = []; const vals = []; const mud = [];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    let erro = null;
    if (d.status && norm(d.status) !== norm(l.status)) {
      const doFunil = stages.filter(s => !l.funnel_id || s.funnel_id === l.funnel_id);
      const alvo = doFunil.find(s => norm(s.label) === norm(d.status));
      const atual = doFunil.find(s => norm(s.label) === norm(l.status));
      if (!alvo) erro = `etapa "${d.status}" não existe no funil`;
      else if (atual && alvo.position < atual.position && !ehPerda(alvo.label) && !ehPerda(atual.label)) erro = `recuo de "${l.status}" para "${alvo.label}" não é permitido`;
      else if (ehPerda(alvo.label) && !MOTIVOS.has(d.motivo_perda)) erro = `perda sem motivo válido`;
      else if (ehPerda(alvo.label) && d.motivo_perda === 'outro' && !String(d.motivo_perda_detalhe || '').trim()) erro = `motivo "outro" sem detalhe`;
      if (!erro) {
        set('status', alvo.label); mud.push(['status', l.status, alvo.label]);
        if (ehPerda(alvo.label)) {
          set('motivo_perda', d.motivo_perda); set('motivo_perda_detalhe', String(d.motivo_perda_detalhe || '').slice(0, 300) || null);
          sets.push('perdido_em = COALESCE(perdido_em, CURRENT_DATE)');
          mud.push(['motivo_perda', l.motivo_perda, d.motivo_perda]);
        } else if (l.motivo_perda) {
          sets.push('motivo_perda = NULL', 'motivo_perda_detalhe = NULL'); // reativado não carrega o motivo antigo
        }
        if (ehGanho(alvo.label)) { sets.push('fechou = TRUE', 'fechado_em = COALESCE(fechado_em, CURRENT_DATE)'); }
      }
    }
    if (!erro && d.temperatura && TEMPS.has(d.temperatura) && d.temperatura !== l.temperatura) {
      set('temperatura', d.temperatura); sets.push('temperatura_atualizada_em = NOW()'); mud.push(['temperatura', l.temperatura, d.temperatura]);
    }
    if (!erro && d.valor_negocio != null) {
      const v = Number(d.valor_negocio);
      if (Number.isFinite(v) && v > 0 && v < 10_000_000 && Number(l.valor_negocio || 0) !== v) { set('valor_negocio', v); mud.push(['valor_negocio', l.valor_negocio, v]); }
    }
    if (!erro && d.valor_rs != null) {
      const v = Number(d.valor_rs);
      const ganho = ehGanho(sets.length && mud.find(m => m[0] === 'status') ? mud.find(m => m[0] === 'status')[2] : l.status);
      if (!ganho) erro = 'valor de venda só em etapa de ganho';
      else if (Number.isFinite(v) && v > 0 && v < 10_000_000 && Number(l.valor_rs || 0) !== v) { set('valor_rs', v); mud.push(['valor_rs', l.valor_rs, v]); }
    }
    if (erro) { r.recusadas.push(`${id.slice(0, 8)}: ${erro}`); await log(id, null, null, null, `${erro} | ${d.nota || ''}`, 'recusada'); }
    else if (mud.length) {
      sets.push('ia_ultimo_analise = NOW()', 'updated_at = NOW()');
      vals.push(id);
      if (!dry) await pool.query(`UPDATE public.crm_leads SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      for (const [c, de, para] of mud) await log(id, c, de, para, d.nota, 'aplicada');
      r.mudou++;
    } else r.sem_mudanca++;
    // Lido = marcado, mude ou não. Recusado por erro de regra também: amanhã só volta se houver mensagem nova.
    if (!dry) {
      await pool.query(`INSERT INTO public.crm_rotina_analise (lead_id, client_id, analisado_em, ultima_msg_em) VALUES ($1,$2,$3,$4)
        ON CONFLICT (lead_id) DO UPDATE SET analisado_em = EXCLUDED.analisado_em, ultima_msg_em = EXCLUDED.ultima_msg_em`,
        [id, clientId, pulledAt, noPull.get(id).ultima_msg]);
      r.marcados++;
    }
  }
  r.sem_decisao = [...noPull.keys()].filter(k => !vistos.has(k)).length;
  console.log(JSON.stringify({ dry, ...r }, null, 1));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
