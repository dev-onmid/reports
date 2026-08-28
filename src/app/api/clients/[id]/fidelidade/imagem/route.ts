import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { webhookOrigin } from '@/lib/evolution-api';
import { salvarMidia, urlPublicaDaMidia } from '@/lib/post-server';

/**
 * Upload da arte de uma variação da campanha de Fidelidade.
 *
 * ⚠️ A mídia vai para `post_midia` — a MESMA tabela das Publicações. Não é
 * acoplamento acidental: a tabela é genérica ("bytes com um token público") e
 * já tem rota pública (`/api/midia/[token]`) e cap de tamanho. Uma cópia
 * própria significaria uma segunda rota pública para auditar, que é o tipo de
 * duplicação que envelhece mal.
 *
 * ⚠️ A imagem chega em JPEG, convertida no NAVEGADOR (`prepararImagem`): o
 * projeto não tem lib de imagem, e é o canvas que redimensiona e comprime.
 *
 * ⚠️ Recusa ANTES de gravar quando a origem não é canônica. A Evolution/Z-API
 * não recebe o arquivo — ela BAIXA de uma URL pública. Sem `APP_URL` a campanha
 * nasceria com uma arte que nenhum destinatário conseguiria ver.
 */

export const maxDuration = 30;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;

  const body = await req.json().catch(() => null) as { dataUrl?: string; largura?: number; altura?: number } | null;
  if (!body?.dataUrl) return Response.json({ error: 'Envie a imagem pela tela.' }, { status: 400 });

  const origin = webhookOrigin(req.url);
  if (!urlPublicaDaMidia('0'.repeat(32), origin)) {
    return Response.json({
      error: 'O endereço público do sistema não está configurado (APP_URL). '
        + 'Sem ele o WhatsApp não consegue baixar a imagem — a campanha só pode usar texto.',
    }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ fidelidade_ativa: boolean | null }>(
      `SELECT fidelidade_ativa FROM public.clients WHERE id = $1`, [clientId],
    ).catch(() => ({ rows: [] as { fidelidade_ativa: boolean | null }[] }));
    if (rows[0]?.fidelidade_ativa !== true) {
      return Response.json({ error: 'Fidelidade desativada para este cliente' }, { status: 403 });
    }

    const midia = await salvarMidia(pool, body.dataUrl, body.largura, body.altura, clientId);
    return Response.json({ token: midia.token, kb: midia.kb, url: `/api/midia/${midia.token}` });
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 400 });
  } finally {
    await pool.end();
  }
}
