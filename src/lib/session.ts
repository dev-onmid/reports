import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'onmid_session';

/** 7 dias. Depois disso o usuário loga de novo. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = {
  uid: string;
  role: string;
  team: string;
  /** epoch em segundos */
  exp: number;
};

/**
 * Falha FECHADA de propósito: sem SESSION_SECRET não existe sessão válida, e
 * ninguém entra. A alternativa (um segredo padrão embutido no código) daria a
 * qualquer pessoa que leia o repositório o poder de forjar sessão de admin —
 * exatamente o tipo de fallback silencioso que criou o problema que este
 * arquivo existe pra consertar.
 */
function getSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) return null;
  return s;
}

export function sessionSecretMissing(): boolean {
  return getSecret() === null;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

/** Devolve null se o segredo não estiver configurado. */
export function createSessionToken(input: Omit<SessionPayload, 'exp'>): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload: SessionPayload = { ...input, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verifica assinatura e expiração. Qualquer falha devolve null — nunca um
 * payload parcialmente confiável.
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  const secret = getSecret();
  if (!secret || !token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload?.uid !== 'string' || !payload.uid) return null;
  if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** Lê e valida a sessão de um Request (usa o header Cookie, sem next/headers). */
export function readSession(req: Request): SessionPayload | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    return verifySessionToken(decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return null;
}

export const INTERNAL_HEADER = 'x-onmid-internal';

/**
 * Credencial para chamadas servidor→servidor (a Luna, o cron do CRM e o
 * disparo de relatórios chamam rotas internas por HTTP, sem cookie de usuário).
 *
 * Derivada do SESSION_SECRET em vez de uma env nova de propósito: uma variável
 * a mais seria mais um "esqueci de configurar" que quebraria essas chamadas em
 * silêncio — e elas engolem erro (`if (!r.ok) return null`), então a falha
 * apareceria como resposta vazia, não como erro.
 */
export function internalServiceToken(): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return b64url(createHmac('sha256', secret).update('onmid-internal-service-v1').digest());
}

export function isValidInternalToken(value: string | null | undefined): boolean {
  const expected = internalServiceToken();
  if (!expected || !value) return false;
  const a = Buffer.from(value, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Espalhe no `headers` de um fetch para rota interna. */
export function internalHeaders(): Record<string, string> {
  const t = internalServiceToken();
  return t ? { [INTERNAL_HEADER]: t } : {};
}

function cookieAttrs(maxAge: number): string {
  // Secure só fora de dev: em http://localhost o browser descarta cookie Secure.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(MAX_AGE_SECONDS)}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${cookieAttrs(0)}`;
}
