import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getEvolutionQrCode } from '@/lib/evolution-api';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [client] } = await pool.query(
      `SELECT instance_id, provider FROM public.zapi_clients WHERE id = $1`,
      [id],
    );
    if (!client) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });
    if (client.provider !== 'evolution') {
      return Response.json({ error: 'Apenas instâncias Evolution API suportam pareamento por QR Code' }, { status: 400 });
    }
    const data = await getEvolutionQrCode(client.instance_id);
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  } finally {
    await pool.end();
  }
}
