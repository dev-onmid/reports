import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT cv.id::text, cv.client_id, c.name AS client_name,
              cv.title, cv.url, cv.login, cv.password_enc,
              cv.category, cv.notes, cv.created_at, cv.updated_at
       FROM public.client_vault cv
       JOIN public.clients c ON c.id = cv.client_id
       ORDER BY c.name, cv.category, cv.title`
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
