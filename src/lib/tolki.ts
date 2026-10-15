import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { cifrar, decifrar } from '@/lib/vault-crypto';

// Tolki (CRM de WhatsApp que o cliente usa com a API oficial). O reports NÃO
// fala com o WhatsApp: recebe os webhooks da Tolki (mensagem recebida/enviada,
// status, mídia pronta) e, para o histórico, lê a Channel API deles com a
// X-API-Key da empresa. Documentação: app.tolki.com.br/developer-docs.

export const TOLKI_API = 'https://api.tolki.com.br/api/v1/channel-api/v1';

export type ConexaoTolki = {
  id: string;
  name: string;
  type: string;
  status: string;
  phone: string | null;
};

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

async function tolkiGet<T>(apiKey: string, path: string): Promise<Resultado<T>> {
  try {
    const res = await fetch(`${TOLKI_API}${path}`, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null) as T | { message?: string; error?: string } | null;
    if (!res.ok) {
      const err = json && typeof json === 'object' ? (json as { message?: string; error?: string }) : null;
      return { ok: false, error: err?.message ?? err?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listarConexoesTolki(apiKey: string): Promise<Resultado<ConexaoTolki[]>> {
  const r = await tolkiGet<Array<Record<string, unknown>>>(apiKey, '/connections');
  if (!r.ok) return r;
  const lista = Array.isArray(r.data) ? r.data : [];
  return {
    ok: true,
    data: lista.map(c => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      type: String(c.type ?? ''),
      status: String(c.status ?? ''),
      phone: c.phone ? String(c.phone) : null,
    })),
  };
}

export type ConversaTolki = {
  id: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
};

export async function listarConversasTolki(
  apiKey: string, pagina: number, porPagina: number,
): Promise<Resultado<{ conversas: ConversaTolki[]; total: number }>> {
  const r = await tolkiGet<{ data?: Array<Record<string, unknown>>; total?: number }>(
    apiKey, `/conversations?page=${pagina}&limit=${Math.min(Math.max(porPagina, 1), 100)}`,
  );
  if (!r.ok) return r;
  const rows = Array.isArray(r.data?.data) ? r.data.data : [];
  return {
    ok: true,
    data: {
      total: Number(r.data?.total ?? rows.length),
      conversas: rows.map(c => {
        const contato = (c.contact ?? null) as Record<string, unknown> | null;
        return {
          id: String(c.id ?? ''),
          status: String(c.status ?? ''),
          lastMessageAt: c.lastMessageAt ? String(c.lastMessageAt) : null,
          createdAt: c.createdAt ? String(c.createdAt) : null,
          contact: contato ? {
            id: String(contato.id ?? ''),
            name: contato.name ? String(contato.name) : null,
            phone: contato.phone ? String(contato.phone) : null,
          } : null,
        };
      }),
    },
  };
}

export type MensagemTolki = {
  id: string;
  externalId: string | null;
  type: string;
  direction: 'in' | 'out';
  body: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  status: string | null;
  createdAt: string;
};

export async function listarMensagensTolki(
  apiKey: string, conversaId: string, pagina: number, porPagina = 100,
): Promise<Resultado<MensagemTolki[]>> {
  const r = await tolkiGet<{ data?: Array<Record<string, unknown>> }>(
    apiKey, `/conversations/${encodeURIComponent(conversaId)}/messages?page=${pagina}&limit=${porPagina}`,
  );
  if (!r.ok) return r;
  const rows = Array.isArray(r.data?.data) ? r.data.data : [];
  return {
    ok: true,
    data: rows.map(m => ({
      id: String(m.id ?? ''),
      externalId: m.externalId ? String(m.externalId) : null,
      type: String(m.type ?? 'text'),
      direction: m.direction === 'out' ? 'out' : 'in',
      body: String(m.body ?? ''),
      mediaUrl: m.mediaUrl ? String(m.mediaUrl) : null,
      mediaMimeType: m.mediaMimeType ? String(m.mediaMimeType) : null,
      status: m.status ? String(m.status) : null,
      createdAt: String(m.createdAt ?? ''),
    })),
  };
}

/** URL assinada e temporária: baixa agora, sem credencial. */
export async function baixarMidiaTolki(url: string): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      mime: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

export function tipoDeMidiaTolki(messageType: string | null | undefined, mime: string | null | undefined): 'audio' | 'imagem' | 'video' | 'documento' | null {
  const t = String(messageType ?? '').toLowerCase();
  const m = String(mime ?? '').toLowerCase();
  if (t === 'audio' || t === 'ptt' || m.startsWith('audio/')) return 'audio';
  if (t === 'image' || t === 'sticker' || m.startsWith('image/')) return 'imagem';
  if (t === 'video' || m.startsWith('video/')) return 'video';
  if (t === 'document' || t === 'file' || (m && !m.startsWith('text/'))) return 'documento';
  return null;
}

export function placeholderTolki(messageType: string | null | undefined, body: string): string {
  const texto = body.trim();
  switch (String(messageType ?? '').toLowerCase()) {
    case 'image': case 'sticker': return texto ? `[Imagem] ${texto}` : '[Imagem]';
    case 'audio': case 'ptt': return '[Áudio]';
    case 'video': return texto ? `[Vídeo] ${texto}` : '[Vídeo]';
    case 'document': case 'file': return texto ? `[Doc] ${texto}` : '[Documento]';
    case 'location': return texto ? `[Localização] ${texto}` : '[Localização]';
    case 'contact': case 'contacts': case 'vcard': return texto ? `[Contato] ${texto}` : '[Contato]';
    default: return texto;
  }
}

// ── Webhook: token Bearer que o reports gera e o cliente cola na Tolki ──────

export function gerarTokenWebhookTolki(): string {
  return `tolki_${randomBytes(24).toString('hex')}`;
}

export function autorizacaoTolkiValida(header: string | null, tokenEsperado: string | null | undefined): boolean {
  if (!header || !tokenEsperado) return false;
  const recebido = header.replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(recebido), b = Buffer.from(tokenEsperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Referral do anúncio (CTWA) — se a Tolki repassar no `metadata` ──────────
// A documentação não lista o campo; procuramos por nome, em qualquer nível,
// para aproveitar se vier (Meta manda `referral: {ctwa_clid, source_id, ...}`).

export type ReferralTolki = {
  ctwaClid?: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
};

export function extrairReferralTolki(metadata: unknown): ReferralTolki {
  const achado: ReferralTolki = {};
  const chaves: Record<string, keyof ReferralTolki> = {
    ctwa_clid: 'ctwaClid', ctwaclid: 'ctwaClid',
    source_id: 'sourceId', sourceid: 'sourceId',
    source_url: 'sourceUrl', sourceurl: 'sourceUrl',
    headline: 'headline', body: 'body',
  };
  const visitar = (v: unknown, dentroDeReferral: boolean, profundidade: number) => {
    if (!v || typeof v !== 'object' || profundidade > 6) return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const nome = k.toLowerCase();
      const ehReferral = dentroDeReferral || nome === 'referral' || nome === 'externaladreply';
      const alvo = chaves[nome];
      // `body`/`headline` só valem dentro do bloco de referral (fora é texto comum).
      if (alvo && typeof val === 'string' && val && (ehReferral || (alvo !== 'body' && alvo !== 'headline'))) {
        if (!achado[alvo]) achado[alvo] = val;
      } else if (val && typeof val === 'object') {
        visitar(val, ehReferral, profundidade + 1);
      }
    }
  };
  visitar(metadata, false, 0);
  return achado;
}

// ── Persistência da chave da API da Tolki (cifrada pelo cofre) ───────────────

export async function ensureTolkiInstanceColumns(pool: Pool): Promise<void> {
  await pool.query(`ALTER TABLE public.client_zapi_instances ADD COLUMN IF NOT EXISTS tolki_api_key TEXT;`);
}

export function guardarApiKeyTolki(apiKey: string): string {
  return cifrar(apiKey) ?? apiKey;
}

export function lerApiKeyTolki(guardada: string | null | undefined): string {
  return decifrar(guardada).valor ?? '';
}
