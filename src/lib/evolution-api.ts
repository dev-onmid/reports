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

export async function sendEvolutionDocument(
  instanceName: string,
  phone: string,
  documentBase64: string,
  fileName: string,
  caption?: string,
): Promise<SendResult> {
  // Evolution manda documento pelo mesmo /message/sendMedia, com mediatype 'document'.
  // O media aceita base64 puro (sem prefixo data:); fileName define o nome no chat.
  const ext = (fileName.split('.').pop() || 'pdf').toLowerCase();
  const mimeByExt: Record<string, string> = {
    pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return postEvolution(`${base()}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
    number: phone,
    options: { delay: 1200 },
    mediatype: 'document',
    mimetype: mimeByExt[ext] ?? 'application/octet-stream',
    media: documentBase64,
    fileName,
    caption: caption ?? '',
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

// Webhook atualmente configurado na instância (pra detectar URL antiga/preview e curar).
// Valida números contra o WhatsApp (existe/não existe) — usado no upload de
// listas de disparo pra impedir que número quebrado entre na campanha.
// Best-effort: falha da API (timeout, instância off) devolve null e o caller
// segue SEM validação (nunca bloquear a criação por indisponibilidade).
export async function checkWhatsappNumbers(
  instanceName: string,
  numbers: string[],
): Promise<Map<string, boolean> | null> {
  const result = new Map<string, boolean>();
  try {
    for (let i = 0; i < numbers.length; i += 100) {
      const batch = numbers.slice(i, i + 100);
      const res = await fetch(`${base()}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ numbers: batch }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return result.size > 0 ? result : null;
      const rows = await res.json().catch(() => null) as Array<{ number?: string; exists?: boolean; jid?: string }> | null;
      if (!Array.isArray(rows)) return result.size > 0 ? result : null;
      for (const r of rows) {
        const digits = String(r.number ?? r.jid ?? '').split('@')[0].replace(/\D/g, '');
        if (digits) result.set(digits, r.exists === true);
      }
    }
    return result;
  } catch {
    return result.size > 0 ? result : null;
  }
}

