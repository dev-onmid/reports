import { fetchDisconnectedInstances } from '@/lib/evolution-instance-alerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const disconnected = await fetchDisconnectedInstances();
    return Response.json({ ok: true, disconnected });
  } catch (err) {
    return Response.json({ ok: false, error: String(err), disconnected: [] });
  }
}
