// Testes da régua de origem e do dedupe da importação de planilha.
//
// Compilar antes (a lib é TS e o Node não lê TS direto):
//   npx tsc src/lib/importacao-origem.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/importacao-origem.js scratchpad/build/importacao-origem.mjs
//   node scratchpad/test-origem.mjs

import assert from 'node:assert';
import { origemIntegravel, normalizarOrigem, resumirOrigens, dedupLote, ORIGENS_INTEGRAVEIS }
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

console.log(`✓ ${n} asserts de origem/dedupe passaram`);
