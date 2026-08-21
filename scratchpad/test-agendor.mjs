// Testes da normalização Agendor.
// Recompilar antes (ver cabeçalho de test-origem.mjs) — teste roda no build compilado.
import assert from 'node:assert';
import { statusDoNegocio, normalizarNegocio, normalizarPessoa, extrairEventoAgendor }
  from './build/agendor.mjs';
let n = 0; const eq = (a,b,m) => { assert.deepStrictEqual(a,b,m); n++; }; const ok = (c,m) => { assert.ok(c,m); n++; };

// ---- DealEntity REAL da doc (campos do swagger v3)
const deal = {
  id: 8901, title: 'Implante — Maria', value: 3500.5,
  dealStage: { id: 2, name: 'Avaliação Agendada', sequence: 2, funnel: { id: 1, name: 'Funil de vendas' } },
  dealStatus: { id: 1, name: 'Em andamento' },
  person: { id: 77, name: 'Maria Souza', email: 'maria@x.com' },
  organization: { id: 5, name: 'Clínica X' },
  wonAt: null, lostAt: null, createdAt: '2026-08-01T12:00:00Z',
};
{
  const d = normalizarNegocio(deal);
  eq(d.idExterno, '8901', 'id vira string');
  eq(d.valor, 3500.5, 'valor');
  eq(d.etapa, 'Avaliação Agendada', 'etapa pelo nome');
  eq(d.status, 'andamento', 'sem wonAt/lostAt e status Em andamento');
  eq(d.pessoa.id, '77', 'pessoa lean');
  eq(d.organizacao, 'Clínica X', 'organização');
}

// ---- status: a DATA vence o rótulo
eq(statusDoNegocio({ wonAt: '2026-08-10', dealStatus: { name: 'Em andamento' } }), 'ganho', 'wonAt vence rótulo');
eq(statusDoNegocio({ lostAt: '2026-08-10' }), 'perdido', 'lostAt');
eq(statusDoNegocio({ dealStatus: { name: 'Ganho' } }), 'ganho', 'rótulo Ganho');
eq(statusDoNegocio({ dealStatus: { name: 'Perdido' } }), 'perdido', 'rótulo Perdido');
eq(statusDoNegocio({}), 'andamento', 'vazio = andamento');

// ---- PersonEntity com contact (shape real): whatsapp > mobile > work
{
  const p = normalizarPessoa({
    id: 77, name: 'Maria', email: null,
    contact: { email: 'm@x.com', work: '4333334444', mobile: '43988887777', whatsapp: '+55 43 98888-7777' },
    address: { city: 'Londrina', state: 'PR' },
    leadOrigin: { id: 1, name: 'Indicação' },
  });
  eq(p.telefone, '43988887777', 'whatsapp normalizado sem DDI');
  eq(p.telefoneBruto, '+55 43 98888-7777', 'bruto preservado');
  eq(p.email, 'm@x.com', 'email cai pro contact quando raiz vazia');
  eq(p.cidade, 'Londrina', 'cidade'); eq(p.estado, 'PR', 'UF');
  eq(p.origemLead, 'Indicação', 'origem');
}
// sem whatsapp → mobile; sem mobile → work; nada → null
eq(normalizarPessoa({ name: 'A', contact: { mobile: '43911112222' } }).telefone, '43911112222', 'cai pro mobile');
eq(normalizarPessoa({ name: 'A', contact: { work: '4333334444' } }).telefone, '4333334444', 'cai pro fixo');
eq(normalizarPessoa({ name: 'A', contact: {} }).telefone, null, 'sem telefone = null');

