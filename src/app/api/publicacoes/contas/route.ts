import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureInstagramDirectSchema } from '@/lib/instagram-direct';

/**
 * Contas de Instagram disponíveis para publicar, por cliente.
 *
 * ⚠️ Lê do SNAPSHOT (`social_monitor_snapshots`), não da Graph. Resolver 40
 * clientes ao vivo a cada abertura da tela custaria dezenas de chamadas e
 * segundos de espera; o snapshot é atualizado todo dia pelo monitor e traz
 * exatamente o que a tela precisa (ig_id, @, foto).
 *
 * A defesa contra o snapshot estar velho não é evitá-lo: é o motor RE-RESOLVER
 * a conta na hora de publicar e RECUSAR se ela mudou (ver `publicarAlvo`).
 * Assim o pior caso é uma falha visível, nunca um post na conta errada.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureInstagramDirectSchema(pool);
    // Conexão DIRETA (Instagram Login, sem Página) vence o snapshot: é a conta
    // sem Página, que o monitor social nem enxerga — sem o COALESCE ela ficaria
    // invisível para o planejador. `pageId` continua só do snapshot (conta
    // direta não tem Página — a perna do FB é descartada com motivo).
    const { rows } = await pool.query(
      `SELECT c.id AS client_id, c.name AS client_name,
              COALESCE(CASE WHEN d.status = 'connected' THEN NULLIF(d.ig_user_id, '') END, s.ig_id) AS ig_id,
              COALESCE(CASE WHEN d.status = 'connected' THEN NULLIF(d.username, '') END, s.ig_username) AS ig_username,
              s.profile_picture_url, s.followers, s.page_id, s.page_name,
              (d.client_id IS NOT NULL AND d.status = 'connected') AS direto,
              (d.status = 'erro') AS direto_erro
         FROM public.clients c
         LEFT JOIN public.instagram_direct_connections d ON d.client_id = c.id
         LEFT JOIN public.social_monitor_snapshots s ON s.client_id = c.id
        WHERE COALESCE(c.status, 'Ativo') NOT IN ('Arquivado', 'Inativo')
        ORDER BY c.name ASC`,
    );
    return Response.json({
      ok: true,
      contas: rows.map(r => ({
        clientId: r.client_id,
        clientName: r.client_name,
        igId: r.ig_id || null,
        username: r.ig_username || null,
        picture: r.profile_picture_url || null,
        followers: r.followers ?? null,
        pageId: r.page_id || null,
        pageName: r.page_name || null,
        direto: Boolean(r.direto),
        diretoErro: Boolean(r.direto_erro),
      })),
    });
  } catch {
    // Degrada para vazio: a tela mostra o estado explicativo em vez de quebrar.
    return Response.json({ ok: false, contas: [] });
  } finally {
    await pool.end().catch(() => {});
  }
}
