// Abstraction layer for Z-API and Evolution API inbound webhook payloads

export type WhatsAppProvider = 'zapi' | 'evolution';

export type NormalizedMessage = {
  phone: string;
  fromMe: boolean;
  text: string;
  timestamp: unknown;
  externalId: string | undefined;
  ctwaClid: string | undefined;
  sourceId: string | undefined;
  pushName: string | undefined;
  profilePictureUrl: string | undefined;
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
    timestamp: body.momment ?? body.moment ?? body.timestamp ?? body.messageTimestamp ?? undefined,
    externalId: body.messageId ?? body.id ?? undefined,
    ctwaClid: body.ctwaClid ?? body.ctwa_clid ?? body.ctwaclid ?? undefined,
    sourceId: body.sourceId ?? body.source_id ?? body.adId ?? undefined,
    pushName: body.senderName ?? body.pushName ?? undefined,
    profilePictureUrl: body.profilePicUrl ?? body.profilePictureUrl ?? body.photo ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEvolutionText(message: Record<string, any>): string {
  if (!message) return '';
  if (message.conversation) return String(message.conversation).trim();
  if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text).trim();
  if (message.imageMessage?.caption) return `[Imagem] ${message.imageMessage.caption}`;
  if (message.imageMessage) return '[Imagem]';
  if (message.audioMessage) return '[Áudio]';
  if (message.videoMessage?.caption) return `[Vídeo] ${message.videoMessage.caption}`;
  if (message.videoMessage) return '[Vídeo]';
  if (message.documentMessage?.fileName) return `[Doc] ${message.documentMessage.fileName}`;
  if (message.documentMessage) return '[Documento]';
  if (message.stickerMessage) return '[Sticker]';
  if (message.locationMessage) return `[Localização] ${message.locationMessage.degreesLatitude ?? ''}, ${message.locationMessage.degreesLongitude ?? ''}`;
  if (message.reactionMessage?.text) return `[Reação] ${message.reactionMessage.text}`;
  if (message.contactMessage?.displayName) return `[Contato] ${message.contactMessage.displayName}`;
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvolutionPayload(body: any): NormalizedMessage | null {
  const data = body.data;
  if (!data?.key) return null;

  const phone = normalizePhone(data.key.remoteJid ?? '');
  if (!phone) return null;

  const text = extractEvolutionText(data.message ?? {});

  // CTWA click ID lives in contextInfo.externalAdReply on Evolution API
  const adReply =
    data.message?.extendedTextMessage?.contextInfo?.externalAdReply ??
    data.contextInfo?.externalAdReply;

  return {
    phone,
    fromMe: data.key.fromMe === true,
    text,
    timestamp: data.messageTimestamp ?? data.message?.messageTimestamp ?? undefined,
    externalId: typeof data.key.id === 'string' ? data.key.id : undefined,
    ctwaClid: adReply?.ctwaClid ?? undefined,
    sourceId: adReply?.sourceId ?? undefined,
    pushName: data.pushName ?? undefined,
    profilePictureUrl: data.profilePicUrl ?? data.profilePictureUrl ?? data.picture ?? undefined,
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
