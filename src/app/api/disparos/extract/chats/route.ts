import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { fetchEvolutionGroups, fetchEvolutionChatContacts } from '@/lib/evolution-api';

const BASE = 'https://api.z-api.io/instances';

type ChatItem = {
  phone: string;
  name: string;
  isGroup: boolean;
  membersCount?: number;
  profilePicUrl?: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const type = searchParams.get('type') ?? 'all'; // groups | conversations | all

  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    const { rows } = await pool.query(
      `SELECT instance_id, token, security_token, owner_id, provider FROM public.zapi_clients WHERE id = $1`,
      [clientId],
    );
    if (rows.length === 0) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });
    if (!scope.unrestricted && rows[0].owner_id !== scope.userId) {
      return Response.json({ error: 'Sem permissão para esta instância' }, { status: 403 });
    }

    const { instance_id, token, security_token, provider } = rows[0] as {
      instance_id: string; token: string; security_token: string | null; provider: string | null;
    };

    // Instância Evolution: a API é outra (por NOME da instância). Falar Z-API aqui
    // devolvia "Instance not found" e o Extrator ficava inutilizável no provider
    // que hoje é o principal.
    if (provider === 'evolution') {
      try {
        const result: ChatItem[] = [];
        if (type === 'groups' || type === 'all') {
          const groups = await fetchEvolutionGroups(instance_id);
          result.push(...groups.map((g) => ({
            phone: g.jid,
            name: g.subject,
            isGroup: true,
            membersCount: g.size ?? undefined,
          })));
        }
        let semTelefone = 0;
        if (type === 'conversations' || type === 'all') {
          const chats = await fetchEvolutionChatContacts(instance_id);

          // Instância em modo LID não expõe o telefone da conversa. O LID passaria
          // num filtro de "8 a 15 dígitos" e viraria destino inválido de disparo —
          // então só entra quem TEM telefone, resolvendo pelo que o CRM já gravou.
          const lids = chats.filter((c) => !c.phone && c.lid).map((c) => c.lid as string);
          const porLid = new Map<string, string>();
          if (lids.length > 0) {
            const { rows: leads } = await pool.query<{ whatsapp_lid: string; numero: string }>(
              `SELECT whatsapp_lid, numero FROM public.crm_leads
                WHERE whatsapp_lid = ANY($1::text[]) AND numero IS NOT NULL AND numero <> ''`,
              [lids],
            ).catch(() => ({ rows: [] as Array<{ whatsapp_lid: string; numero: string }> }));
            for (const l of leads) porLid.set(l.whatsapp_lid, l.numero.replace(/\D/g, ''));
          }

          for (const c of chats) {
            const phone = c.phone ?? (c.lid ? porLid.get(c.lid) ?? '' : '');
            if (!phone || phone.length < 8) { semTelefone++; continue; }
            result.push({ phone, name: c.name || phone, isGroup: false });
          }
        }
        return Response.json(result, {
          headers: semTelefone > 0 ? { 'X-Sem-Telefone': String(semTelefone) } : undefined,
        });
      } catch (err) {
        return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (security_token) headers['Client-Token'] = security_token;

    // The /chats endpoint paginates (default page size ~30) — a single call
    // only returns the first page. Page through until Z-API returns a
    // short/empty page, capped to avoid looping forever on a flaky response.
    const pageSize = 100;
    const chats: Array<Record<string, unknown>> = [];
    for (let page = 1; page <= 30; page++) {
      const res = await fetch(
        `${BASE}/${instance_id}/token/${token}/chats?page=${page}&pageSize=${pageSize}`,
        { headers },
      );

      if (!res.ok) {
        if (page === 1) {
          const text = await res.text().catch(() => '');
          return Response.json({ error: `Z-API error ${res.status}: ${text}` }, { status: 502 });
        }
        break;
      }

      const raw = await res.json() as unknown;
      // Z-API may return array directly or { value: [...] }
      const batch: Array<Record<string, unknown>> = Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>)
        : Array.isArray((raw as Record<string, unknown>).value)
          ? ((raw as Record<string, unknown>).value as Array<Record<string, unknown>>)
          : [];

      chats.push(...batch);
      if (batch.length < pageSize) break;
    }

    const seen = new Set<string>();
    const deduped = chats.filter((c) => {
      const key = String(c.phone ?? c.id ?? '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const filtered = deduped.filter((c) => {
      if (type === 'groups') return c.isGroup === true;
      if (type === 'conversations') return c.isGroup !== true;
      return true;
    });

    const result = filtered.map((c) => ({
      phone: String(c.phone ?? c.id ?? ''),
      name: String(c.name ?? c.pushname ?? c.phone ?? ''),
      isGroup: c.isGroup === true,
      membersCount: typeof c.participantsCount === 'number' ? c.participantsCount : undefined,
      profilePicUrl: typeof c.profilePicUrl === 'string' ? c.profilePicUrl : undefined,
    }));

    return Response.json(result);
  } finally {
    await pool.end();
  }
}
