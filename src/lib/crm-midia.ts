/**
 * Mídia do chat (foto/áudio/vídeo/documento) no DISCO da VPS, atrás de rota
 * autenticada por cliente (2026-10-10, decisão do Matheus: "guardar tudo na
 * VPS, atrás de autenticado").
 *
 * ⚠️ Por que mudou: a mídia ia para um bucket PÚBLICO do Supabase, com nome
 * fraco e sem validade — e o projeto morreu (nem resolve DNS), então havia
 * semanas sem gravar nada. Agora:
 *   arquivo  → `$MIDIA_DIR/crm/<client_id>/<token 32 hex>.<ext>` (volume da VPS)
 *   registro → `crm_midia` (token, client_id, lead_id, mime, bytes)
 *   URL      → `/api/crm/midia/<token>` — RELATIVA de propósito: o cookie de
 *              sessão é por host (reports × crm), e a rota confere o cliente.
 *
 * Para ENVIAR pela Evolution (que baixa a URL de fora e não tem sessão), o
 * arquivo vai em base64 — ver `midiaNossaParaDataUrl`.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';

export const PREFIXO_URL = '/api/crm/midia/';
const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_BYTES = 25 * 1024 * 1024;

export function midiaDir(): string {
  return path.join(process.env.MIDIA_DIR ?? '/app/midia', 'crm');
}

export function extDoMime(mime: string): string {
  const m = mime.toLowerCase();
  const tabela: Array<[string, string]> = [
    ['ogg', 'ogg'], ['mpeg', 'mp3'], ['mp3', 'mp3'], ['mp4', 'mp4'], ['quicktime', 'mov'], ['webm', 'webm'], ['wav', 'wav'],
    ['aac', 'aac'], ['png', 'png'], ['jpeg', 'jpg'], ['jpg', 'jpg'], ['webp', 'webp'], ['gif', 'gif'], ['pdf', 'pdf'],
    ['wordprocessingml', 'docx'], ['msword', 'doc'], ['spreadsheetml', 'xlsx'], ['ms-excel', 'xls'],
    ['presentationml', 'pptx'], ['zip', 'zip'], ['3gpp', '3gp'], ['csv', 'csv'], ['plain', 'txt'],
  ];
  for (const [chave, ext] of tabela) if (m.includes(chave)) return ext;
  return 'bin';
}

/** Tipos que o chat envia/recebe. Sem HTML/SVG/script: seria hospedagem de phishing. */
export function mimePermitido(mime: string): boolean {
  return /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|ogg|mp4|aac|wav|webm|x-m4a)|video\/(mp4|quicktime|webm|3gpp)|application\/(pdf|zip|msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel)|text\/(plain|csv))$/i
    .test(mime.split(';')[0].trim());
}

let pronto: Promise<void> | null = null;
export function ensureCrmMidia(pool: Pool): Promise<void> {
  if (!pronto) {
    pronto = pool.query(`
      CREATE TABLE IF NOT EXISTS public.crm_midia (
        token TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        lead_id UUID,
        arquivo TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        origem TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS crm_midia_lead_idx ON public.crm_midia (lead_id);
      CREATE INDEX IF NOT EXISTS crm_midia_client_idx ON public.crm_midia (client_id);
    `).then(() => undefined).catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

export type MidiaSalva = { token: string; url: string; arquivo: string; mime: string; bytes: number };

export async function salvarMidia(pool: Pool, opts: {
  clientId: string; leadId?: string | null; bytes: Buffer; mime: string; origem: 'recebida' | 'enviada' | 'followup';
}): Promise<MidiaSalva> {
  const mime = opts.mime.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (opts.bytes.length === 0) throw new Error('arquivo vazio');
  if (opts.bytes.length > MAX_BYTES) throw new Error('arquivo acima de 25 MB');
  await ensureCrmMidia(pool);
  const token = randomBytes(16).toString('hex');
  // client_id vem do banco (nunca de URL): só caracteres seguros no caminho.
  const pasta = path.join(midiaDir(), opts.clientId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  await fs.mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${token}.${extDoMime(mime)}`);
  await fs.writeFile(arquivo, opts.bytes, { mode: 0o640 });
  await pool.query(
    `INSERT INTO public.crm_midia (token, client_id, lead_id, arquivo, mime, bytes, origem) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [token, opts.clientId, opts.leadId ?? null, arquivo, mime, opts.bytes.length, opts.origem],
  );
  return { token, url: `${PREFIXO_URL}${token}`, arquivo, mime, bytes: opts.bytes.length };
}

export function tokenDaUrl(url: string | null | undefined): string | null {
  const s = String(url ?? '').trim();
  const m = s.match(/\/api\/crm\/midia\/([0-9a-f]{32})(?:[?#].*)?$/);
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

export async function lerMidia(pool: Pool, token: string): Promise<{ arquivo: string; mime: string; client_id: string; bytes: number } | null> {
  if (!TOKEN_RE.test(token)) return null;
  await ensureCrmMidia(pool);
  const { rows: [r] } = await pool.query(`SELECT arquivo, mime, client_id, bytes FROM public.crm_midia WHERE token = $1`, [token]);
  return r ?? null;
}

/** Liga a mídia ao lead depois que o lead existe (o webhook salva a mídia antes do upsert). */
export async function vincularMidiaAoLead(pool: Pool, token: string | null, leadId: string): Promise<void> {
  if (!token) return;
  await pool.query(`UPDATE public.crm_midia SET lead_id = $2 WHERE token = $1 AND lead_id IS NULL`, [token, leadId]).catch(() => null);
}

/**
 * Mídia NOSSA (`/api/crm/midia/<token>`) vira `data:` URL para a Evolution —
 * ela não tem sessão para baixar da rota. Qualquer outra URL volta como está.
 */
export async function midiaNossaParaDataUrl(pool: Pool, url: string): Promise<string> {
  const token = tokenDaUrl(url);
  if (!token) return url;
  const m = await lerMidia(pool, token);
  if (!m) return url;
  const bytes = await fs.readFile(m.arquivo);
  return `data:${m.mime};base64,${bytes.toString('base64')}`;
}

/** Mesmo que `midiaNossaParaDataUrl`, abrindo o pool só se a URL for nossa (para o motor de envio). */
export async function resolverMidiaParaEnvio(url: string): Promise<string> {
  if (!tokenDaUrl(url)) return url;
  const { makeServerPool } = await import('@/lib/server-db');
  const pool = makeServerPool();
  try { return await midiaNossaParaDataUrl(pool, url); } finally { await pool.end().catch(() => {}); }
}

/** Exclusão em cascata (LGPD): apaga os arquivos e os registros de mídia do lead. */
export async function apagarMidiasDoLead(pool: Pool, leadId: string): Promise<number> {
  await ensureCrmMidia(pool);
  const { rows } = await pool.query<{ arquivo: string }>(`DELETE FROM public.crm_midia WHERE lead_id = $1 RETURNING arquivo`, [leadId]);
  for (const r of rows) await fs.unlink(r.arquivo).catch(() => null);
  return rows.length;
}
