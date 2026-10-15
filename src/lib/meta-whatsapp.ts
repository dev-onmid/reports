import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { cifrar, decifrar } from '@/lib/vault-crypto';

// WhatsApp oficial (Meta Cloud API). Só LEITURA: o reports recebe o que o
// número do cliente recebe, pelo webhook da Meta. Nada é enviado por aqui.

const GRAPH = 'https://graph.facebook.com/v21.0';

export type NumeroMeta = {
  ok: boolean;
  verifiedName: string | null;
  displayPhone: string | null;
  qualityRating: string | null;
  error: string | null;
};

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number } };

async function graphGet<T>(path: string, token: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({})) as T & GraphError;
    if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Confere token + phone_number_id lendo o próprio número na Graph API. */
export async function verificarNumeroMeta(phoneNumberId: string, token: string): Promise<NumeroMeta> {
  const r = await graphGet<{ verified_name?: string; display_phone_number?: string; quality_rating?: string }>(
    `${encodeURIComponent(phoneNumberId)}?fields=verified_name,display_phone_number,quality_rating`, token,
  );
  if (!r.ok) return { ok: false, verifiedName: null, displayPhone: null, qualityRating: null, error: r.error };
  return {
    ok: true,
    verifiedName: r.data.verified_name ?? null,
    displayPhone: r.data.display_phone_number ?? null,
    qualityRating: r.data.quality_rating ?? null,
    error: null,
  };
}

/**
 * Inscreve o app dono do token nos webhooks do WABA do cliente. Um WABA aceita
 * vários apps inscritos — o que o cliente já usa continua recebendo.
 */
export async function inscreverAppNoWaba(wabaId: string, token: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({})) as { success?: boolean } & GraphError;
    if (!res.ok || json.success !== true) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Mídia recebida vem como ID: primeiro a Graph devolve uma URL temporária, e
 * essa URL só abre com o mesmo token (Bearer). O arquivo some em ~30 dias, por
 * isso o webhook já persiste no storage na hora.
 */
export async function fetchMetaMediaBase64(mediaId: string, token: string): Promise<{ base64: string; mimetype: string } | null> {
  const meta = await graphGet<{ url?: string; mime_type?: string }>(encodeURIComponent(mediaId), token);
  if (!meta.ok || !meta.data.url) return null;
  try {
    const res = await fetch(meta.data.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString('base64'), mimetype: meta.data.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

/**
 * Assinatura do webhook (X-Hub-Signature-256 = sha256 HMAC do corpo cru com o
 * App Secret). Sem META_APP_SECRET configurado não há como validar — aceita e
 * avisa no log, para o webhook não ficar mudo por configuração incompleta.
 */
export function assinaturaMetaValida(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[whatsapp-oficial] META_APP_SECRET ausente — assinatura do webhook não validada');
    return true;
  }
  if (!header?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const recebido = header.slice('sha256='.length);
  if (esperado.length !== recebido.length) return false;
  return timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(recebido, 'hex'));
}

/** Token permanente guardado cifrado quando há VAULT_KEY; o legado em texto puro ainda lê. */
export function guardarTokenMeta(token: string): string {
  return cifrar(token) ?? token;
}

export function lerTokenMeta(guardado: string | null | undefined): string {
  return decifrar(guardado).valor ?? '';
}

export async function ensureMetaInstanceColumns(pool: Pool): Promise<void> {
  await pool.query(`
    ALTER TABLE public.client_zapi_instances ADD COLUMN IF NOT EXISTS meta_waba_id TEXT;
    ALTER TABLE public.client_zapi_instances ADD COLUMN IF NOT EXISTS meta_display_phone TEXT;
    ALTER TABLE public.client_zapi_instances ADD COLUMN IF NOT EXISTS meta_verified_name TEXT;
  `);
}

export async function ensureMetaWebhookConfig(pool: Pool): Promise<string> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_webhook_config (
      id TEXT PRIMARY KEY DEFAULT 'global',
      verify_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex')
    );
    INSERT INTO public.meta_webhook_config (id) VALUES ('global') ON CONFLICT DO NOTHING;
  `);
  const { rows: [cfg] } = await pool.query<{ verify_token: string }>(
    `SELECT verify_token FROM public.meta_webhook_config WHERE id = 'global'`,
  );
  return cfg?.verify_token ?? '';
}
