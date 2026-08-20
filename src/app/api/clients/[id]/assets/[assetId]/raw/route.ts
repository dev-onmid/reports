import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { obterAssetPorId } from '@/lib/client-assets';

// Serve os bytes da imagem pra UI (preview). Atrás do proxy de auth — NÃO é URL pública.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { assetId } = await params;
  const pool = makeServerPool();
  try {
    const a = await obterAssetPorId(pool, assetId);
    if (!a || !a.bytes) return new Response('não encontrado', { status: 404 });
    return new Response(new Uint8Array(a.bytes), {
      headers: {
        'Content-Type': a.mime ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${a.nome.replace(/[^\w.-]/g, '_')}"`,
      },
    });
  } catch {
    return new Response('erro', { status: 500 });
  } finally { await pool.end().catch(() => {}); }
}
