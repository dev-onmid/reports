// Abstraction layer for Z-API and Evolution API inbound webhook payloads

export type WhatsAppProvider = 'zapi' | 'evolution';

export type NormalizedMessage = {
  phone: string;
  fromMe: boolean;
  text: string;
  ctwaClid: string | undefined;
  sourceId: string | undefined;
  pushName: string | undefined;
};

function normalizePhone(raw: string): string {
  return raw.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeZapiPayload(body: any): NormalizedMessage | null {
  const phone = normalizePhone(body.phone ?? body.phoneNumber ?? '');
  if (!phone) return null;
  return {
    phone,
    fromMe: body.fromMe === true,
    text: (body.text?.message ?? body.body ?? '').trim(),
    ctwaClid: body.ctwaClid ?? body.ctwa_clid ?? body.ctwaclid ?? undefined,
    sourceId: body.sourceId ?? body.source_id ?? body.adId ?? undefined,
    pushName: body.senderName ?? body.pushName ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvolutionPayload(body: any): NormalizedMessage | null {
  const data = body.data;
  if (!data?.key) return null;

  const phone = normalizePhone(data.key.remoteJid ?? '');
  if (!phone) return null;

  // Conversation text: plain or extended
  const text: string = (
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    ''
  ).trim();

  // CTWA click ID lives in contextInfo.externalAdReply on Evolution API
  const adReply =
    data.message?.extendedTextMessage?.contextInfo?.externalAdReply ??
    data.contextInfo?.externalAdReply;

  return {
    phone,
    fromMe: data.key.fromMe === true,
    text,
    ctwaClid: adReply?.ctwaClid ?? undefined,
    sourceId: adReply?.sourceId ?? undefined,
    pushName: data.pushName ?? undefined,
  };
}

export function normalizeWebhookPayload(
  provider: WhatsAppProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
): NormalizedMessage | null {
  if (provider === 'evolution') return normalizeEvolutionPayload(body);
  return normalizeZapiPayload(body);
}
