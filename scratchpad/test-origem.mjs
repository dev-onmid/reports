// Testes da régua de origem e do dedupe da importação de planilha.
//
// Compilar antes (a lib é TS e o Node não lê TS direto):
//   npx tsc src/lib/importacao-origem.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/importacao-origem.js scratchpad/build/importacao-origem.mjs
//   node scratchpad/test-origem.mjs

import assert from 'node:assert';
import { origemIntegravel, normalizarOrigem, resumirOrigens, dedupLote, ORIGENS_INTEGRAVEIS,
  idExterno, chaveTelefone, sinaisDoStatus }
  from './build/importacao-origem.mjs';
let n=0; const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);n++;}; const ok=(c,m)=>{assert.ok(c,m);n++;};

for (const o of ORIGENS_INTEGRAVEIS) ok(origemIntegravel(o), `"${o}" entra`);

// variacoes reais de digitacao numa planilha
eq(origemIntegravel('WHATSAPP'), true, 'caixa alta');
eq(origemIntegravel('Google meu Negocio'), true, 'sem acento');
eq(origemIntegravel('GOOGLE MEU NEGÓCIO'), true, 'caixa alta com acento');
eq(origemIntegravel('Chatwoot-Whatsapp'), true, 'hifen sem espaco');
eq(origemIntegravel('Chatwoot – Whatsapp'), true, 'travessao');
eq(origemIntegravel('Instagram / Whatsapp'), true, 'barra como separador');
eq(origemIntegravel('  Site  '), true, 'espaco sobrando');

// o que a lista existe pra barrar
for (const o of ['Panfleto','Fachada','Indicação','Indicação de amigo','Rádio','Já era cliente','Outro','']) {
  eq(origemIntegravel(o), false, `"${o}" fica de fora`);
}
eq(origemIntegravel(null), false, 'null fora');
// substring NAO pode passar — e o risco real de uma allowlist mal feita
eq(origemIntegravel('Site do concorrente'), false, 'substring nao passa');
eq(origemIntegravel('Facebook Ads Agencia'), false, 'texto maior nao passa');
eq(origemIntegravel('Indicação Instagram'), false, 'conter "Instagram" nao basta');

// resumo pro relatorio
{
  const r = resumirOrigens(['Whatsapp','Instagram','Panfleto','Panfleto','Indicação','', 'Google']);
  eq(r.aceitas, 3, '3 aceitas: Whatsapp, Instagram e Google');
  eq(r.descartadas, 4, '4 descartadas: 2 Panfleto, Indicação e a vazia');
  eq(r.origens[0], { origem: 'Panfleto', linhas: 2 }, 'a mais frequente primeiro');
  ok(r.origens.some(o => o.origem === '(sem origem)'), 'vazio vira rotulo legivel');
}

// dedupe: fica a ULTIMA (planilha mais recente vence)
{
  const linhas = [
    { id: 'A', etapa: 'Abordagem' },
    { id: 'B', etapa: 'Nova' },
    { id: 'A', etapa: 'Reunião Agendada' },  // export mais novo do MESMO negocio
  ];
  const r = dedupLote(linhas, l => l.id);
  eq(r.unicas.length, 2, '2 negocios unicos');
  eq(r.duplicadas, 1, '1 duplicata contada');
  eq(r.unicas.find(l => l.id === 'A').etapa, 'Reunião Agendada', 'fica a versao MAIS RECENTE, nao a primeira');
}
eq(dedupLote([], () => 'x').unicas, [], 'lote vazio nao quebra');
eq(dedupLote([{id:1},{id:2}], l => String(l.id)).duplicadas, 0, 'sem duplicata');

// ---- grafias REAIS de uma planilha de cliente (Detalhamento de Leads/Faturamento).
// Travadas aqui porque a diferenca e sutil: "WhatsApp" com A maiusculo e
// "Google Meu Negocio" com M maiusculo NAO batem literalmente com a lista — so
// passam por causa da normalizacao. Se alguem mexer nela, isto quebra ANTES de
// silenciosamente descartar faturamento (numa planilha real, as origens fora da
// lista somavam R$ 604 mil de R$ 1,03 mi).
{
  const entram = ['Facebook - WhatsApp', 'Chatwoot - WhatsApp', 'Instagram - WhatsApp',
                  'Facebook', 'Instagram', 'Google', 'WhatsApp', 'Google Meu Neg\u00f3cio', 'Site'];
  for (const o of entram) ok(origemIntegravel(o), `planilha real: "${o}" TEM que entrar`);

  const fora = ['Indica\u00e7\u00e3o', 'Fachada/Passou em Frente', 'TV', 'Outros',
                'Reavalia\u00e7\u00e3o/J\u00e1 sou Paciente', 'Eventos e Parcerias', 'Conv\u00eanio',
                'Outdoor', 'Influenciadores', 'M\u00eddia Impressa'];
  for (const o of fora) eq(origemIntegravel(o), false, `planilha real: "${o}" fica de fora`);
}


