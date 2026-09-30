// Compilar antes:
//   npx esbuild src/lib/planejamento-canais.ts --format=esm --outfile=scratchpad/build/planejamento-canais.mjs
import {
  normalizarCanais, reequilibrar, ajustarShare, ajustarCpl,
  adicionarCanal, removerCanal, calcularPlanoCanais,
} from './build/planejamento-canais.mjs';

let ok = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { ok++; } else { fail++; console.error(`✗ ${msg}\n   esperado ${B}\n   recebido ${A}`); }
};
const near = (a, b, msg, tol = 0.01) => {
  if (a !== null && b !== null && Math.abs(a - b) <= tol) { ok++; }
  else if (a === b) { ok++; }
  else { fail++; console.error(`✗ ${msg} — esperado ${b}, recebido ${a}`); }
};
const shares = cs => cs.map(c => `${c.id}:${c.share}`);
const soma = cs => cs.reduce((s, c) => s + c.share, 0);

// ── As travas, nas palavras do Matheus ──────────────────────────────────────
// "se eu colocasse 60% num canal, eu só podia por 40% no outro"
{
  const base = [{ id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 50, cpl: 60 }];
  const r = ajustarShare(base, 'meta', 60);
  eq(shares(r), ['meta:60', 'google:40'], '60 num canal deixa 40 no outro');
}
// "se eu colocar 50% ele diminui 10% do canal que tinha 50%"
{
  const base = [{ id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 50, cpl: 60 }];
  const r = ajustarShare(base, 'meta', 60);            // meta sobe 10
  eq(r.find(c => c.id === 'google').share, 40, 'os 10 saem de quem tinha 50');
}
// Descer também devolve
{
  const base = [{ id: 'meta', share: 70, cpl: 20 }, { id: 'google', share: 30, cpl: 60 }];
  eq(shares(ajustarShare(base, 'meta', 40)), ['meta:40', 'google:60'], 'descer devolve aos outros');
}
// Três canais: a diferença sai proporcional ao que cada um tinha
{
  const base = [
    { id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 30, cpl: 60 }, { id: 'tiktok', share: 20, cpl: 15 },
  ];
  const r = ajustarShare(base, 'meta', 70);
  eq(shares(r), ['meta:70', 'google:18', 'tiktok:12'], '3 canais: proporcional (30:20 → 18:12)');
  eq(soma(r), 100, '3 canais: soma segue 100');
}
// Nunca passa de 100 nem cai abaixo de 0
{
  const base = [{ id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 50, cpl: 60 }];
  eq(shares(ajustarShare(base, 'meta', 100)), ['meta:100', 'google:0'], '100 zera o outro');
  eq(shares(ajustarShare(base, 'meta', 140)), ['meta:100', 'google:0'], 'acima de 100 é travado');
  eq(shares(ajustarShare(base, 'meta', -30)), ['meta:0', 'google:100'], 'abaixo de 0 é travado');
  eq(shares(ajustarShare(base, 'meta', NaN)), ['meta:0', 'google:100'], 'NaN vira 0, não quebra a soma');
}
// Canal sozinho leva 100% — não é escolha, é consequência
{
  const base = [{ id: 'meta', share: 100, cpl: 20 }];
  eq(shares(ajustarShare(base, 'meta', 40)), ['meta:100'], 'canal sozinho é sempre 100');
}
// Outros zerados: reparte igual em vez de travar em 0 para sempre
{
  const base = [
    { id: 'meta', share: 100, cpl: 20 }, { id: 'google', share: 0, cpl: 60 }, { id: 'tiktok', share: 0, cpl: 15 },
  ];
  const r = ajustarShare(base, 'meta', 50);
  eq(shares(r), ['meta:50', 'google:25', 'tiktok:25'], 'outros em 0 recebem partes iguais');
}
// ⚠️ Arredondamento não pode deixar a soma em 99 ou 101
{
  const base = [
    { id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 25, cpl: 60 }, { id: 'tiktok', share: 25, cpl: 15 },
  ];
  const r = ajustarShare(base, 'meta', 33);   // 67 para repartir entre dois de 25 = 33,5 cada
  eq(soma(r), 100, 'meio-a-meio de 67 continua somando 100');
  eq(r.every(c => Number.isInteger(c.share)), true, 'as fatias ficam inteiras');
}
{
  // varredura: qualquer ajuste, em qualquer combinação, mantém a soma em 100
  let todasSomam100 = true, todasInteiras = true;
  const combos = [
    [33, 33, 34], [1, 1, 98], [0, 0, 100], [50, 50, 0], [10, 20, 70], [100, 0, 0],
  ];
  for (const [a, b, c] of combos) {
    const base = [
      { id: 'meta', share: a, cpl: 10 }, { id: 'google', share: b, cpl: 10 }, { id: 'tiktok', share: c, cpl: 10 },
    ];
    for (const alvo of [0, 1, 7, 13, 33, 50, 66, 67, 99, 100]) {
      for (const id of ['meta', 'google', 'tiktok']) {
        const r = ajustarShare(base, id, alvo);
        if (soma(r) !== 100) todasSomam100 = false;
        if (!r.every(x => Number.isInteger(x.share))) todasInteiras = false;
        if (r.find(x => x.id === id).share !== alvo) { todasSomam100 = false; }
      }
    }
  }
  eq(todasSomam100, true, 'varredura 180 ajustes: soma sempre 100 e o alvo é respeitado');
  eq(todasInteiras, true, 'varredura 180 ajustes: fatias sempre inteiras');
}

