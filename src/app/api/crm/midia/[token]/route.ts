import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { lerMidia } from '@/lib/crm-midia';

/**
 * Mídia do chat, AUTENTICADA (ver src/lib/crm-midia.ts). Exige sessão (proxy);
 * usuário de cliente só alcança token cujo `client_id` é dele — o proxy
 * resolve o dono do token antes de deixar passar. Responde Range/206 (Safari
 * só toca áudio/vídeo assim) e nunca deixa o navegador "adivinhar" o tipo.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pool = makeServerPool();
  try {
    const m = await lerMidia(pool, token);
    if (!m) return new Response('não encontrado', { status: 404 });
    const st = await fs.stat(m.arquivo).catch(() => null);
    if (!st) return new Response('arquivo não encontrado', { status: 404 });
    const base: Record<string, string> = {
      'Content-Type': m.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${req.nextUrl.searchParams.has('baixar') ? 'attachment' : 'inline'}; filename="${token}.${m.arquivo.split('.').pop()}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    };
    const range = req.headers.get('range');
    const r = range?.match(/bytes=(\d*)-(\d*)/);
    if (r) {
      const inicio = r[1] ? Number(r[1]) : 0;
      const fim = r[2] ? Math.min(Number(r[2]), st.size - 1) : st.size - 1;
      if (inicio > fim || inicio >= st.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      }
      return new Response(Readable.toWeb(createReadStream(m.arquivo, { start: inicio, end: fim })) as ReadableStream, {
        status: 206,
        headers: { ...base, 'Content-Length': String(fim - inicio + 1), 'Content-Range': `bytes ${inicio}-${fim}/${st.size}` },
      });
    }
    return new Response(Readable.toWeb(createReadStream(m.arquivo)) as ReadableStream, {
      headers: { ...base, 'Content-Length': String(st.size) },
    });
  } catch {
    return new Response('erro', { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
