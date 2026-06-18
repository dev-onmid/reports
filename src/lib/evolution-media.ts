import { createClient } from '@supabase/supabase-js';

// Evolution API only sends a placeholder in the webhook text for media messages —
// the actual audio/image/video bytes must be fetched separately via this endpoint,
// then persisted somewhere with a public URL so the chat UI can play/display it
// (Evolution's own WhatsApp media URLs are end-to-end encrypted and not directly
// fetchable without this decrypt-and-return-base64 call).
export async function fetchEvolutionMediaBase64(
  instanceName: string,
  messageKey: unknown,
): Promise<{ base64: string; mimetype: string } | null> {
  const base = process.env.EVOLUTION_API_URL?.replace(/\/$/, '');
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!base || !apikey) return null;
  try {
    const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ message: { key: messageKey } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = await res.json() as { base64?: string; mimetype?: string };
    if (!j.base64) return null;
    return { base64: j.base64, mimetype: j.mimetype ?? 'audio/ogg; codecs=opus' };
  } catch {
    return null;
  }
}

const BUCKET = 'crm-media';

function extFromMimetype(mimetype: string): string {
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('mp4')) return 'mp4';
  if (mimetype.includes('webm')) return 'webm';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('png')) return 'png';
  if (mimetype.includes('jpeg') || mimetype.includes('jpg')) return 'jpg';
  return 'bin';
}

// Server-side upload (service role key — bypasses RLS), same bucket the existing
// /api/upload route uses for outgoing attachments. Used to persist INCOMING WhatsApp
// media (decoded from Evolution's base64 response) as a public URL the chat can render.
export async function uploadBase64ToStorage(base64: string, mimetype: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key);
    await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null);
    const buffer = Buffer.from(base64, 'base64');
    const ext = extFromMimetype(mimetype);
    const path = `wa-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimetype,
      upsert: false,
    });
    if (error) return null;
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return publicUrl;
  } catch {
    return null;
  }
}
