// Recompilar antes de rodar:
//   npx esbuild src/lib/lead-tracking.ts --format=esm --platform=node --outfile=scratchpad/build/lead-tracking.mjs
import { generateClickCode, encodeClickCodeInvisible, extractClickCode } from './build/lead-tracking.mjs';

let n = 0, falhas = 0;
const ok = (cond, nome) => { n++; if (!cond) { falhas++; console.log('  ✗', nome); } };

// ── Ida e volta, com o alfabeto inteiro exercitado ──────────────────────────
for (let i = 0; i < 400; i++) {
  const code = generateClickCode();
  const inv = encodeClickCodeInvisible(code);
  ok(inv.length === 30, `30 caracteres para ${code}`);
  ok(extractClickCode(`Olá, vim pelo anúncio!${inv}`) === code, `ida e volta ${code}`);
}

// ── É mesmo invisível ──────────────────────────────────────────────────────
const code = 'A7X2K9'.replace(/[01IL]/g, 'B'); // garante alfabeto válido
const inv = encodeClickCodeInvisible(generateClickCode());
const msg = `Olá, vim pelo anúncio!${inv}`;
ok(msg.replace(/[​‌]/g, '') === 'Olá, vim pelo anúncio!',
   'removendo os invisíveis sobra exatamente o texto do cliente');
ok(!/[a-z0-9]/i.test(inv), 'a sequência não tem nenhum caractere legível');

// ── Casos que a vida manda ─────────────────────────────────────────────────
const c1 = generateClickCode();
ok(extractClickCode(`Quero saber sobre implante 😀🎉${encodeClickCodeInvisible(c1)}`) === c1,
   'mensagem com emoji antes do código');

const c2 = generateClickCode();
ok(extractClickCode(`​‌ oi ${encodeClickCodeInvisible(c2)}`) === c2,
   'sequência de largura zero SOLTA antes não confunde (lê do fim)');

const c3 = generateClickCode();
ok(extractClickCode(`oi​${encodeClickCodeInvisible(c3)}`) === c3,
   'caractere de largura zero GRUDADO antes do código (recorte pelo fim)');

// ── O formato antigo continua sendo lido ───────────────────────────────────
ok(extractClickCode('Olá!\n\nCód: A7X2K9') === 'A7X2K9', 'formato visível legado ainda casa');
ok(extractClickCode('codigo. a7x2k9') === 'A7X2K9', 'legado em minúscula e com ponto');

// ── Nada inventado ─────────────────────────────────────────────────────────
ok(extractClickCode('Oi, tudo bem?') === null, 'mensagem limpa não gera código');
ok(extractClickCode('') === null, 'texto vazio');
ok(extractClickCode(null) === null, 'null');
ok(extractClickCode('​‌​') === null, 'sequência curta demais não vira código');
ok(encodeClickCodeInvisible('OI0L1') === '', 'código fora do alfabeto não produz bits');
ok(encodeClickCodeInvisible('') === '', 'código vazio não produz bits');
ok(encodeClickCodeInvisible('ABC') === '', 'código de tamanho errado não produz bits');

console.log(falhas === 0 ? `\n✅ ${n} asserts OK` : `\n❌ ${falhas} de ${n} falharam`);
process.exit(falhas === 0 ? 0 : 1);
