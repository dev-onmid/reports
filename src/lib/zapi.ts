const BASE = 'https://api.z-api.io/instances';

export interface ZApiClient {
  instanceId: string;
  token: string;
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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

export async function checkStatus(client: ZApiClient): Promise<boolean> {
  try {
    const res = await fetch(
      `${BASE}/${client.instanceId}/token/${client.token}/status`,
    );
    return res.ok;
  } catch {
    return false;
  }
}
