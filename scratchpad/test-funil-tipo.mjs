// Testes da separação VENDA × LEAD × HÍBRIDO em contarFunil.
//
// Recompilar antes:
//   npx tsc src/lib/funil-etapas.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/funil-etapas.js scratchpad/build/funil-etapas.mjs
//   node scratchpad/test-funil-tipo.mjs

import assert from 'node:assert';
import { contarFunil } from './build/funil-etapas.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const lead = (over = {}) => ({
  status: over.status ?? 'Fechado',
  funnelId: null,
  compareceu: over.compareceu ?? false,
  fechou: over.fechou ?? false,
  agendou: over.agendou ?? false,
  dataAgendada: over.dataAgendada ?? null,
  receita: over.receita ?? 0,
  tipo: over.tipo, // undefined = default hibrido
});

// ── 1. HÍBRIDO (default, comportamento antigo) ────────────────────────────────
// Sem `tipo`: lead fechado conta no funil E soma receita — como sempre foi.
{
  const c = contarFunil([lead({ fechou: true, receita: 1000 })], []);
  eq(c.contatos, 1, 'hibrido: conta contato');
  eq(c.fechamentos, 1, 'hibrido: conta fechamento');
  eq(c.receita, 1000, 'hibrido: soma receita');
}
// tipo explícito 'hibrido' = idêntico a undefined.
{
  const c = contarFunil([lead({ fechou: true, receita: 500, tipo: 'hibrido' })], []);
  eq(c.receita, 500, 'hibrido explícito soma receita');
  eq(c.contatos, 1, 'hibrido explícito conta contato');
}

// ── 2. LEAD (só funil; R$ NÃO é faturamento) ──────────────────────────────────
{
  const c = contarFunil([lead({ fechou: true, receita: 999, tipo: 'lead' })], []);
  eq(c.contatos, 1, 'lead: conta no funil');
  eq(c.fechamentos, 1, 'lead: conta fechamento no funil');
  eq(c.receita, 0, 'lead: R$ FECHADO NÃO vira faturamento (sem duplo-count)');
}

// ── 3. VENDA (só receita; NÃO é contato do funil) ─────────────────────────────
{
  const c = contarFunil([lead({ fechou: true, receita: 2500, tipo: 'venda' })], []);
  eq(c.contatos, 0, 'venda: NÃO conta como contato');
  eq(c.fechamentos, 0, 'venda: NÃO conta no funil');
  eq(c.receita, 2500, 'venda: entra só como receita');
}

// ── 4. Cenário do Matheus: Leads (funil) + Vendas (faturamento) juntos ────────
// Antes: R$ FECHADO(585) + VALOR FATURADO(1593) = 2178 (duplo). Agora só o
// faturamento do ledger de Vendas conta; o funil vem dos Leads.
{
  const leads = [
    // 3 leads do relatório de Leads (2 fechados com R$ que NÃO deve virar faturamento)
    lead({ tipo: 'lead', status: 'Avaliação Agendada', agendou: true }),
    lead({ tipo: 'lead', status: 'Avaliação Efetivada', fechou: true, receita: 300 }),
    lead({ tipo: 'lead', status: 'Avaliação Efetivada', fechou: true, receita: 285 }),
    // 2 linhas do relatório de Vendas (faturamento real, parcelas com valores diferentes)
    lead({ tipo: 'venda', fechou: true, receita: 1000 }),
    lead({ tipo: 'venda', fechou: true, receita: 593 }),
  ];
  const c = contarFunil(leads, []);
  eq(c.contatos, 3, 'misto: só os 3 leads contam no topo (vendas não são contatos)');
  eq(c.fechamentos, 2, 'misto: 2 fechamentos no funil (dos leads)');
  eq(c.receita, 1593, 'misto: faturamento = só o ledger de Vendas, sem o R$ dos leads (não duplica)');
}

console.log(`OK — ${n} asserts (separação venda/lead/híbrido)`);
