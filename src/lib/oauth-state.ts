import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `state` assinado para o OAuth do Google (auditoria 2026-10-10).
 *
 * Antes o `state` era só o tipo ("gmb", "google_ads"…): qualquer pessoa podia
 * completar o fluxo e pendurar a PRÓPRIA conta Google nas conexões da agência.
 * Agora o início assina `{tipo, exp}` com o SESSION_SECRET e o callback só
 * aceita o que ele mesmo emitiu, dentro de 15 minutos. Mesmo desenho do state
 * do Instagram Login.
 */
function secret(): string {
  const s = process.env.SESSION_SECRET ?? '';
  if (s.length < 32) throw new Error('SESSION_SECRET ausente');
  return s;
}

export function assinarStateOAuth(tipo: string, agora = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ t: tipo, exp: agora + 15 * 60_000 })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Devolve o tipo, ou null se a assinatura/validade não confere. */
export function verificarStateOAuth(state: string | null | undefined, agora = Date.now()): string | null {
  const [payload, sig] = String(state ?? '').split('.');
  if (!payload || !sig) return null;
  const esperado = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t?: string; exp?: number };
    if (!d.t || typeof d.exp !== 'number' || d.exp < agora) return null;
    return d.t;
  } catch {
    return null;
  }
}

/** Texto seguro para dentro de `<script>`: JSON.stringify não escapa `</script>`. */
export function jsonParaScript(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}
