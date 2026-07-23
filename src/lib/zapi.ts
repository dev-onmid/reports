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

function parseZapiResponse(res: Response, body: Record<string, unknown>): SendResult {
  if (!res.ok) {
    return { ok: false, error: (body.message as string) ?? (body.error as string) ?? `HTTP ${res.status}` };
  }
  // Z-API returns HTTP 200 even for failures — check the body
  if (body.value === 'false' || body.value === false) {
    return { ok: false, error: (body.message as string) ?? (body.status as string) ?? 'Z-API recusou o envio' };
  }
  if (body.error) {
    return { ok: false, error: String(body.error) };
  }
  return { ok: true };
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return parseZapiResponse(res, body);
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return parseZapiResponse(res, body);
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
    // O endpoint do Z-API exige a EXTENSÃO na URL (/send-document/pdf) — sem ela o envio
    // falha. E, como nos demais, o corpo precisa ser validado (200 não significa sucesso).
    const ext = (fileName.split('.').pop() || 'pdf').toLowerCase();
    const res = await fetch(
      `${BASE}/${client.instanceId}/token/${client.token}/send-document/${ext}`,
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return parseZapiResponse(res, body);
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
