// Testes da classificação de origem (digital / offline / desconhecida).
//
// Compilar antes:
//   npx tsc src/lib/origem-digital.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/origem-digital.js scratchpad/build/origem-digital.mjs
import assert from 'node:assert';
import { classificarOrigem, origemEhDigital } from './build/origem-digital.mjs';
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ── vocabulário REAL das contas conectadas ────────────────────────────────
// Londrigifts / Incorpast
for (const o of ['Google', 'Instagram', 'Email MKT', 'Linkedin'])
  eq(classificarOrigem(o), 'digital', `${o} é digital (Londrigifts)`);
for (const o of ['Indicação', 'Carteira', 'Licitação', 'Prospecção', 'Networking',
                 'Representantes', 'Parceiros Comerciais', 'Resgate - Aquário',
                 'Fachada/Passou em Frente'])
  eq(classificarOrigem(o), 'offline', `${o} é offline (Londrigifts)`);

// Cinfel
for (const o of ['Redes sociais', 'Site/Google', 'Mercado Livre'])
  eq(classificarOrigem(o), 'digital', `${o} é digital (Cinfel)`);
for (const o of ['Fachada', 'Eventos/feiras', 'Indicação de clientes',
                 'Indicação de parceiros', 'Prospecção', 'Cliente da carteira'])
  eq(classificarOrigem(o), 'offline', `${o} é offline (Cinfel)`);

// ── acento, caixa e pontuação não mudam a classe ──────────────────────────
eq(classificarOrigem('INDICAÇÃO'), 'offline', 'caixa alta');
eq(classificarOrigem('indicacao'), 'offline', 'sem acento');
eq(classificarOrigem('  Site / Google  '), 'digital', 'espaços e barra');
eq(classificarOrigem('E-mail MKT'), 'digital', 'hífen no meio');

// ── digital VENCE quando os dois aparecem ─────────────────────────────────
eq(classificarOrigem('Instagram - Indicação'), 'digital',
  'lead que veio do Instagram por indicação ainda é do Instagram');

// ── ⚠️ nunca chuta offline ────────────────────────────────────────────────
eq(classificarOrigem('TikTok'), 'digital', 'marca digital conhecida');
eq(classificarOrigem('Convênio Sindicato'), 'desconhecida',
  'origem que não casa com nenhuma lista NÃO vira offline por eliminação');
eq(classificarOrigem('Outros'), 'desconhecida', '"Outros" não diz nada');
eq(classificarOrigem(''), 'desconhecida', 'vazio');
eq(classificarOrigem(null), 'desconhecida', 'null');
eq(classificarOrigem(undefined), 'desconhecida', 'undefined');

// ── ⚠️ porta de entrada não é origem ──────────────────────────────────────
eq(classificarOrigem('agendor'), 'desconhecida', 'agendor é por onde o dado entrou');
eq(classificarOrigem('datalytics'), 'desconhecida', 'datalytics idem');

// ── termo tem que ser palavra inteira ─────────────────────────────────────
eq(classificarOrigem('Radiologia'), 'desconhecida',
  '"radio" dentro de "Radiologia" não faz virar offline');
eq(classificarOrigem('Rádio'), 'offline', 'mas "Rádio" sozinho é offline');

// ── o atalho booleano ─────────────────────────────────────────────────────
eq(origemEhDigital('Google'), true, 'digital é digital');
eq(origemEhDigital('Indicação'), false, 'offline não é digital');
eq(origemEhDigital('Convênio Sindicato'), false,
  'desconhecida NÃO conta como digital — não inflar o crédito da mídia');

console.log(`✓ ${n} asserts de classificação de origem`);
