import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const BASE = 'https://api.z-api.io/instances';

function normalizeGroupId(raw: string): string {
  return raw.replace(/-group$/i, '').replace(/@g\.us$/, '');
}

function isErrorBody(body: unknown): boolean {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    return typeof obj.error === 'string' || typeof obj.message === 'string';
  }
  return false;
}

async function tryFetch(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text().catch(() => '');
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body, text };
}

function extractMembers(body: unknown): Array<Record<string, unknown>> | null {
  if (isErrorBody(body)) return null;
  if (Array.isArray(body) && body.length > 0) return body as Array<Record<string, unknown>>;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['participants', 'value', 'members', 'data']) {
      if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0)
        return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return null;
}

function buildAttempts(base: string, stripped: string, withSuffix: string, raw: string): string[] {
  // Try different endpoints × different phone formats
  // Note: @g.us sent both URL-encoded (%40) and literal (@) since Z-API behaves inconsistently
  const endpoints = ['group-members', 'group-participants', 'group-metadata'];
  const params = ['phone', 'groupId'];
  const values = [
    withSuffix,                          // 120363427351645831@g.us
    stripped,                            // 120363427351645831
    raw,                                 // 120363427351645831-group (as-is from chats)
    `${stripped}-group`,                 // explicit -group suffix
  ];

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const endpoint of endpoints) {
    for (const param of params) {
      for (const value of values) {
        // Try with encodeURIComponent (standard) and without encoding @ (some APIs need literal @)
        const encoded = `${base}/${endpoint}?${param}=${encodeURIComponent(value)}`;
        const literal = `${base}/${endpoint}?${param}=${value}`;
        for (const url of [encoded, literal]) {
          if (!seen.has(url)) { seen.add(url); urls.push(url); }
        }
      }
    }
  }
  return urls;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const groupId = searchParams.get('groupId');

  if (!clientId || !groupId) {
    return Response.json({ error: 'clientId e groupId são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1`,
      [clientId],
    );
    if (rows.length === 0) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });

    const { instance_id, token, security_token } = rows[0] as {
      instance_id: string; token: string; security_token: string | null;
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (security_token) headers['Client-Token'] = security_token;

    const base = `${BASE}/${instance_id}/token/${token}`;
    const stripped = normalizeGroupId(groupId);
    const withSuffix = `${stripped}@g.us`;

    const attempts = buildAttempts(base, stripped, withSuffix, groupId);
    const logs: string[] = [];

    for (const url of attempts) {
      const { ok, status, body, text } = await tryFetch(url, headers);
      const path = url.replace(base, '');
      const preview = text.slice(0, 80).replace(/\n/g, ' ');
      logs.push(`[${status}] ${path} → ${preview}`);

      if (ok) {
        const members = extractMembers(body);
        if (members) {
          const result = members.map((m) => ({
            phone: String(m.phone ?? m.id ?? m.jid ?? '')
              .replace('@s.whatsapp.net', '')
              .replace('@c.us', '')
              .replace(/@g\.us$/, '')
              .replace(/\D/g, ''),
            name: String(m.name ?? m.pushname ?? m.notify ?? ''),
            admin: m.admin === true || m.isSuperAdmin === true || m.isAdmin === true,
          })).filter((m) => m.phone.length >= 8);

          if (result.length > 0) return Response.json(result);
        }
      }
    }

    return Response.json({
      error: `Nenhum membro encontrado.\n${logs.slice(0, 10).join('\n')}`,
    }, { status: 502 });
  } finally {
    await pool.end();
  }
}