export async function getEvolutionWebhook(instanceName: string): Promise<{ url: string | null; enabled: boolean }> {
  const res = await fetch(`${base()}/webhook/find/${encodeURIComponent(instanceName)}`, {
    headers: headers(),
  }).catch(() => null);
  if (!res?.ok) return { url: null, enabled: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json().catch(() => null) as any;
  const wh = data?.webhook ?? data;
  return { url: wh?.url ?? null, enabled: wh?.enabled === true };
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

export interface EvolutionInstanceSummary {
  name: string;
  connectionStatus: string | null;
  profileName?: string | null;
  ownerJid?: string | null;
}

/**
 * Todas as instâncias que existem no servidor Evolution AGORA.
 *
 * ⚠️ `connectionStatus` é o campo PERSISTIDO da Evolution — instância que sumiu
 * do servidor simplesmente não vem nesta lista (não vem como "desconectada").
 * Quem consome precisa tratar ausência e desconexão como coisas diferentes:
 * a primeira significa que o vínculo aponta pro vazio.
 */
export async function fetchEvolutionInstances(): Promise<EvolutionInstanceSummary[]> {
  const res = await fetch(`${base()}/instance/fetchInstances`, {
    headers: headers(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Evolution API ${res.status}`);
  const json = await res.json() as unknown;
  const list = Array.isArray(json) ? json : [];
  return list.map((i) => {
    const r = i as Record<string, unknown>;
    const inner = (r.instance ?? {}) as Record<string, unknown>;
    return {
      name: String(r.name ?? inner.instanceName ?? r.instanceName ?? ''),
      connectionStatus: (r.connectionStatus ?? inner.state ?? r.status ?? null) as string | null,
      profileName: (r.profileName ?? null) as string | null,
      ownerJid: (r.ownerJid ?? null) as string | null,
    };
  }).filter(i => i.name.length > 0);
}

// ─── Extrator de números (Disparos → Extrator) ────────────────────────────────
// O Extrator nasceu Z-API-only; estes helpers dão o MESMO material pela Evolution
// (que hoje é o provider principal), no formato que a tela já sabe renderizar.

export interface EvolutionGroupSummary {
  jid: string;      // 1203...@g.us
  subject: string;
  size: number | null;
}

export interface EvolutionGroupMember {
  phone: string;    // só dígitos
  name: string;
  admin: boolean;
}

function digitsFromJid(jid: unknown): string {
  return String(jid ?? '').split('@')[0].replace(/\D/g, '');
}

/** Grupos da instância. `getParticipants=false` mantém a resposta leve. */
export async function fetchEvolutionGroups(instanceName: string): Promise<EvolutionGroupSummary[]> {
  const res = await fetch(
    `${base()}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
    { headers: headers(), cache: 'no-store' },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Evolution API ${res.status}: ${text.slice(0, 200)}`);
  }
  const raw = await res.json() as unknown;
  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw as Array<Record<string, unknown>>
    : (((raw as Record<string, unknown>)?.groups ?? []) as Array<Record<string, unknown>>);
  return list
    .map((g) => ({
      jid: String(g.id ?? ''),
      subject: String(g.subject ?? g.name ?? ''),
      size: typeof g.size === 'number' ? g.size
        : Array.isArray(g.participants) ? (g.participants as unknown[]).length : null,
    }))
    .filter((g) => g.jid.length > 0)
    .sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
}

/**
 * Participantes de UM grupo. O endpoint dedicado (`/group/participants`) é o
 * caminho normal; se a build da Evolution não o expuser, cai no fetchAllGroups
 * com participantes e filtra o grupo pedido.
 */
export async function fetchEvolutionGroupParticipants(
  instanceName: string,
  groupJid: string,
): Promise<EvolutionGroupMember[]> {
  const jid = groupJid.replace(/-group$/i, '').includes('@g.us')
    ? groupJid
    : `${groupJid.replace(/-group$/i, '')}@g.us`;

  // ⚠️ Em instância no modo LID o `id` do participante é o LID (identificador
  // oculto), NÃO o telefone — mandar disparo pra ele seria mandar pra lixo.
  // O telefone real vem em `phoneNumber` (…@s.whatsapp.net).
  const parse = (arr: unknown): EvolutionGroupMember[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        const admin = r.admin;
        const fonte = [r.phoneNumber, r.jid, r.number, r.id]
          .find((v) => typeof v === 'string' && !String(v).includes('@lid'));
        return {
          phone: digitsFromJid(fonte),
          name: String(r.name ?? r.pushName ?? r.notify ?? ''),
          admin: admin === 'admin' || admin === 'superadmin' || admin === true,
        };
      })
      .filter((m) => m.phone.length >= 8);
  };

  const direct = await fetch(
    `${base()}/group/participants/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(jid)}`,
    { headers: headers(), cache: 'no-store' },
  ).catch(() => null);
  if (direct?.ok) {
    const data = await direct.json().catch(() => null) as Record<string, unknown> | null;
    const members = parse(data?.participants ?? data);
    if (members.length > 0) return members;
  }

  const all = await fetch(
    `${base()}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=true`,
    { headers: headers(), cache: 'no-store' },
  ).catch(() => null);
  if (all?.ok) {
    const raw = await all.json().catch(() => null) as unknown;
    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw as Array<Record<string, unknown>>
      : (((raw as Record<string, unknown>)?.groups ?? []) as Array<Record<string, unknown>>);
    const found = list.find((g) => String(g.id ?? '') === jid);
    if (found) return parse(found.participants);
  }

  return [];
}

/**
 * Conversas individuais (não-grupo). Varre as variações de endpoint das
 * versões da Evolution — mesma estratégia do import do inbox do CRM.
 *
 * ⚠️ Instância em modo LID devolve `@lid` no lugar do telefone. O LID passa
 * num filtro de "8 a 15 dígitos" e viraria número de disparo inválido, então
 * ele volta SEPARADO (`lid`) com `phone: null` — quem chama decide se resolve.
 */
export interface EvolutionChatContact {
  phone: string | null;
  lid: string | null;
  name: string;
}

export async function fetchEvolutionChatContacts(
  instanceName: string,
  limit = 500,
): Promise<EvolutionChatContact[]> {
  const inst = encodeURIComponent(instanceName);
  const attempts: Array<{ url: string; method: string; body?: string }> = [
    { url: `${base()}/chat/findChats/${inst}`, method: 'POST', body: JSON.stringify({ where: {}, skip: 0, take: limit }) },
    { url: `${base()}/chat/findChats/${inst}`, method: 'POST', body: JSON.stringify({ where: {} }) },
    { url: `${base()}/chat/findChats/${inst}`, method: 'GET' },
    { url: `${base()}/chat/findContacts/${inst}`, method: 'POST', body: JSON.stringify({ where: {} }) },
    { url: `${base()}/chat/findContacts/${inst}`, method: 'GET' },
  ];

  for (const { url, method, body } of attempts) {
    const opts: RequestInit = { method, headers: headers(), cache: 'no-store' };
    if (body) opts.body = body;
    const res = await fetch(url, opts).catch(() => null);
    if (!res?.ok) continue;
    const json = await res.json().catch(() => null) as unknown;
    const obj = (json ?? {}) as Record<string, unknown>;
    const records: Array<Record<string, unknown>> = Array.isArray(json)
      ? json as Array<Record<string, unknown>>
      : (obj.chats as Array<Record<string, unknown>>)
        ?? (obj.contacts as Array<Record<string, unknown>>)
        ?? (obj.records as Array<Record<string, unknown>>)
        ?? (obj.data as Array<Record<string, unknown>>)
        ?? [];
    if (!Array.isArray(records) || records.length === 0) continue;

    const seen = new Set<string>();
    const out: EvolutionChatContact[] = [];
    for (const r of records) {
      const jid = String(r.remoteJid ?? r.jid ?? '');
      if (!jid || jid.includes('@g.us') || jid.includes('broadcast') || jid.includes('@newsletter')) continue;

      const alt = String(r.remoteJidAlt ?? r.phoneNumber ?? '');
      const real = [jid, alt].find((v) => v && !v.includes('@lid'));
      const phone = real ? digitsFromJid(real) : null;
      const lid = jid.includes('@lid') ? jid.split('@')[0] : null;
      if (!phone && !lid) continue;
      if (phone && phone.length < 8) continue;

      const chave = phone ?? `lid:${lid}`;
      if (seen.has(chave)) continue;
      seen.add(chave);

      const nome = r.pushName ?? r.name ?? r.profileName ?? null;
      out.push({
        phone: phone ?? null,
        lid,
        name: typeof nome === 'string' && nome.trim() && nome !== lid ? nome : (phone ?? ''),
      });
    }
    if (out.length > 0) return out;
  }

  return [];
}
