// Testes do compilador do resumo do dia (Histórico automático).
// Recompilar antes: npx tsc src/lib/resumo-dia.ts --outDir scratchpad/build --module esnext --target es2022 --moduleResolution bundler --skipLibCheck && mv scratchpad/build/resumo-dia.js scratchpad/build/resumo-dia.mjs
import assert from 'node:assert';
import { compilarResumoDoDia } from './build/resumo-dia.mjs';
let n=0; const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);n++;}; const ok=(c,m)=>{assert.ok(c,m);n++;};

const ev = (plataforma, descricao, autor, campanha) => ({ plataforma, descricao, autor, criadoEm: '2026-08-15T10:00:00', campanha });

// agrupamento: 12 alterações de orçamento iguais viram UMA linha ×12
{
  const eventos = [
    ...Array.from({ length: 12 }, () => ev('meta', 'Orçamento do conjunto atualizado', 'Pedro Alaor')),
    ev('meta', 'Campanha pausada', 'Pedro Alaor', 'Leads Sorrifácil'),
    ev('google', 'alterou campaign', 'gestor@onmid.com'),
  ];
  const r = compilarResumoDoDia(eventos, '15/08');
  eq(r.length, 2, 'dois canais');
  const meta = r.find(x => x.canal === 'meta');
  eq(meta.totalEventos, 13, 'meta soma tudo');
  ok(meta.descricao.includes('×12'), 'agrupa com contador');
  ok(meta.descricao.includes('Pedro Alaor'), 'autor citado');
  ok(meta.descricao.includes('(Leads Sorrifácil)'), 'campanha citada');
  ok(meta.descricao.startsWith('Resumo do dia 15/08 — 13 ação(ões)'), 'cabeçalho');
  eq(meta.autores, ['Pedro Alaor'], 'autores dedupados');
  ok(meta.acoes.includes('orcamento') && meta.acoes.includes('campanha_pausada'), 'chips inferidos');
  const google = r.find(x => x.canal === 'google');
  eq(google.totalEventos, 1, 'google separado');
}
// autores diferentes NÃO se fundem (quem fez importa)
{
  const r = compilarResumoDoDia([
    ev('meta', 'Campanha pausada', 'Ana'),
    ev('meta', 'Campanha pausada', 'Bruno'),
  ], '15/08');
  eq(r[0].descricao.split('\n').length - 1, 2, 'uma linha por autor');
  eq(r[0].autores.sort(), ['Ana', 'Bruno'], 'dois autores');
}
// teto de linhas: 30 tipos distintos → 12 linhas + "e mais 18"
{
  const eventos = Array.from({ length: 30 }, (_, i) => ev('google', `alterou recurso ${i}`, 'g@x.com'));
  const r = compilarResumoDoDia(eventos, '15/08');
  ok(r[0].descricao.includes('… e mais 18 tipo(s)'), 'omitidos declarados');
}
// dia sem eventos → nada (nenhum registro vazio no Histórico)
eq(compilarResumoDoDia([], '15/08'), [], 'vazio não gera resumo');
// inferência de chips não inventa slug
{
  const r = compilarResumoDoDia([ev('meta', 'Coisa exótica sem categoria', 'X')], '15/08');
  eq(r[0].acoes, [], 'sem chip forçado');
}
console.log(`✓ ${n} asserts do resumo-do-dia passaram`);

// ---- diaDoEvento: a Meta manda data em pt-BR (bug real do dry-run)
import { diaDoEvento, ehRuidoFinanceiro } from './build/resumo-dia.mjs';
eq(diaDoEvento('18/08/2026 às 06:31'), '2026-08-18', 'data pt-BR da Meta');
eq(diaDoEvento('2026-08-15 10:22:33'), '2026-08-15', 'Google com espaço');
eq(diaDoEvento('2026-08-15T10:22:33-0300'), '2026-08-15', 'ISO com T');
eq(diaDoEvento('ontem'), null, 'lixo vira null');
ok(ehRuidoFinanceiro('Conta cobrada'), 'cobrança é ruído');
ok(ehRuidoFinanceiro('Quantia adicionada ao saldo'), 'saldo é ruído');
ok(!ehRuidoFinanceiro('Status da campanha atualizado'), 'gestão NÃO é ruído');
ok(!ehRuidoFinanceiro('Orçamento do conjunto atualizado'), 'orçamento NÃO é ruído');
console.log(`✓ ${n} asserts (com data pt-BR e ruído)`);
import { ehEventoDaPlataforma } from './build/resumo-dia.mjs';
ok(ehEventoDaPlataforma('Meta'), 'autor Meta é da plataforma');
ok(ehEventoDaPlataforma('  google '), 'google idem');
ok(!ehEventoDaPlataforma('Pedro Alaor'), 'gestor humano fica');
ok(!ehEventoDaPlataforma('gestor@onmid.com'), 'e-mail de usuário fica');
console.log(`✓ ${n} asserts (final)`);