// ── Entrar e sair da divisão ────────────────────────────────────────────────
{
  const um = adicionarCanal([], 'meta', 25);
  eq(shares(um), ['meta:100'], 'primeiro canal nasce com a verba inteira');
  eq(um[0].cpl, 25, 'primeiro canal herda o CPL que já estava planejado');

  const dois = adicionarCanal(um, 'google', 25);
  eq(shares(dois), ['meta:100', 'google:0'], 'segundo canal nasce em 0 e não desmonta a divisão');
  eq(soma(dois), 100, 'acrescentar não quebra a soma');

  eq(adicionarCanal(dois, 'meta', 10).length, 2, 'canal repetido é ignorado');
  eq(adicionarCanal(dois, 'kwai', 10).length, 2, 'canal fora do catálogo é ignorado');
}
{
  const base = [
    { id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 30, cpl: 60 }, { id: 'tiktok', share: 20, cpl: 15 },
  ];
  const r = removerCanal(base, 'google');
  eq(soma(r), 100, 'remover devolve a fatia aos que ficaram');
  eq(shares(r), ['meta:71', 'tiktok:29'], 'remover reparte proporcional (50:20)');
  eq(shares(removerCanal([{ id: 'meta', share: 100, cpl: 20 }], 'meta')), [], 'remover o último esvazia');
  eq(removerCanal(base, 'kwai').length, 3, 'remover inexistente não mexe em nada');
}

// ── Leitura do que está gravado ─────────────────────────────────────────────
eq(normalizarCanais(null), [], 'null vira lista vazia');
eq(normalizarCanais('x'), [], 'lixo vira lista vazia');
eq(shares(normalizarCanais([{ id: 'meta', share: 70, cpl: 20 }, { id: 'google', share: 20, cpl: 60 }])),
   ['meta:78', 'google:22'], 'soma 90 gravada pela versão antiga é reequilibrada para 100');
eq(shares(normalizarCanais([{ id: 'meta', share: 60, cpl: 1 }, { id: 'meta', share: 40, cpl: 2 }])),
   ['meta:100'], 'canal repetido no banco fica uma vez só');
eq(normalizarCanais([{ id: 'meta', share: 100, cpl: -5 }])[0].cpl, 0, 'CPL negativo vira 0');
eq(shares(reequilibrar([{ id: 'meta', share: 0, cpl: 1 }, { id: 'google', share: 0, cpl: 1 }])),
   ['meta:50', 'google:50'], 'tudo zerado vira partes iguais');
eq(ajustarCpl([{ id: 'meta', share: 100, cpl: 20 }], 'meta', -3)[0].cpl, 0, 'ajustarCpl não aceita negativo');