// ---- identidade: o "-" que quase destruiu 1.556 leads
{
  // Marcadores de "ainda nao tem" NAO podem virar chave. Numa planilha real,
  // NUMERO ORCAMENTO vinha "-" em 1.556 de 1.853 linhas — agrupar por ele
  // fundiria todos num lead so.
  for (const v of ['-', '--', '', '  ', '0', 'N/A', 'na', 'null', 'NULO']) {
    eq(idExterno(v), null, `"${v}" NAO e id valido`);
  }
  eq(idExterno('2079742'), '2079742', 'numero de orcamento real e id valido');
  eq(idExterno('  2079742  '), '2079742', 'espaco em volta e aparado');
  eq(idExterno(2079742), '2079742', 'numero vira string');

  // Se o "-" passasse, o dedupe colapsaria tudo — este assert prova a protecao.
  const linhas = Array.from({ length: 5 }, (_, i) => ({ orc: '-', fone: `4899999000${i}` }));
  const chaves = linhas.map(l => idExterno(l.orc) ?? `fone:${chaveTelefone(l.fone)}`);
  eq(new Set(chaves).size, 5, '5 leads sem orcamento continuam 5, nao viram 1');
}

// ---- telefone como identidade (planilha x CRM do WhatsApp)
{
  eq(chaveTelefone('(48) 99999-0000'), '48999990000', 'formatado vira digitos');
  eq(chaveTelefone('5548999990000'), '48999990000', 'DDI 55 removido');
  eq(chaveTelefone('48999990000'), '48999990000', 'ja limpo passa igual');
  // o mesmo lead escrito de tres jeitos casa entre planilha e CRM
  const formas = ['(48) 99999-0000', '5548999990000', '48 99999 0000'];
  eq(new Set(formas.map(chaveTelefone)).size, 1, 'mesmo lead escrito de 3 jeitos casa');
  eq(chaveTelefone('123'), null, 'curto demais nao e telefone');
  eq(chaveTelefone(''), null, 'vazio nao e telefone');
  eq(chaveTelefone('-'), null, 'marcador nao e telefone');
}


// ---- traducao de status -> sinais do funil (os 12 valores REAIS da planilha)
// O funil de performance le os booleanos `compareceu`/`fechou`, nao o texto.
// Sem esta traducao, "Avaliacao Agendada" e "Avaliacao Realizada" davam
// Agendamentos=0 e Comparecimentos=0 mesmo com o CRM mostrando tudo certo.
{
  const casos = [
    ['Nao Contactado',      false, false, false],
    ['Avaliação Realizada', true,  true,  false],
    ['Em Atendimento',      false, false, false],
    ['Avaliação Agendada',  true,  false, false],
    ['Avaliação Com Falta', true,  false, false],
    ['Avaliação Efetivada', true,  true,  true ],
    ['Não Atende',          false, false, false],
    ['Sem  Interesse',      false, false, false],
    ['WhatsApp',            false, false, false],
    ['Pessoa Errada',       false, false, false],
    ['Desligado',           false, false, false],
    ['Ligar Depois',        false, false, false],
  ];
  for (const [texto, agendou, compareceu, fechou] of casos) {
    const r = sinaisDoStatus(texto);
    eq(r.agendou, agendou, `"${texto}" agendou`);
    eq(r.compareceu, compareceu, `"${texto}" compareceu`);
    eq(r.fechou, fechou, `"${texto}" fechou`);
  }
  // Coerencia: quem fechou compareceu, quem compareceu agendou.
  for (const [t] of casos) {
    const r = sinaisDoStatus(t);
    ok(!r.fechou || r.compareceu, `${t}: fechou implica compareceu`);
    ok(!r.compareceu || r.agendou, `${t}: compareceu implica agendou`);
  }
  // "Com Falta" agendou mas NAO compareceu — a distincao que o funil precisa.
  const falta = sinaisDoStatus('Avaliação Com Falta');
  ok(falta.agendou && !falta.compareceu, 'faltou: conta agendamento, nao comparecimento');
}

console.log(`✓ ${n} asserts de origem/dedupe passaram`);
