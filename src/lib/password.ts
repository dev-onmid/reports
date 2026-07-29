import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// Custo do scrypt: 128 * N * r bytes de memória = 16 MB por verificação.
// Fica abaixo do maxmem padrão do Node (32 MB) e leva ~60-100ms — caro o
// suficiente pra tornar força bruta inviável, barato pra um login interativo.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const PREFIX = 'scrypt';

/**
 * Formato auto-descritivo: scrypt$N$r$p$salt_b64$hash_b64
 *
 * Os parâmetros vão junto do hash porque eles mudam com o tempo (hardware fica
 * mais rápido). Sem isso, aumentar o custo depois invalidaria todas as senhas
 * já gravadas — com isso, hashes antigos continuam verificáveis com os
 * parâmetros deles e são regravados no próximo login.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(plain, salt, KEYLEN, PARAMS);
  return [PREFIX, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function isHashed(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);
}

export type VerifyResult = {
  ok: boolean;
  /**
   * true quando a senha confere mas está gravada em formato legado (texto puro)
   * ou com parâmetros desatualizados. O caller deve regravar o hash.
   */
  needsRehash: boolean;
};

/** Compara dois textos em tempo constante, sem vazar o tamanho pelo early-return. */
function safeEqualStr(a: string, b: string): boolean {
  // timingSafeEqual exige tamanhos iguais; comparar o comprimento antes vazaria
  // essa informação. Hashear os dois lados normaliza pra 32 bytes fixos.
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verifica a senha contra o valor gravado, aceitando os DOIS formatos.
 *
 * Migração transparente: contas legadas guardam a senha em texto puro. Elas
 * continuam logando normalmente, e o caller usa `needsRehash` pra converter no
 * ato. Enquanto o usuário não logar, a senha dele segue em texto puro no banco
 * — essa é a contrapartida conhecida dessa estratégia.
 */
export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<VerifyResult> {
  if (typeof stored !== 'string' || stored.length === 0) return { ok: false, needsRehash: false };

  if (!isHashed(stored)) {
    // Legado: texto puro no banco.
    return { ok: safeEqualStr(plain, stored), needsRehash: true };
  }

  const parts = stored.split('$');
  if (parts.length !== 6) return { ok: false, needsRehash: false };
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return { ok: false, needsRehash: false };
  }

  let salt: Buffer, expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return { ok: false, needsRehash: false };
  }
  if (expected.length !== KEYLEN) return { ok: false, needsRehash: false };

  let actual: Buffer;
  try {
    actual = await scryptAsync(plain, salt, KEYLEN, { N, r, p });
  } catch {
    // Parâmetros gravados fora do que o Node aceita (ex: maxmem estourado).
    return { ok: false, needsRehash: false };
  }

  const ok = timingSafeEqual(actual, expected);
  const outdated = N !== PARAMS.N || r !== PARAMS.r || p !== PARAMS.p;
  return { ok, needsRehash: ok && outdated };
}
