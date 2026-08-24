// Testes da régua de identidade e da política de mesclagem (lead-identity.ts).
//
// Compilar antes:
//   npx tsc src/lib/lead-identity.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/lead-identity.js scratchpad/build/lead-identity.mjs
//   node scratchpad/test-lead-identity.mjs
import assert from 'node:assert';
import { chavesTelefone, chaveEmail, setPreencheVazio, setEstado,
  CAMPOS_SOBERANOS, CAMPOS_ESTADO, CAMPOS_MONOTONICOS, CAMPOS_IDENTIDADE }
  from './build/lead-identity.mjs';
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── telefone: o MESMO número escrito de formas diferentes casa ──────────────
{
  // BR com e sem DDI produzem a mesma chave forte.
  eq(chavesTelefone('5543999646860')[0], '43999646860', 'DDI 55 sai da chave BR');
  eq(chavesTelefone('43999646860')[0], '43999646860', 'sem DDI já é a chave BR');
  eq(chavesTelefone('+55 (43) 99964-6860')[0], '43999646860', 'formatação não muda a chave');
  ok(chavesTelefone('5543999646860').includes('5543999646860'), 'o cru também vira chave');

  // Fixo de 10 dígitos.
  eq(chavesTelefone('4333334444')[0], '4333334444', 'fixo de 10 dígitos vale');

  // ⚠️ O caso que a régua antiga PERDIA: número estrangeiro voltava null e cada
  // mensagem virava um lead novo.
  const pt = chavesTelefone('+351912345678');
  ok(pt.length > 0, 'número de Portugal produz chave');
  eq(chavesTelefone('+351912345678'), chavesTelefone('351912345678'), 'com e sem "+" é o mesmo');
  const uk = chavesTelefone('+442071838750');
  ok(uk.length > 0, 'número do Reino Unido produz chave');
  ok(!uk.includes('2071838750'), 'não corta DDI que não é 55');

  // Lixo não vira chave.
  eq(chavesTelefone(''), [], 'vazio não produz chave');
  eq(chavesTelefone('-'), [], 'placeholder não produz chave');
  eq(chavesTelefone(null), [], 'null não produz chave');
  eq(chavesTelefone('123'), ['123'], 'curto demais não vira chave BR, mas casa consigo mesmo');

  // Dois números diferentes nunca compartilham chave.
  const a = chavesTelefone('5543999646860'), b = chavesTelefone('5543999646861');
  ok(!a.some(x => b.includes(x)), 'números distintos não colidem');
}

// ── e-mail: chave fraca, validada ──────────────────────────────────────────
{
  eq(chaveEmail(' Joao@Exemplo.COM '), 'joao@exemplo.com', 'normaliza caixa e espaço');
  eq(chaveEmail('sem-arroba'), null, 'texto sem @ não é e-mail');
  eq(chaveEmail('a@b'), null, 'sem domínio com ponto não é e-mail');
  eq(chaveEmail(''), null, 'vazio');
  eq(chaveEmail(null), null, 'null');
  eq(chaveEmail('-'), null, 'placeholder');
}

// ── política: as classes não se sobrepõem ──────────────────────────────────
{
  const todos = [...CAMPOS_SOBERANOS, ...CAMPOS_ESTADO, ...CAMPOS_MONOTONICOS, ...CAMPOS_IDENTIDADE];
  eq(new Set(todos).size, todos.length, 'nenhum campo em duas classes — senão a regra dele seria ambígua');

  // Os campos que ligam a venda ao anúncio TÊM que ser soberanos.
  for (const c of ['ctwa_clid', 'source_id', 'campaign_name', 'ad_name', 'origin', 'canal', 'gclid', 'fbclid']) {
    ok(CAMPOS_SOBERANOS.includes(c), `${c} é soberano (rastreio nunca é sobrescrito)`);
  }
  // E os que a planilha tem direito de atualizar TÊM que ser estado.
  for (const c of ['status', 'valor_rs', 'revenue', 'data_agendada']) {
    ok(CAMPOS_ESTADO.includes(c), `${c} é estado (a fonte mais nova manda)`);
  }
  // Booleanos do funil ficam fora da régua de recência.
  for (const c of ['agendou', 'compareceu', 'fechou']) {
    ok(CAMPOS_MONOTONICOS.includes(c), `${c} só avança`);
    ok(!CAMPOS_ESTADO.includes(c), `${c} NÃO entra na régua de recência`);
  }
}

// ── geradores de SQL ───────────────────────────────────────────────────────
{
  eq(setPreencheVazio('canal', '$5'), "canal = COALESCE(NULLIF(canal, ''), $5)",
    'soberano só preenche vazio');

  const sql = setEstado('status', '$2', '$9::date');
  ok(sql.includes('CASE WHEN'), 'estado é condicional');
  ok(sql.includes('updated_at_external IS NULL'), 'fonte sem data sempre pode escrever');
  ok(sql.includes('$9::date >= public.crm_leads.updated_at_external'), 'só escreve se for mais novo');
  ok(sql.includes('ELSE public.crm_leads.status END'), 'senão mantém o que está gravado');
}

console.log(`✓ ${n} asserts de identidade/mesclagem passaram`);
