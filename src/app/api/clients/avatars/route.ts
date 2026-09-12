import { makeServerPool } from '@/lib/server-db';
import { avatarDoCliente } from '@/lib/client-avatar-source';

/**
 * Mapa `{clientId: urlDaFoto}` de TODOS os clientes, numa chamada só.
 *
 * ⚠️ É uma chamada só de propósito: o `ClientAvatar` aparece em lista de 40+
 * clientes e a versão anterior buscava `/api/clients/{id}/links` POR AVATAR —
 * 40 requisições para montar uma tela.
 *
 * A escolha da fonte mora em `client-avatar-source.ts` (e o porquê da ordem
 * está documentado lá). Aqui é só a coleta: foto do Instagram do snapshot do
 * monitor + id da Página (vínculo de contas primeiro, snapshot como reserva).
 */
export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{
      id: string;
      page_link: string | null;
      page_snap: string | null;
      foto_ig: string | null;
    }>(`
      SELECT c.id,
             fb.account_id          AS page_link,
             s.page_id              AS page_snap,
             s.profile_picture_url  AS foto_ig
        FROM public.clients c
        LEFT JOIN LATERAL (
          SELECT l.account_id
            FROM public.client_account_links l
           WHERE l.client_id = c.id AND l.platform = 'facebook'
           ORDER BY l.created_at ASC
           LIMIT 1
        ) fb ON TRUE
        LEFT JOIN public.social_monitor_snapshots s ON s.client_id = c.id
    `).catch(async () => {
      // Instalação sem o monitor social: ainda dá para servir a foto da Página.
      const semSnapshot = await pool.query<{ id: string; page_link: string | null }>(`
        SELECT c.id, fb.account_id AS page_link
          FROM public.clients c
          LEFT JOIN LATERAL (
            SELECT l.account_id FROM public.client_account_links l
             WHERE l.client_id = c.id AND l.platform = 'facebook'
             ORDER BY l.created_at ASC LIMIT 1
          ) fb ON TRUE
      `);
      return { rows: semSnapshot.rows.map((r) => ({ ...r, page_snap: null, foto_ig: null })) };
    });

    const avatars: Record<string, string> = {};
    for (const r of rows) {
      const url = avatarDoCliente({
        fotoInstagram: r.foto_ig,
        pageId: r.page_link ?? r.page_snap,
      });
      if (url) avatars[r.id] = url;
    }
    return Response.json({ avatars });
  } catch (err) {
    console.error('[clients avatars]', err);
    // A tela degrada para as iniciais — nunca quebra por causa de foto.
    return Response.json({ avatars: {} });
  } finally {
    await pool.end();
  }
}
