import { makeServerPool } from '@/lib/server-db';
import { instanciaOnmid } from '@/lib/whatsapp-send';

// Quem envia em nome da ONMID. É uma resposta, não um menu: a tela pergunta
// "por onde sai?" e mostra; não existe escolher outro (ver whatsapp-send).
//
// Devolve LISTA de um item de propósito — as telas que antes recebiam a lista
// de instâncias continuam funcionando sem reescrever o render.

export const dynamic = 'force-dynamic';

export async function GET() {
  const pool = makeServerPool();
  try {
    const inst = await instanciaOnmid(pool);
    if (!inst) return Response.json([]);
    return Response.json([{ id: inst.id, name: inst.name, provider: inst.provider, instance_id: inst.instanceId }]);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