// ── A conta ─────────────────────────────────────────────────────────────────
{
  // Verba 10.000, 70% Meta a R$20 e 30% Google a R$60
  const canais = [{ id: 'meta', share: 70, cpl: 20 }, { id: 'google', share: 30, cpl: 60 }];
  const p = calcularPlanoCanais(canais, 10000, 400, 20, 180000);
  near(p.linhas[0].investimento, 7000, 'Meta leva 70% da verba');
  near(p.linhas[1].investimento, 3000, 'Google leva 30% da verba');
  near(p.investimentoTotal, 10000, '⚠️ a verba total é a âncora: as fatias não a mudam');
  near(p.linhas[0].leads, 350, 'Meta compra 350 leads a R$20');
  near(p.linhas[1].leads, 50, 'Google compra 50 leads a R$60');
  near(p.leadsComprados, 400, 'a verba compra 400 leads');
  // ⚠️ ponderado, não média simples (que daria R$40)
  near(p.cplGeral, 25, 'CPL geral é a média PONDERADA (R$25), não a simples (R$40)');
  near(p.cobertura, 1, 'cobertura 100% quando compra exatamente o que o funil pede');
  eq(p.faltamLeads, 0, 'nada faltando');
  eq(p.sobramLeads, 0, 'nada sobrando');
  near(p.investimentoNecessario, 10000, 'verba necessária bate com a verba planejada');
}
{
  // Mudar as fatias NÃO muda a verba — a regra central do pedido
  const antes = [{ id: 'meta', share: 70, cpl: 20 }, { id: 'google', share: 30, cpl: 60 }];
  const depois = ajustarShare(antes, 'google', 60);
  const a = calcularPlanoCanais(antes, 10000, 400, 20, 0);
  const b = calcularPlanoCanais(depois, 10000, 400, 20, 0);
  near(b.investimentoTotal, a.investimentoTotal, '⚠️ mexer em % não mexe na verba total');
  near(b.investimentoTotal, 10000, 'verba segue 10.000 depois do ajuste');
  // o que muda é quantos leads ela compra
  near(b.leadsComprados, 4000 / 20 + 6000 / 60, 'mais no canal caro compra menos lead');
  eq(b.leadsComprados < a.leadsComprados, true, 'jogar verba no canal caro derruba o volume');
}
{
  // Compra x precisa: verba curta
  const canais = [{ id: 'meta', share: 100, cpl: 50 }];
  const p = calcularPlanoCanais(canais, 5000, 200, 10, 0);
  near(p.leadsComprados, 100, 'compra 100 leads');
  eq(p.faltamLeads, 100, 'faltam 100 para o funil fechar');
  near(p.cobertura, 0.5, 'cobertura 50%');
  near(p.investimentoNecessario, 10000, 'precisaria de R$10.000 no CPL atual');
}
{
  // Compra x precisa: verba sobrando
  const p = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 10 }], 5000, 200, 10, 0);
  near(p.leadsComprados, 500, 'compra 500 leads');
  eq(p.sobramLeads, 300, 'sobram 300 além do que o funil pede');
  eq(p.faltamLeads, 0, 'nada faltando quando sobra');
}
{
  // ⚠️ CPL 0 não é "infinitos leads"
  const p = calcularPlanoCanais(
    [{ id: 'meta', share: 50, cpl: 20 }, { id: 'google', share: 50, cpl: 0 }], 10000, 400, 20, 0);
  eq(p.linhas[1].leads, null, 'canal sem CPL devolve leads null, nunca Infinity');
  eq(p.linhas[1].cac, null, 'canal sem CPL devolve CAC null');
  near(p.leadsComprados, 250, 'só o canal com CPL entra na conta');
  eq(p.semCpl, true, 'o plano avisa que um canal com verba está sem CPL');
  eq(Number.isFinite(p.cplGeral), true, 'CPL geral continua finito');
}
{
  // CAC e % do faturamento
  const p = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 20 }], 10000, 500, 25, 200000);
  near(p.linhas[0].vendas, 25, 'vendas do canal saem da taxa do funil');
  near(p.linhas[0].cac, 400, 'CAC = investimento ÷ vendas');
  near(p.linhas[0].pctFaturamento, 0.05, 'consome 5% do faturamento planejado');
}
{
  const p = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 20 }], 10000, 0, 0, 0);
  eq(p.cobertura, null, 'sem lead necessário a cobertura é null, não 0 nem Infinity');
  eq(p.linhas[0].vendas, 0, 'sem funil não há venda projetada');
  eq(p.linhas[0].cac, null, 'CAC sem venda é null, nunca R$ 0,00');
  eq(p.linhas[0].pctFaturamento, null, '% do faturamento sem meta é null');
}
{
  const p = calcularPlanoCanais([], 10000, 400, 20, 0);
  eq(p.linhas, [], 'sem canal não há linha');
  eq(p.cplGeral, null, 'sem canal não há CPL geral');
  eq(p.semCpl, false, 'sem canal não há aviso de CPL faltando');
  eq(p.faltamLeads, 400, 'sem canal, os leads do funil estão todos descobertos');
}
{
  const p = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 20 }], -500, 400, 20, 0);
  near(p.investimentoTotal, 0, 'verba negativa vira 0');
  eq(p.cplGeral, null, 'verba 0 não compra lead e não gera CPL geral');
}

console.log(`\n${ok} asserts ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
