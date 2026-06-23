function base(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error('EVOLUTION_API_URL não configurada no servidor');
  return url.replace(/\/$/, '');
}

function apiKey(): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error('EVOLUTION_API_KEY não configurada no servidor');
  return key;
}

function headers() {
  return { 'Content-Type': 'application/json', apikey: apiKey() };
}

export interface EvolutionQrCode {
  base64?: string;
  code?: string;
}

export interface EvolutionState {
  state: 'open' | 'close' | 'connecting' | string;
}

export async function createEvolutionInstance(
  instanceName: string,
): Promise<{ instanceName: string; hash: string }> {
  const res = await fetch(`${base()}/instance/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ instanceName, integration: 'WHATSAPP-BAILEYS' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(err.message ?? err.error ?? `HTTP ${res.status}`));
  }
  const data = await res.json() as {
    instance: { instanceName: string };
    hash: string;
  };
  return { instanceName: data.instance.instanceName, hash: data.hash };
}

export async function getEvolutionQrCode(instanceName: string): Promise<EvolutionQrCode> {
  const res = await fetch(`${base()}/instance/connect/${encodeURIComponent(instanceName)}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<EvolutionQrCode>;
}

export async function getEvolutionState(instanceName: string): Promise<EvolutionState> {
  const res = await fetch(`${base()}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { instance?: { state?: string }; state?: string };
  return { state: data.instance?.state ?? data.state ?? 'unknown' };
}

export async function deleteEvolutionInstance(instanceName: string): Promise<void> {
  await fetch(`${base()}/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
    headers: headers(),
  }).catch(() => {});
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendEvolutionText(
  instanceName: string,
  phone: string,
  message: string,
): Promise<SendResult> {
  try {
    const res = await fetch(`${base()}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ number: phone, text: message }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(body.message ?? body.error ?? `HTTP ${res.status}`) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function sendEvolutionImage(
  instanceName: string,
  phone: string,
  imageUrl: string,
  caption: string,
): Promise<SendResult> {
  try {
    const res = await fetch(`${base()}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ number: phone, mediatype: 'image', media: imageUrl, caption }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(body.message ?? body.error ?? `HTTP ${res.status}`) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkEvolutionStatus(instanceName: string): Promise<boolean> {
  try {
    const { state } = await getEvolutionState(instanceName);
    return state === 'open';
  } catch {
    return false;
  }
}

export async function setEvolutionWebhook(
  instanceName: string,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${base()}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
        },
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text().catch(() => `HTTP ${res.status}`) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
