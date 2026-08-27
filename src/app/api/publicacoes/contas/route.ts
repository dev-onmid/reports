import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

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
    const { rows } = await pool.query(
      `SELECT c.id AS client_id, c.name AS client_name,
              s.ig_id, s.ig_username, s.profile_picture_url, s.followers
         FROM public.clients c
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
      })),
    });
  } catch {
    // Degrada para vazio: a tela mostra o estado explicativo em vez de quebrar.
    return Response.json({ ok: false, contas: [] });
  } finally {
    await pool.end().catch(() => {});
  }
}
