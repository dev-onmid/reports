import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import {
  montarAlvos, proximaOcorrencia, STORY_VIDEO_MAX_SEG, validarPublicacao,
  type Agendamento, type ContaCliente, type PublicacaoInput, type TipoPublicacao,
} from '@/lib/post-agendamento';
import { criarPublicacao, infoDaMidia, listarPublicacoes, salvarMidia, urlPublicaDaMidia } from '@/lib/post-server';

/**
 * Planejador de publicações — lista e criação.
 *
 * Auth: deny-by-default do proxy (a rota não está em PUBLIC_PREFIXES), igual às
 * demais rotas internas. O `x-onmid-user-id` que chega aqui já foi sobrescrito
 * pelo proxy a partir do cookie assinado — não é auto-declarado.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const pool = makeServerPool();
  try {
    return Response.json({ ok: true, publicacoes: await listarPublicacoes(pool) });
  } catch (err) {
    console.error('[publicacoes GET]', err);
    return Response.json({ ok: false, publicacoes: [] });
  } finally {
    await pool.end().catch(() => {});
  }
}

type Body = {
  tipo?: TipoPublicacao;
  legenda?: string;
  clientIds?: string[];
  agendamento?: Agendamento;
  imagem?: { dataUrl?: string; largura?: number; altura?: number };
  /** Vídeo já enviado por /api/publicacoes/upload — o JSON não comporta 80 MB. */
  midiaId?: string;
};

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const body = await req.json().catch(() => ({})) as Body;
    const tipo: TipoPublicacao = body.tipo === 'story' ? 'story' : body.tipo === 'reels' ? 'reels' : 'feed';
    const legenda = String(body.legenda ?? '');
    const clientIds = Array.isArray(body.clientIds) ? body.clientIds.filter(x => typeof x === 'string') : [];
    const ag = body.agendamento;

    if (!ag || (ag.modo !== 'unico' && ag.modo !== 'recorrente')) {
      return Response.json({ ok: false, error: 'Agendamento inválido.' }, { status: 400 });
    }
    if (!body.imagem?.dataUrl && !body.midiaId) {
      return Response.json({ ok: false, error: 'Envie a imagem ou o vídeo da publicação.' }, { status: 400 });
    }

    // ⚠️ Recusa servidor-side do casamento tipo × mídia (a tela também valida,
    // mas o servidor é quem não pode deixar passar): Reels exige vídeo, feed
    // exige imagem. Vídeo chega por midiaId (upload prévio), imagem por dataUrl.
    let midiaIdPronta: string | null = null;
    if (body.midiaId) {
      const info = await infoDaMidia(pool, body.midiaId);
      if (!info) return Response.json({ ok: false, error: 'Mídia enviada não encontrada — suba o vídeo de novo.' }, { status: 400 });
      const ehVideo = info.mime.startsWith('video/');
      if (tipo === 'feed' && ehVideo) {
        return Response.json({ ok: false, error: 'Vídeo no feed é Reels — troque o tipo.' }, { status: 400 });
      }
      if (tipo === 'reels' && !ehVideo) {
        return Response.json({ ok: false, error: 'Reels precisa de um vídeo.' }, { status: 400 });
      }
      if (tipo === 'story' && ehVideo && (info.duracao_seg ?? 0) > STORY_VIDEO_MAX_SEG) {
        return Response.json({ ok: false, error: `Story em vídeo aceita até ${STORY_VIDEO_MAX_SEG}s — use Reels.` }, { status: 400 });
      }
      midiaIdPronta = body.midiaId;
    } else if (tipo === 'reels') {
      return Response.json({ ok: false, error: 'Reels precisa de um vídeo.' }, { status: 400 });
    }

    // ⚠️ A URL da imagem precisa ser pública e https ANTES de gravar qualquer
    // coisa. Sem isso a publicação nasceria condenada a falhar no worker, e o
    // gestor só descobriria no horário agendado.
    const origin = webhookOrigin(req.url);
    if (!urlPublicaDaMidia('0'.repeat(32), origin)) {
      return Response.json({
        ok: false,
        error: 'O sistema não tem uma URL pública configurada (APP_URL) — a Meta não conseguiria baixar a imagem.',
      }, { status: 400 });
    }

    // Contas vêm do snapshot; o motor re-resolve e recusa divergência na hora
    // de publicar (ver `publicarAlvo`).
    const { rows } = await pool.query(
      `SELECT c.id AS client_id, c.name AS client_name, s.ig_id, s.ig_username
         FROM public.clients c
         LEFT JOIN public.social_monitor_snapshots s ON s.client_id = c.id
        WHERE c.id = ANY($1)`,
      [clientIds],
    );
    const contas: ContaCliente[] = rows.map(r => ({
      clientId: r.client_id, clientName: r.client_name ?? r.client_id,
      igId: r.ig_id || null, username: r.ig_username || null,
    }));

    const { alvos, descartados } = montarAlvos(clientIds, contas);
    const input: PublicacaoInput = { tipo, legenda, midiaId: 'pendente', clientIds, agendamento: ag };
    const erros = validarPublicacao(input, alvos, new Date());
    if (erros.length) return Response.json({ ok: false, error: erros[0], erros, descartados }, { status: 400 });

    const proxima = proximaOcorrencia(ag, new Date());
    if (!proxima) return Response.json({ ok: false, error: 'Agendamento sem data futura.' }, { status: 400 });

    const criadoPor = req.headers.get('x-onmid-user-id') ?? undefined;
    const midiaId = midiaIdPronta
      ?? (await salvarMidia(pool, body.imagem!.dataUrl!, body.imagem!.largura, body.imagem!.altura, criadoPor)).id;

    const id = await criarPublicacao(pool, {
      midiaId, tipo, legenda, modo: ag.modo, proxima,
      dias: ag.modo === 'recorrente' ? ag.dias : [],
      hora: ag.modo === 'recorrente' ? ag.hora : null,
      ate: ag.modo === 'recorrente' ? ag.ate : null,
      clientIds: alvos.map(a => a.clientId),
      criadoPor,
    }, alvos);

    return Response.json({
      ok: true, id,
      contas: alvos.map(a => a.username || a.clientName),
      descartados,
      proxima: proxima.toISOString(),
    });
  } catch (err) {
    console.error('[publicacoes POST]', err);
    return Response.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
