// Recompilar: npx esbuild src/lib/lead-aviso.ts --bundle --format=esm --platform=node \
//   --alias:@=./src --external:pg --outfile=scratchpad/build/lead-aviso.mjs
import { fonteDoEvento, parseFontes, formatarTelefone, montarMensagem, FONTES_AVISO } from './build/lead-aviso.mjs';

let n = 0, f = 0;
const ok = (c, nome) => { n++; if (!c) { f++; console.log('  ✗', nome); } };

// ── De onde veio ───────────────────────────────────────────────────────────
ok(fonteDoEvento('leadgen:1013737745011285') === 'meta_forms', 'leadgen: → Meta');
ok(fonteDoEvento('lp:abc:hash') === 'landing_page', 'lp: → landing page');
ok(fonteDoEvento('qualquer-coisa') === null, 'webhook genérico fica de fora');
ok(fonteDoEvento(null) === null, 'null fica de fora');
ok(fonteDoEvento('') === null, 'vazio fica de fora');

// ── Fontes configuradas ────────────────────────────────────────────────────
ok(parseFontes('meta_forms').length === 1, 'uma fonte só');
ok(parseFontes('meta_forms,landing_page').length === 2, 'as duas');
ok(parseFontes('meta_forms,meta_forms').length === 1, 'não duplica');
ok(parseFontes('inventado').length === 2, 'valor inválido vira "todas" em vez de silêncio');
ok(parseFontes('').length === 2, 'vazio vira "todas"');
ok(parseFontes(null).length === 2, 'null vira "todas"');
ok(parseFontes('meta_forms,lixo')[0] === 'meta_forms', 'mantém a boa e descarta a ruim');

// ── Telefone legível ───────────────────────────────────────────────────────
ok(formatarTelefone('5514996358710') === '+55 (14) 99635-8710', 'celular com DDI');
ok(formatarTelefone('554488767197') === '+55 (44) 8876-7197', 'fixo/8 dígitos');
ok(formatarTelefone('14996358710') === '+55 (14) 99635-8710', 'sem DDI');
ok(formatarTelefone('') === null, 'vazio');
ok(formatarTelefone('123') === '123', 'lixo curto volta como veio, não vira null enganoso');

// ── A mensagem ─────────────────────────────────────────────────────────────
const completo = montarMensagem({
  nome: 'Gessica Barbosa', numero: '5514996358710', fonte: 'meta_forms',
  canal: 'Formulário Meta', campanha: '[ON] [FORMS] [MAIO]', anuncio: 'AD4 ANDREIA 2',
  cidade: 'Bauru', uf: 'SP',
});
ok(completo.includes('Gessica Barbosa'), 'nome na mensagem');
ok(completo.includes('+55 (14) 99635-8710'), 'telefone formatado');
ok(completo.includes('Formulário Meta'), 'fonte no título');
ok(completo.includes('[ON] [FORMS] [MAIO]'), 'campanha');
ok(completo.includes('AD4 ANDREIA 2'), 'anúncio');
ok(completo.includes('Bauru · SP'), 'região');
// ⚠️ NENHUMA url na mensagem: o WhatsApp pré-visualiza o primeiro link e a
// miniatura ocupava mais espaço que o lead inteiro. O telefone em formato
// internacional já é tocável — era só isso que o atalho `wa.me` entregava.
ok(!/https?:\/\//.test(completo), 'sem link nenhum — a pré-visualização engolia o aviso');
ok(!completo.includes('wa.me'), 'sem atalho wa.me');
ok(!completo.includes('/crm?'), 'NÃO manda link do nosso CRM (o grupo é do cliente, sem login aqui)');

const semNada = montarMensagem({
  nome: null, numero: null, fonte: 'landing_page',
  canal: null, campanha: null, anuncio: null, cidade: null, uf: null,
});
ok(semNada.includes('Sem nome'), 'lead sem nome não vira linha vazia');
ok(semNada.includes('Landing page'), 'rótulo da landing page');
ok(!/https?:\/\//.test(semNada), 'lead sem telefone também sai sem link');
ok(!semNada.includes('undefined') && !semNada.includes('null'), 'nada de "undefined" no grupo do cliente');

const soCanal = montarMensagem({
  nome: 'João', numero: '5543999998888', fonte: 'landing_page',
  canal: 'LP | CondoStore', campanha: null, anuncio: null, cidade: null, uf: null,
});
ok(soCanal.includes('LP | CondoStore'), 'sem campanha, mostra a origem da LP');

const canalIgual = montarMensagem({
  nome: 'Ana', numero: '5543999998888', fonte: 'meta_forms',
  canal: 'Formulário Meta', campanha: null, anuncio: null, cidade: null, uf: null,
});
ok((canalIgual.match(/Formulário Meta/g) || []).length === 1, 'não repete o rótulo quando canal == fonte');

console.log(f === 0 ? `\n✅ ${n} asserts OK` : `\n❌ ${f} de ${n} falharam`);
process.exit(f === 0 ? 0 : 1);
