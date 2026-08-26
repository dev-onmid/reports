// Atribuicao de resultado das campanhas (fidelidade-atribuicao.ts).
//
//   npx esbuild src/lib/fidelidade-atribuicao.ts --outfile=scratchpad/build/fidelidade-atribuicao.mjs --format=esm --log-level=warning
//   node scratchpad/test-fidelidade-atribuicao.mjs

import assert from 'node:assert';
import { atribuirResultados } from './build/fidelidade-atribuicao.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const D = (dia, hora = 12) => `2026-08-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:00:00.000Z`;

// ── Janela: recebeu e pediu depois ───────────────────────────────────────────
{
  const r = atribuirResultados(
    [{ campanhaId: 'A', chave: '4399991111', enviadoEm: D(1) }],
    [{ chave: '4399991111', criadoEm: D(3), total: 100 }],
    7,
  );
  eq(r.get('A').pedidos, 1, 'pedido 2 dias depois entra');
  eq(r.get('A').receita, 100, 'receita somada');
  eq(r.get('A').conversao, 1, 'conversao = pedidos/enviadas');
  eq(r.get('A').ticketMedio, 100, 'ticket = receita/pedidos');
}

// ── Fora da janela e ANTES do envio ──────────────────────────────────────────
{
  const r = atribuirResultados(
    [{ campanhaId: 'A', chave: '4399991111', enviadoEm: D(10) }],
    [
      { chave: '4399991111', criadoEm: D(20), total: 100 }, // 10 dias depois
      { chave: '4399991111', criadoEm: D(5), total: 999 },  // ANTES do envio
    ],
    7,
  );
  eq(r.get('A').pedidos, 0, 'nem o pedido tardio nem o anterior contam');
  eq(r.get('A').receita, 0, 'e nenhuma receita e inventada');
  eq(r.get('A').conversao, 0, 'conversao 0 com envio e sem pedido');
  eq(r.get('A').ticketMedio, null, '⚠️ ticket sem pedido e null, nunca R$ 0,00');
}

// ── Cupom é prova: vale fora da janela ───────────────────────────────────────
{
  const r = atribuirResultados(
    [{ campanhaId: 'A', chave: '4399991111', enviadoEm: D(1), cupom: 'VOLTA10' }],
    [{ chave: '4399991111', criadoEm: D(25), total: 200, cupom: 'volta10' }],
    7,
  );
  eq(r.get('A').pedidos, 1, 'pedido com o cupom da campanha conta mesmo 24 dias depois');
  eq(r.get('A').porCupom, 1, 'e fica marcado como atribuido por cupom');
}

// ── ⚠️ Um pedido conta UMA vez, para o envio mais recente ────────────────────
{
  const r = atribuirResultados(
    [
      { campanhaId: 'A', chave: '4399991111', enviadoEm: D(1) },
      { campanhaId: 'B', chave: '4399991111', enviadoEm: D(4) },
    ],
    [{ chave: '4399991111', criadoEm: D(5), total: 100 }],
    7,
  );
  eq(r.get('B').pedidos, 1, 'o envio mais recente leva o credito');
  eq(r.get('A').pedidos, 0, 'a campanha anterior NAO soma o mesmo pedido');
  eq(r.get('A').receita + r.get('B').receita, 100,
    'a soma das campanhas nunca passa do faturamento real');
}

// ── Cupom vence a recência ───────────────────────────────────────────────────
{
  const r = atribuirResultados(
    [
      { campanhaId: 'A', chave: '4399991111', enviadoEm: D(1), cupom: 'VOLTA10' },
      { campanhaId: 'B', chave: '4399991111', enviadoEm: D(4), cupom: 'OUTRO' },
    ],
    [{ chave: '4399991111', criadoEm: D(5), total: 100, cupom: 'VOLTA10' }],
    7,
  );
  eq(r.get('A').pedidos, 1, 'quem deu o cupom usado leva, mesmo sendo o envio mais antigo');
  eq(r.get('B').pedidos, 0, 'a campanha mais recente nao leva');
}

// ── Cancelado nao e receita ──────────────────────────────────────────────────
{
  const r = atribuirResultados(
    [{ campanhaId: 'A', chave: '4399991111', enviadoEm: D(1) }],
    [{ chave: '4399991111', criadoEm: D(2), total: 100, cancelado: true }],
    7,
  );
  eq(r.get('A').pedidos, 0, 'pedido cancelado nao entra');
}

// ── Quem nao recebeu nao gera atribuicao ─────────────────────────────────────
{
  const r = atribuirResultados(
    [{ campanhaId: 'A', chave: '4399991111', enviadoEm: D(1) }],
    [{ chave: '4300000000', criadoEm: D(2), total: 500 }],
    7,
  );
  eq(r.get('A').pedidos, 0, 'pedido de quem nunca recebeu fica de fora');
}

// ── Campanha sem envio nenhum ────────────────────────────────────────────────
{
  const r = atribuirResultados([], [{ chave: 'x', criadoEm: D(2), total: 10 }], 7);
  eq(r.size, 0, 'sem envio nao existe campanha no resultado');
}

// ── Datas lixo nao quebram ───────────────────────────────────────────────────
{
  const r = atribuirResultados(
    [{ campanhaId: 'A', chave: 'x', enviadoEm: 'nao-e-data' }],
    [{ chave: 'x', criadoEm: 'tambem-nao', total: 10 }],
    7,
  );
  eq(r.get('A').pedidos, 0, 'data invalida nao vira atribuicao');
  ok(Number.isFinite(r.get('A').enviadas), 'e a contagem de envios continua sa');
}

console.log(`OK — ${n} asserts`);
