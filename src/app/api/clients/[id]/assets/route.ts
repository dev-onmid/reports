import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { listarAssets, salvarAssetDeUrl, salvarVideoUrl, removerAsset } from '@/lib/client-assets';

// Biblioteca de assets do cliente (logo/imagens/vídeo-referência).
// Auth: deny-by-default do proxy (rota interna). Upload é por URL de propósito
// (link direto ou Drive/Dropbox público) — corpo pequeno, sem multipart.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    return Response.json({ assets: await listarAssets(pool, id) });
  } catch {
    return Response.json({ assets: [] });
  } finally { await pool.end().catch(() => {}); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { tipo?: string; url?: string; nome?: string };
  const tipo = String(body.tipo ?? 'imagem');
  const url = String(body.url ?? '').trim();
  if (!url) return Response.json({ ok: false, error: 'Informe a URL do arquivo' }, { status: 400 });
  if (!['logo', 'imagem', 'video_url'].includes(tipo)) {
    return Response.json({ ok: false, error: 'tipo deve ser logo, imagem ou video_url' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    const salvo = tipo === 'video_url'
      ? await salvarVideoUrl(pool, id, url, body.nome, req.headers.get('x-onmid-user-id') ?? undefined)
      : await salvarAssetDeUrl(pool, id, tipo as 'logo' | 'imagem', url, body.nome, req.headers.get('x-onmid-user-id') ?? undefined);
    return Response.json({ ok: true, asset: salvo });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'erro' }, { status: 400 });
  } finally { await pool.end().catch(() => {}); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const assetId = req.nextUrl.searchParams.get('assetId') ?? '';
  if (!assetId) return Response.json({ ok: false, error: 'assetId obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const ok = await removerAsset(pool, id, assetId);
    return Response.json({ ok });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  } finally { await pool.end().catch(() => {}); }
}
