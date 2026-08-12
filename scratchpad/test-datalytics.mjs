// Testes da extracao tolerante do payload Datalytics (datalytics.ts).
//
// Compilar antes (a lib e TS e importa importacao-origem):
//   npx tsc src/lib/datalytics.ts src/lib/importacao-origem.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   (ajustar o import relativo no build: @/lib/importacao-origem -> ./importacao-origem.js)
//   node scratchpad/test-datalytics.mjs

import assert from 'node:assert';
import { extrairLeadDatalytics, resolverEtapa, parseValor } from './build/datalytics.mjs';
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ------------------------------------------------------------- telefone
{
  const l = extrairLeadDatalytics({ phoneWithDialCode: '+5511912345678', name: 'Ana' });
  eq(l.telefone, '11912345678', 'DDI 55 removido na chave');
  eq(l.telefoneBruto, '+5511912345678', 'bruto preservado');
  eq(l.nome, 'Ana', 'nome');
}
eq(extrairLeadDatalytics({ phone: '11912345678' }).telefone, '11912345678', 'sem DDI passa igual');
eq(extrairLeadDatalytics({ telefone: '(43) 3322-1100' }).telefone, '4333221100', 'fixo 10 digitos com formatacao');
eq(extrairLeadDatalytics({ phone: '9999' }).telefone, null, 'curto demais -> null');
eq(extrairLeadDatalytics({}).telefone, null, 'sem telefone -> null');
eq(extrairLeadDatalytics({ PhoneWithDialCode: '+5543999887766' }).telefone, '43999887766', 'alias case-insensitive');

// ------------------------------------------------------------- etapa
eq(resolverEtapa({ stage: 'Comparecimento' }), { label: 'Comparecimento' }, 'stage por nome');
eq(resolverEtapa({ stageName: 'Agendado' }), { label: 'Agendado' }, 'stageName');
eq(resolverEtapa({ etapa: 'Follow 2' }), { label: 'Follow 2' }, 'etapa pt');
eq(resolverEtapa({ stageId: 'abc123' }), { idOpaco: 'abc123' }, 'so stageId -> opaco');
eq(resolverEtapa({ stage: 'Engajado', stageId: 'abc' }), { label: 'Engajado' }, 'nome vence o id');
eq(resolverEtapa({}), null, 'sem etapa -> null (lead novo)');
eq(resolverEtapa({ stage: '' }), null, 'stage vazio nao vira label');

// ------------------------------------------------------------- wrappers aninhados
{
  const l = extrairLeadDatalytics({ event: 'lead.stage_updated', lead: { phoneWithDialCode: '+5511911112222', stage: 'Agendado', name: 'Bia' } });
  eq(l.telefone, '11911112222', 'telefone dentro de lead{}');
  eq(l.etapa, { label: 'Agendado' }, 'etapa dentro de lead{}');
  eq(l.nome, 'Bia', 'nome dentro de lead{}');
}
{
  const l = extrairLeadDatalytics({ data: { phone: '11933334444', name: 'Interno' }, name: 'Raiz' });
  eq(l.nome, 'Raiz', 'raiz vence o wrapper');
  eq(l.telefone, '11933334444', 'telefone so no wrapper e achado');
}

// ------------------------------------------------------------- valor
eq(parseValor('1.234,56'), 1234.56, 'valor BR');
eq(parseValor('1234.56'), 1234.56, 'valor US');
eq(parseValor(500), 500, 'numero cru');
eq(parseValor('R$ 297'), 297, 'com prefixo de moeda');
eq(parseValor(''), null, 'vazio -> null');
eq(parseValor('abc'), null, 'lixo -> null');
{
  const l = extrairLeadDatalytics({ phone: '11912345678', value: '2.500,00' });
  eq(l.valor, 2500, 'value no payload');
}

// ------------------------------------------------------------- tracking
{
  const l = extrairLeadDatalytics({
    phone: '11912345678', utm_source: 'google', utm_campaign: 'camp1',
    gclid: 'g123', fbclid: 'f456', matchtype: 'e', device: 'm', network: 'g', placement: 'top',
  });
  eq(l.tracking.utm_source, 'google', 'utm_source');
  eq(l.tracking.utm_campaign, 'camp1', 'utm_campaign');
  eq(l.tracking.gclid, 'g123', 'gclid');
  eq(l.tracking.fbclid, 'f456', 'fbclid');
  eq(l.tracking.matchtype, 'e', 'matchtype');
  eq(l.tracking.placement, 'top', 'placement');
}

// ------------------------------------------------------------- diversos
eq(extrairLeadDatalytics({ phone: '11912345678', isQualified: true }).isQualified, true, 'isQualified bool');
eq(extrairLeadDatalytics({ phone: '11912345678', isQualified: 'true' }).isQualified, true, 'isQualified string');
eq(extrairLeadDatalytics({ phone: '11912345678' }).isQualified, null, 'isQualified ausente');
eq(extrairLeadDatalytics({ phone: '11912345678', id: 'L-42' }).idExterno, 'L-42', 'idExterno');
eq(extrairLeadDatalytics({ phone: '11912345678', email: 'a@b.com', city: 'Londrina', state: 'PR', obs: 'nota' }).email, 'a@b.com', 'email');
eq(extrairLeadDatalytics({ phone: '11912345678', name: 'null' }).nome, null, 'string "null" descartada');
eq(extrairLeadDatalytics(null).telefone, null, 'payload null nao explode');
eq(extrairLeadDatalytics('texto').telefone, null, 'payload string nao explode');
eq(extrairLeadDatalytics([1, 2]).telefone, null, 'payload array nao explode');

console.log(`OK — ${n} asserts`);
