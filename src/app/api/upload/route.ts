import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { mimePermitido, salvarMidia } from '@/lib/crm-midia';

/**
 * Anexo do chat / follow-up → disco da VPS, atrás de rota autenticada
 * (ver src/lib/crm-midia.ts). Antes ia para o bucket público do Supabase, que
 * morreu. `clientId` vem na QUERY de propósito: o corpo é multipart e o proxy
 * confere o cliente pela query — usuário de cliente só sobe mídia para o
 * próprio cliente.
 *
 * O envio pela Evolution NÃO usa esta URL (ela exige sessão): quem envia
 * converte para base64 antes — `midiaNossaParaDataUrl`.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const leadId = req.nextUrl.searchParams.get('leadId');
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: 'Envie o arquivo como multipart/form-data' }, { status: 400 });
  }
  const file = formData.get('file') as File | null;
  if (!file) return Response.json({ error: 'Campo "file" ausente' }, { status: 400 });
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (!mimePermitido(mime)) {
    return Response.json({ error: 'Tipo de arquivo não permitido. Envie imagem, áudio, vídeo, PDF ou documento.' }, { status: 415 });
  }
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: 'Arquivo muito grande (máx 25 MB)' }, { status: 413 });

  const pool = makeServerPool();
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const salva = await salvarMidia(pool, {
      clientId, leadId: leadId && /^[0-9a-f-]{36}$/i.test(leadId) ? leadId : null, bytes, mime, origem: 'enviada',
    });
    return Response.json({ url: salva.url, mime: salva.mime, bytes: salva.bytes });
  } catch (err) {
    console.error('[upload]', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Não foi possível guardar o arquivo.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
