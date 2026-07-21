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

// Contatos sincronizados da instância (nome do WhatsApp + foto de perfil).
// Usado pelo backfill do chat do CRM pra dar "cara de WhatsApp" (nome/avatar).
export interface EvolutionContact {
  number: string;            // só dígitos
  name: string | null;       // pushName do contato
  pictureUrl: string | null; // URL da foto (expira — tratar como cache)
}

export async function fetchEvolutionContacts(instanceName: string): Promise<EvolutionContact[]> {
  const res = await fetch(`${base()}/chat/findContacts/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ where: {} }),
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = await res.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr: any[] = Array.isArray(data) ? data : (data?.contacts ?? data?.data ?? []);
  const out: EvolutionContact[] = [];
  for (const c of arr) {
    const jid: string = c?.remoteJid ?? c?.id ?? '';
    if (typeof jid !== 'string' || !jid || jid.includes('@g.us')) continue; // grupos fora
    const number = jid.split('@')[0].replace(/\D/g, '');
    if (number.length < 8) continue;
    out.push({
      number,
      name: c?.pushName ?? c?.name ?? null,
      pictureUrl: c?.profilePicUrl ?? c?.profilePictureUrl ?? null,
    });
  }
  return out;
}

// Foto de perfil de UM número (fallback quando o findContacts não trouxe).
export async function fetchEvolutionProfilePic(instanceName: string, number: string): Promise<string | null> {
  const res = await fetch(`${base()}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ number }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null) as { profilePictureUrl?: string; profilePicUrl?: string } | null;
  return data?.profilePictureUrl ?? data?.profilePicUrl ?? null;
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

// Surfaces the raw Evolution error body instead of a generic "Bad Request",
// so a failed dispatch tells you exactly why the server rejected it.
async function postEvolution(url: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function sendEvolutionText(
  instanceName: string,
  phone: string,
  message: string,
): Promise<SendResult> {
  const url = `${base()}/message/sendText/${encodeURIComponent(instanceName)}`;
  // This Evolution server (same one the CRM uses) wants the v2 shape with
  // `textMessage: { text }`. Try it first, then fall back to the flat v1 shape
  // for older servers — mirrors the proven path in lib/followup-send.ts.
  const v2 = await postEvolution(url, {
    number: phone,
    options: { delay: 1200, presence: 'composing' },
    textMessage: { text: message },
  });
  if (v2.ok) return v2;

  const v1 = await postEvolution(url, { number: phone, text: message });
  if (v1.ok) return v1;

  return { ok: false, error: v2.error ?? v1.error ?? 'Evolution sendText falhou' };
}

export async function sendEvolutionImage(
  instanceName: string,
  phone: string,
  imageUrl: string,
  caption: string,
): Promise<SendResult> {
  return postEvolution(`${base()}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
    number: phone,
    options: { delay: 1200 },
    mediatype: 'image',
    media: imageUrl,
    caption,
  });
}

export async function checkEvolutionStatus(instanceName: string): Promise<boolean> {
  try {
    const { state } = await getEvolutionState(instanceName);
    return state === 'open';
  } catch {
    return false;
  }
}

// Origem CANÔNICA para URLs de webhook apontadas na Evolution. Antes cada call
// site usava `new URL(req.url).origin` — se um admin acessasse o painel por
// preview/localhost/IP, o webhook da instância era re-apontado pra esse host e o
// inbound de produção morria em silêncio. Env APP_URL (ou NEXT_PUBLIC_APP_URL)
// trava o destino; o origin da request fica só como fallback.
export function webhookOrigin(requestUrl: string): string {
  const canonical = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '');
  if (canonical) return canonical;
  try {
    return new URL(requestUrl).origin;
  } catch {
    return '';
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
