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

// A gravação da mídia (disco da VPS, rota autenticada) mora em src/lib/crm-midia.ts.
