// Recompilar antes: npx esbuild src/lib/lp-notificacao.ts src/lib/lp-origens.ts \
//   --bundle --format=esm --platform=node --packages=external --alias:@=./src --outdir=scratchpad/build
import { montarAvisoLead, notificarLeadPorEmail } from './build/lp-notificacao.js';
import { normalizarEmailsNotificacao } from './build/lp-origens.js';

let n = 0, falhas = 0;
const ok = (cond, msg) => { n++; if (!cond) { falhas++; console.error('  ✗', msg); } };

// --- normalização de destinatários ---
ok(JSON.stringify(normalizarEmailsNotificacao('loja.romanza@gmail.com')) === '["loja.romanza@gmail.com"]',
  'e-mail único');
ok(normalizarEmailsNotificacao('a@x.com, b@y.com; c@z.com\nd@w.com').length === 4,
  'aceita vírgula, ponto e vírgula e quebra de linha');
ok(normalizarEmailsNotificacao(['a@x.com', 'A@X.COM']).length === 1,
  'dedupe caixa-insensível');
ok(normalizarEmailsNotificacao('sem-arroba, b@y.com').join() === 'b@y.com',
  'descarta inválido sem derrubar o resto');
ok(normalizarEmailsNotificacao('a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com').length === 5,
  'cap de 5 destinatários');
ok(normalizarEmailsNotificacao('').length === 0 && normalizarEmailsNotificacao(null).length === 0,
  'vazio e null viram lista vazia');
ok(normalizarEmailsNotificacao('  espaco@x.com  ')[0] === 'espaco@x.com', 'apara espaços');

// --- corpo do aviso ---
const base = {
  leadId: 'lead-1', clientId: 'client-1778639756911', site: 'LP Revenda',
  criado: true, nome: 'Maria Silva', telefone: '(43) 99999-1234',
  email: 'maria@ex.com', cidade: 'Londrina', estado: 'PR',
  campanha: '[ON] LEADS', anuncio: 'Criativo 3', origemAnuncio: 'google',
  baseUrl: 'https://reports.onmid.app',
};
const m = montarAvisoLead(base);
ok(m.subject === 'Novo lead: Maria Silva — LP Revenda', 'assunto de lead novo nomeia a pessoa e o site');
ok(montarAvisoLead({ ...base, criado: false }).subject.startsWith('Lead voltou'),
  'lead recorrente tem assunto próprio');
ok(m.html.includes('https://wa.me/5543999991234'), 'monta o wa.me com DDI');
// ⚠️ dentro de href o & vira &amp; — é a forma CORRETA em HTML (o navegador
// desescapa ao navegar). Conferir a forma crua aqui daria falso negativo.
ok(m.html.includes('/crm?clientId=client-1778639756911&amp;lead=lead-1'), 'link do CRM aponta o lead');
ok(m.text.includes('/crm?clientId=client-1778639756911&lead=lead-1'), 'na versão texto o link vai cru');
ok(m.html.includes('[ON] LEADS') && m.html.includes('Criativo 3'), 'campanha e anúncio no corpo');
ok(m.text.includes('Telefone: (43) 99999-1234'), 'versão texto tem os dados');

// ⚠️ o conteúdo vem de formulário PÚBLICO: nada de HTML do visitante no corpo
const mal = montarAvisoLead({ ...base, nome: '<script>alert(1)</script>', cidade: 'a"b' });
ok(!mal.html.includes('<script>'), 'nome com script é escapado');
ok(mal.html.includes('&lt;script&gt;'), 'escape preserva o texto legível');
ok(!mal.subject.includes('&lt;'), 'assunto é texto puro, não escapa');

// campo vazio não vira linha vazia
const magro = montarAvisoLead({ leadId: 'l', clientId: 'c', site: 'Site', criado: true,
  telefone: '5543999991234', baseUrl: 'https://x' });
ok(!magro.html.includes('>Nome<') && !magro.html.includes('>Campanha<'),
  'campo ausente não aparece no corpo');
ok(magro.html.includes('https://wa.me/5543999991234'), 'telefone já com DDI não ganha 55 duplicado');
ok(montarAvisoLead({ leadId: 'l', clientId: 'c', site: 'S', criado: true, email: 'x@y.com',
  baseUrl: 'https://x' }).html.includes('Ver no CRM'), 'lead só com e-mail ainda tem botão do CRM');
ok(!montarAvisoLead({ leadId: 'l', clientId: 'c', site: 'S', criado: true, email: 'x@y.com',
  baseUrl: 'https://x' }).html.includes('wa.me'), 'sem telefone não inventa WhatsApp');

// --- envio: lista vazia não busca conta nem envia ---
let consultou = false;
const poolFake = { query: async () => { consultou = true; return { rows: [] }; } };
const r0 = await notificarLeadPorEmail(poolFake, [], base);
ok(r0.enviados === 0 && !consultou, 'sem destinatário não consulta o banco');

// sem Gmail conectado: conta como falha, não lança
const r1 = await notificarLeadPorEmail(poolFake, ['a@x.com'], base);
ok(r1.enviados === 0 && r1.falhas === 1, 'sem conta Gmail devolve falha sem lançar');

console.log(falhas ? `\n${falhas} de ${n} falharam` : `\n${n} asserts OK`);
process.exit(falhas ? 1 : 0);
