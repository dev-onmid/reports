const BASE = 'https://api.z-api.io/instances';

export interface ZApiClient {
  instanceId: string;
  token: string;
  clientToken?: string;
}

function zapiHeaders(clientToken?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (clientToken) h['Client-Token'] = clientToken;
  return h;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendText(
  client: ZApiClient,
  phone: string,
  message: string,
): Promise<SendResult> {
  try {
    const res = await fetch(
      `${BASE}/${client.instanceId}/token/${client.token}/send-text`,
      {
        method: 'POST',
        headers: zapiHeaders(client.clientToken),
        body: JSON.stringify({ phone, message }),
      },
    );
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: (body as { message?: string }).message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function sendImage(
  client: ZApiClient,
  phone: string,
  image: string,
  caption: string,
): Promise<SendResult> {
  try {
    const res = await fetch(
      `${BASE}/${client.instanceId}/token/${client.token}/send-image`,
      {
        method: 'POST',
        headers: zapiHeaders(client.clientToken),
        body: JSON.stringify({ phone, image, caption }),
      },
    );
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: (body as { message?: string }).message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function sendDocument(
  client: ZApiClient,
  phone: string,
  documentBase64: string,
  fileName: string,
  caption?: string,
): Promise<SendResult> {
  try {
    const res = await fetch(
      `${BASE}/${client.instanceId}/token/${client.token}/send-document`,
      {
        method: 'POST',
        headers: zapiHeaders(client.clientToken),
        body: JSON.stringify({
          phone,
          document: `data:application/pdf;base64,${documentBase64}`,
          fileName,
          caption: caption ?? '',
        }),
      },
    );
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: (body as { message?: string }).message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkStatus(client: ZApiClient): Promise<boolean> {
  try {
    const res = await fetch(
      `${BASE}/${client.instanceId}/token/${client.token}/status`,
      { headers: zapiHeaders(client.clientToken) },
    );
    return res.ok;
  } catch {
    return false;
  }
}
