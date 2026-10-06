// Grava a nota 0–5 do atendimento de cada lead lido hoje. Só escreve as colunas
// nota_atendimento*: etapa, temperatura e valores ficam intocados.
// O trecho é COPIADO do que foi lido (não só os números), para o "print" do
// relatório não mudar se a conversa for editada depois.
// Uso: node - <clientId> <notas.jsonl> <pull.json> [--dry]
const { Pool } = require('pg');
const fs = require('fs');
const txt = (v, max) => Array.from(String(v ?? '').trim()).slice(0, max).join('');
(async () => {
  const [clientId, decFile, pullFile, flag] = process.argv.slice(2);
  if (!/^client-\d+$/.test(clientId || '')) throw new Error('clientId inválido');
  const dry = flag === '--dry';
  const pull = JSON.parse(fs.readFileSync(pullFile, 'utf8'));
  if (pull.clientId !== clientId) throw new Error('arquivo lido é de outro cliente');
  const lidos = new Map(pull.leads.map(l => [l.id, l]));
  const linhas = fs.readFileSync(decFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
  const r = { gravadas: 0, sem_nota: 0, recusadas: [], distribuicao: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  const vistos = new Set();
  for (const [i, s] of linhas.entries()) {
    let d; try { d = JSON.parse(s); } catch { r.recusadas.push(`linha ${i + 1} não é JSON`); continue; }
    const id = String(d.lead || '');
    const lido = lidos.get(id);
    if (!lido) { r.recusadas.push(`${id.slice(0, 8)}: não estava na lista de hoje`); continue; }
    if (vistos.has(id)) { r.recusadas.push(`${id.slice(0, 8)}: repetido`); continue; }
    vistos.add(id);
    let nota = d.nota === null || d.nota === undefined ? null : Number(d.nota);
    if (nota !== null && !(Number.isInteger(nota) && nota >= 0 && nota <= 5)) { r.recusadas.push(`${id.slice(0, 8)}: nota fora de 0..5`); continue; }
    const motivo = txt(d.motivo, 400);
    if (!motivo) { r.recusadas.push(`${id.slice(0, 8)}: sem motivo`); continue; }
    let trecho = null;
    if (nota !== null) {
      const ns = [...new Set((Array.isArray(d.trecho) ? d.trecho : []).map(Number))].filter(Number.isInteger).sort((a, b) => a - b).slice(0, 12);
      trecho = ns.map(n => lido.mensagens.find(m => m.n === n)).filter(Boolean).map(m => ({ d: m.d, em: m.em, t: m.t, autor: m.autor }));
      if (!trecho.length) { r.recusadas.push(`${id.slice(0, 8)}: trecho vazio ou com números inexistentes`); continue; }
    }
    if (!dry) await pool.query(
      `UPDATE public.crm_leads SET nota_atendimento = $1, nota_atendimento_motivo = $2, nota_atendimento_ajuste = $3,
              nota_atendimento_trecho = $4::jsonb, nota_atendimento_em = $5
        WHERE id = $6 AND client_id = $7`,
      [nota, motivo, nota === null ? null : (txt(d.ajuste, 400) || null), trecho ? JSON.stringify(trecho) : null, pull.pulled_at, id, clientId]);
    if (nota === null) r.sem_nota++; else { r.gravadas++; r.distribuicao[nota]++; }
  }
  r.sem_decisao = [...lidos.keys()].filter(k => !vistos.has(k)).length;
  console.log(JSON.stringify({ dry, ...r }, null, 1));
  await pool.end();
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
