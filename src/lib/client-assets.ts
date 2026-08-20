import type { Pool } from 'pg';

/**
 * Biblioteca de ASSETS por cliente (logo, imagens de anúncio, referência de vídeo).
 *
 * Pedido do Matheus (2026-08-20): o maior bloqueio de autonomia na criação de
 * campanha era criativo — todo anúncio dependia de alguém colar uma URL na hora
 * (o logo do Panino travou a criação inteira). Aqui o arquivo entra UMA vez e
 * a Luna/Claude usam para sempre.
 *
 * Armazenamento: BYTEA no Postgres, de propósito — sobrevive a redeploy do
 * container (o filesystem da imagem é efêmero), não cria dependência nova de
 * storage, e imagem de anúncio é pequena (cap 4MB). Vídeo NÃO entra como bytes:
 * só como `video_url` de referência (YouTube/Drive), senão o banco incha.
 */

let ensured: Promise<void> | null = null;
export function ensureClientAssetsSchema(pool: Pool): Promise<void> {
  ensured ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS public.client_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('logo', 'imagem', 'video_url')),
      nome TEXT NOT NULL,
      mime TEXT,
      bytes BYTEA,
      url TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS client_assets_client_idx
      ON public.client_assets (client_id, tipo, created_at DESC)`);
  })();
  return ensured;
}

/** Link de COMPARTILHAR do Drive/Dropbox devolve página HTML — converte pro download direto. */
export function normalizarUrlDownload(url: string): string {
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/([\w-]+)|open\?id=([\w-]+)|uc\?.*id=([\w-]+))/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1] ?? drive[2] ?? drive[3]}`;
  if (/dropbox\.com/.test(url)) {
    try { const u = new URL(url); u.searchParams.set('dl', '1'); return u.toString(); } catch { return url; }
  }
  return url;
}

export type AssetSalvo = { id: string; nome: string; mime: string; kb: number };

const MIME_OK = /image\/(png|jpe?g|webp)/;
const MIN_BYTES = 1024;
const MAX_BYTES = 4 * 1024 * 1024;

/** Baixa a imagem da URL (link direto ou Drive/Dropbox público) e grava na biblioteca. */
export async function salvarAssetDeUrl(
  pool: Pool, clientId: string, tipo: 'logo' | 'imagem', urlOriginal: string,
  nome?: string, createdBy?: string,
): Promise<AssetSalvo> {
  await ensureClientAssetsSchema(pool);
  if (!/^https?:\/\//.test(urlOriginal)) throw new Error('URL inválida — precisa começar com http(s)://');
  const url = normalizarUrlDownload(urlOriginal);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`download falhou (HTTP ${r.status}) — o arquivo está público? No Drive precisa ser "qualquer pessoa com o link"`);
  const ct = (r.headers.get('content-type') ?? '').split(';')[0];
  if (!MIME_OK.test(ct)) throw new Error(`não é uma imagem JPG/PNG/WebP (content-type: ${ct || '?'}) — no Drive, confira se o link é do ARQUIVO e está público`);
  const ab = await r.arrayBuffer();
  if (ab.byteLength < MIN_BYTES) throw new Error('arquivo pequeno demais (<1KB) — provavelmente não é a imagem');
  if (ab.byteLength > MAX_BYTES) throw new Error(`imagem acima de 4MB (${Math.round(ab.byteLength / 1024 / 1024)}MB) — reduza antes de salvar`);
  const bytes = Buffer.from(ab);
  const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : 'jpg';
  const nomeFinal = (nome ?? '').trim() || `${tipo}.${ext}`;
  const { rows } = await pool.query(
    `INSERT INTO public.client_assets (client_id, tipo, nome, mime, bytes, url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [clientId, tipo, nomeFinal, ct, bytes, urlOriginal, createdBy ?? null],
  );
  return { id: rows[0].id, nome: nomeFinal, mime: ct, kb: Math.round(bytes.length / 1024) };
}

export async function salvarVideoUrl(
  pool: Pool, clientId: string, url: string, nome?: string, createdBy?: string,
): Promise<AssetSalvo> {
  await ensureClientAssetsSchema(pool);
  if (!/^https?:\/\//.test(url)) throw new Error('URL inválida');
  const { rows } = await pool.query(
    `INSERT INTO public.client_assets (client_id, tipo, nome, url, created_by)
     VALUES ($1, 'video_url', $2, $3, $4) RETURNING id`,
    [clientId, (nome ?? '').trim() || 'vídeo', url, createdBy ?? null],
  );
  return { id: rows[0].id, nome: (nome ?? '').trim() || 'vídeo', mime: 'video/url', kb: 0 };
}

export type AssetInfo = {
  id: string; tipo: string; nome: string; mime: string | null; url: string | null;
  kb: number; created_at: string;
};

export async function listarAssets(pool: Pool, clientId: string): Promise<AssetInfo[]> {
  await ensureClientAssetsSchema(pool);
  const { rows } = await pool.query(
    `SELECT id, tipo, nome, mime, url, COALESCE(octet_length(bytes), 0) / 1024 AS kb, created_at
       FROM public.client_assets WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [clientId],
  );
  return rows;
}

export type AssetBytes = { id: string; nome: string; mime: string; bytes: Buffer };

/** Asset de imagem mais recente do tipo pedido (com fallback: 'imagem' cai pra 'logo' e vice-versa). */
export async function obterAssetImagem(
  pool: Pool, clientId: string, tipoPreferido: 'logo' | 'imagem',
): Promise<AssetBytes | null> {
  await ensureClientAssetsSchema(pool);
  const { rows } = await pool.query(
    `SELECT id, nome, mime, bytes FROM public.client_assets
      WHERE client_id = $1 AND tipo IN ('logo', 'imagem') AND bytes IS NOT NULL
      ORDER BY (tipo = $2) DESC, created_at DESC LIMIT 1`,
    [clientId, tipoPreferido],
  );
  return rows[0] ?? null;
}

export async function obterAssetPorId(pool: Pool, assetId: string): Promise<AssetBytes | null> {
  await ensureClientAssetsSchema(pool);
  const { rows } = await pool.query(
    `SELECT id, nome, mime, bytes FROM public.client_assets WHERE id = $1 LIMIT 1`, [assetId]);
  return rows[0] ?? null;
}

export async function removerAsset(pool: Pool, clientId: string, assetId: string): Promise<boolean> {
  await ensureClientAssetsSchema(pool);
  const { rowCount } = await pool.query(
    `DELETE FROM public.client_assets WHERE id = $1 AND client_id = $2`, [assetId, clientId]);
  return (rowCount ?? 0) > 0;
}