// ---- webhook: entidade na RAIZ
{
  const e = extrairEventoAgendor({ event: 'on_deal_stage_updated', ...deal });
  eq(e.tipo, 'negocio', 'raiz é negócio');
  eq(e.evento, 'on_deal_stage_updated', 'evento lido');
  eq(e.negocio.etapa, 'Avaliação Agendada', 'normalizou');
}
// ---- webhook: entidade dentro de wrapper `data`
{
  const e = extrairEventoAgendor({ event: 'on_deal_won', data: { ...deal, wonAt: '2026-08-12', dealStatus: { name: 'Ganho' } } });
  eq(e.tipo, 'negocio', 'wrapper data');
  eq(e.negocio.status, 'ganho', 'ganho dentro do wrapper');
}
// ---- webhook de pessoa
{
  const e = extrairEventoAgendor({ event: 'on_person_created', data: { id: 9, name: 'João', contact: { whatsapp: '43977776666' } } });
  eq(e.tipo, 'pessoa', 'pessoa detectada');
  eq(e.pessoa.telefone, '43977776666', 'telefone da pessoa');
}
// ---- lixo não explode
eq(extrairEventoAgendor(null).tipo, 'desconhecido', 'null');
eq(extrairEventoAgendor('texto').tipo, 'desconhecido', 'string');
eq(extrairEventoAgendor({ foo: 1 }).tipo, 'desconhecido', 'objeto irrelevante');
eq(extrairEventoAgendor({ data: [1,2] }).tipo, 'desconhecido', 'array no wrapper');
// negócio sem id não normaliza (não dá pra deduplicar sem identidade)
eq(extrairEventoAgendor({ dealStage: { name: 'X' }, title: 'sem id' }).tipo, 'desconhecido', 'negócio sem id fora');
// dealStage como STRING solta (defensivo pro shape do webhook)
eq(normalizarNegocio({ id: 1, dealStage: 'Proposta' }).etapa, 'Proposta', 'etapa como string');
// valor com vírgula
eq(normalizarNegocio({ id: 1, value: '3.500,00' }).valor, null, 'valor BR ambíguo não vira número errado');
eq(normalizarNegocio({ id: 1, value: '3500,50' }).valor, 3500.5, 'vírgula decimal simples ok');

console.log(`✓ ${n} asserts do Agendor passaram`);

// ---------------------------------------------------------------- filtros
import { passaFiltros, parseFiltro } from './build/agendor.mjs';
{
  const neg = (funilId, funilNome) => ({ idExterno: '1', funilId, funilNome, pessoa: {} });
  const pes = (origemLeadId, origemLead) => ({ origemLeadId: origemLeadId ?? null, origemLead: origemLead ?? null });
  const sem = { funis: null, origens: null };

  // sem filtro: tudo passa
  ok(passaFiltros(sem, neg('9', 'X'), pes('2', 'Site')).passa, 'sem filtro passa');
  ok(passaFiltros(sem, neg(null, null), null).passa, 'sem filtro e sem dados passa');

  // filtro de funil
  const soFunil1 = { funis: ['1'], origens: null };
  ok(passaFiltros(soFunil1, neg('1', 'Vendas'), null).passa, 'funil na lista passa');
  ok(!passaFiltros(soFunil1, neg('2', 'Pós-venda'), null).passa, 'funil fora barra');
  ok(passaFiltros(soFunil1, neg(null, null), null).passa, 'funil DESCONHECIDO passa (permissivo — perder legítimo é pior)');
  ok(passaFiltros(soFunil1, neg('2', 'Pós-venda'), null).motivo.includes('Pós-venda'), 'motivo cita o funil');

  // filtro de origem
  const soSite = { funis: null, origens: ['5'] };
  ok(passaFiltros(soSite, neg('1', 'V'), pes('5', 'Site')).passa, 'origem na lista passa');
  ok(!passaFiltros(soSite, neg('1', 'V'), pes('7', 'Indicação')).passa, 'origem fora barra');
  ok(!passaFiltros(soSite, neg('1', 'V'), pes(null, null)).passa, 'SEM origem barra quando há filtro (origem específica exclui o resto)');
  ok(!passaFiltros(soSite, neg('1', 'V'), null).passa, 'sem pessoa idem');

  // os dois juntos: precisa passar nos dois
  const ambos = { funis: ['1'], origens: ['5'] };
  ok(passaFiltros(ambos, neg('1', 'V'), pes('5', 'Site')).passa, 'passa nos dois');
  ok(!passaFiltros(ambos, neg('1', 'V'), pes('7', 'Ind')).passa, 'funil ok mas origem fora barra');
}
// parseFiltro: JSONB sujo nunca vira filtro fantasma
eq(parseFiltro(['1', 2, null, '']), ['1', '2'], 'ids viram strings, lixo cai');
eq(parseFiltro([]), null, 'lista vazia = sem filtro');
eq(parseFiltro('nada'), null, 'não-array = sem filtro');
eq(parseFiltro(null), null, 'null = sem filtro');
// funil extraído na normalização
{
  const n = normalizarNegocio({ id: 1, dealStage: { id: 2, name: 'Etapa', funnel: { id: 7, name: 'Funil de vendas' } } });
  eq(n.funilId, '7', 'funilId extraído');
  eq(n.funilNome, 'Funil de vendas', 'funilNome extraído');
}
{
  const p = normalizarPessoa({ name: 'A', leadOrigin: { id: 3, name: 'Site' } });
  eq(p.origemLeadId, '3', 'origemLeadId extraído');
}
console.log(`✓ ${n} asserts (com filtros)`);
