import { readFileSync } from 'node:fs';
// Recompile antes de rodar:
//   npx esbuild src/lib/crm-ai-lote.ts --bundle --format=esm --outfile=scratchpad/build/crm-ai-lote.mjs \
//     --alias:@/lib/crm-ai-analysis=$PWD/scratchpad/stub-crm-ai.mjs --external:pg --log-level=error
import { separarCandidatos, analisarBloco, estimarCusto, LEADS_POR_BLOCO } from './build/crm-ai-lote.mjs';
// O stub guarda o estado em globalThis (ver o comentário lá) — é o que faz o
// teste ver as chamadas que o código embutido no bundle realmente fez.
globalThis.__stubIa ??= { chamadas: [], emVoo: 0, comportamento: null };
const chamadas = globalThis.__stubIa.chamadas;
const definirComportamento = fn => { globalThis.__stubIa.comportamento = fn; };

let ok = 0, fail = 0;
const t = (nome, cond) => { if (cond) { ok++; } else { fail++; console.error('✗', nome); } };

// ── pool falso: devolve as linhas que o teste montou e guarda a query ───────
function poolFalso(linhas) {
  const q = [];
  return {
    queries: q,
    async query(sql, params) { q.push({ sql, params }); return { rows: linhas }; },
  };
}
const lead = (id, { interno = false, conversa = true, velha = true } = {}) =>
  ({ id, time_interno: interno, tem_conversa: conversa, analise_velha: velha });

// ── separarCandidatos ───────────────────────────────────────────────────────
{
  const p = poolFalso([
    lead('a'), lead('b'),
    lead('c', { interno: true }),
    lead('d', { conversa: false }),
    lead('e', { velha: false }),
  ]);
  const r = await separarCandidatos(p, 'cli-1', ['a','b','c','d','e']);
  t('só a e b são candidatos', JSON.stringify(r.candidatos) === JSON.stringify(['a','b']));
  t('time interno contado e fora', r.timeInterno === 1);
  t('sem conversa contado e fora', r.semConversa === 1);
  t('já analisado contado e fora', r.jaAnalisados === 1);
  t('client_id vai na query (não só os ids)', p.queries[0].params[0] === 'cli-1');
  t('ids vão como array', Array.isArray(p.queries[0].params[1]));
}
{
  const p = poolFalso([lead('e', { velha: false })]);
  const r = await separarCandidatos(p, 'cli-1', ['e'], true);
  t('incluirJaAnalisados traz o já analisado', r.candidatos.length === 1 && r.jaAnalisados === 0);
}
{
  const p = poolFalso([lead('a')]);
  await separarCandidatos(p, 'cli-1', ['a','a','a','']);
  t('ids repetidos e vazios são deduplicados antes da query', p.queries[0].params[1].length === 1);
}
{
  const p = poolFalso([]);
  const r = await separarCandidatos(p, 'cli-1', []);
  t('lista vazia não consulta o banco', p.queries.length === 0 && r.candidatos.length === 0);
}

// ── analisarBloco: a trava que protege o cliente ────────────────────────────
{
  chamadas.length = 0;
  definirComportamento(() => ({ analisou: true, moveuStatus: true, moveuTemperatura: true }));
  const r = await analisarBloco(poolFalso([]), ['a','b','c']);
  t('analisou os 3', r.analisados === 3);
  t('contou status movido', r.moveuStatus === 3);
  t('contou temperatura movida', r.moveuTemperatura === 3);
  t('⚠️ TODA análise do lote pede semEfeitosExternos',
    chamadas.length === 3 && chamadas.every(c => c.opcoes.semEfeitosExternos === true));
  t('⚠️ TODA análise do lote força mesmo com a IA desligada',
    chamadas.every(c => c.opcoes.forcarMesmoDesligada === true));
}
{
  chamadas.length = 0;
  definirComportamento(id => id === 'b'
    ? { analisou: false, motivo: 'erro', moveuStatus: false, moveuTemperatura: false }
    : { analisou: true, moveuStatus: false, moveuTemperatura: false });
  const r = await analisarBloco(poolFalso([]), ['a','b','c']);
  t('erro em um lead não derruba o bloco', r.analisados === 2 && r.erros === 1);
}
{
  chamadas.length = 0;
  definirComportamento(() => ({ analisou: false, motivo: 'sem_mensagem', moveuStatus: false, moveuTemperatura: false }));
  const r = await analisarBloco(poolFalso([]), ['a']);
  t('pulado entra com o motivo, sem contar como erro',
    r.erros === 0 && r.pulados.length === 1 && r.pulados[0].motivo === 'sem_mensagem');
}
{
  chamadas.length = 0;
  definirComportamento(() => ({ analisou: true, moveuStatus: false, moveuTemperatura: false }));
  await analisarBloco(poolFalso([]), ['a','b','c','d','e','f']);
  const maxParalelo = Math.max(...chamadas.map(c => c.emParalelo)) + 1;
  t('concorrência limitada a 3 (pool é max:1)', maxParalelo <= 3);
  t('nenhum lead analisado duas vezes', new Set(chamadas.map(c => c.leadId)).size === 6);
}
{
  const r = await analisarBloco(poolFalso([]), []);
  t('bloco vazio não quebra', r.analisados === 0);
}

// ── custo ───────────────────────────────────────────────────────────────────
t('custo de 0 lead é 0', estimarCusto(0).brl === 0);
t('custo cresce com o volume', estimarCusto(100).brl > estimarCusto(10).brl);
t('100 conversas custam menos de R$2', estimarCusto(100).brl < 2);
t('negativo não vira crédito', estimarCusto(-5).brl === 0);
t('bloco é pequeno o bastante para a barra andar', LEADS_POR_BLOCO > 0 && LEADS_POR_BLOCO <= 50);

// ── guarda de escopo: o lote é CLIENTE + PERÍODO, nunca o recorte da tela ──
// Não é teste de lógica (os dois filtros são inline no componente, que não
// monta fora do runtime do Next): é guarda contra a regressão tentadora de
// reusar `filtered`, que também aplica busca, status, temperatura e colunas.
{
  const src = readFileSync(new URL('../src/app/(dashboard)/crm/page.tsx', import.meta.url), 'utf8');

  t('o modal recebe o recorte de período, não `filtered`',
    src.includes('leadIds={leadsDoPeriodo.map(l => l.id)}') &&
    !src.includes('leadIds={filtered.map(l => l.id)}'));

  const corpo = src.slice(src.indexOf('const leadsDoPeriodo'), src.indexOf('const totalPages'));
  t('⚠️ o recorte do lote só olha mês e intervalo de datas',
    corpo.includes('monthFilter') && corpo.includes('isDateInRange') &&
    !corpo.includes('search') && !corpo.includes('statusFilter') &&
    !corpo.includes('temperatureFilter') && !corpo.includes('columnFilters'));

  t('as dependências do recorte são só leads + datas',
    /\}\), \[leads, monthFilter, dateFromFilter, dateToFilter\]\)/.test(corpo));
}

console.log(`\n${ok} asserts OK${fail ? `, ${fail} FALHARAM` : ''}`);
process.exit(fail ? 1 : 0);
