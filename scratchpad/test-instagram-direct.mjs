// Testes do state HMAC do OAuth do Instagram Login (instagram-direct.ts).
//
//   npx esbuild src/lib/instagram-direct.ts --bundle --outfile=scratchpad/build/instagram-direct.mjs --format=esm --platform=node --external:pg --log-level=warning
//   SESSION_SECRET=teste-de-32-caracteres-no-minimo!! node scratchpad/test-instagram-direct.mjs

import assert from 'node:assert';
import { stateAssinar, stateVerificar } from './build/instagram-direct.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

const agora = Date.now();

// round-trip
eq(stateVerificar(stateAssinar('client-123', agora), agora), 'client-123', 'round-trip devolve o clientId');
eq(stateVerificar(stateAssinar('client-123', agora), agora + 14 * 60_000), 'client-123', 'valido dentro dos 15 min');

// expirado
eq(stateVerificar(stateAssinar('client-123', agora), agora + 16 * 60_000), null, 'expira em 15 min');

// adulterado: trocar o clientId do payload sem reassinar
{
  const s = stateAssinar('client-123', agora);
  const [, sig] = s.split('.');
  const forjado = Buffer.from(JSON.stringify({ c: 'client-999', exp: agora + 900000 })).toString('base64url');
  eq(stateVerificar(`${forjado}.${sig}`, agora), null, 'payload adulterado nao passa');
}
// assinatura errada
eq(stateVerificar(stateAssinar('client-123', agora).replace(/.$/, m => m === 'A' ? 'B' : 'A'), agora), null,
   'assinatura corrompida nao passa');
// lixo
eq(stateVerificar('', agora), null, 'vazio nao passa');
eq(stateVerificar('a.b.c', agora), null, 'formato errado nao passa');
eq(stateVerificar('naotempontonenhum', agora), null, 'sem separador nao passa');

console.log(`OK — ${n} asserts`);
