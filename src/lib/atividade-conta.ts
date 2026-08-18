/**
 * Atividades da CONTA DE ANÚNCIO (quem mexeu no quê, direto das plataformas).
 *
 * Extraído da rota /api/clients/[id]/activity para servir DOIS consumidores
 * com a mesma busca: a aba Histórico do cliente (ao vivo) e o resumo diário
 * automático do Histórico (cron compila D-1 em um registro por canal).
 *
 * Meta: `act_X/activities` (traz actor_name e o evento já traduzido).
 * Google: GAQL `change_event` (user_email + operação + tipo de recurso).
 * Tudo best-effort: conta sem acesso devolve lista vazia, nunca lança.
 */

import type { Pool } from 'pg';
import { google as googleapis } from 'googleapis';
import { getFreshMetaToken } from '@/lib/meta-token';

export type EventoConta = {
  plataforma: 'meta' | 'google';
  descricao: string;
  autor: string;
  criadoEm: string;
  campanha?: string;
  tipo?: string;
};

export async function buscarAtividadesMeta(
  pool: Pool, clientId: string, since: Date,
): Promise<EventoConta[]> {
  const eventos: EventoConta[] = [];
  try {
    const { rows: metaLinks } = await pool.query<{ account_id: string; connection_id: string | null }>(
      `SELECT account_id, connection_id FROM public.client_account_links
        WHERE client_id = $1 AND platform = 'meta_ads'`,
      [clientId],
    );
    if (metaLinks.length === 0) return eventos;

    const { rows: metaConns } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE id = $1`,
      [metaLinks[0].connection_id],
    );
    if (!metaConns[0]) {
      const { rows: g } = await pool
        .query(`SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'`)
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (g[0]) metaConns.push({ ...g[0], id: 'global' });
    }
    if (!metaConns[0]) return eventos;

    const token = await getFreshMetaToken(metaConns[0]);
    const sinceUnix = Math.floor(since.getTime() / 1000);
    await Promise.allSettled(metaLinks.map(async (link) => {
      const acctNode = link.account_id.startsWith('act_') ? link.account_id : `act_${link.account_id}`;
      const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/activities`);
      url.searchParams.set('fields', 'actor_name,event_type,object_id,object_name,object_type,translated_event_type,date_time_in_timezone');
      url.searchParams.set('since', String(sinceUnix));
      url.searchParams.set('limit', '50');
      url.searchParams.set('access_token', token);
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data = await res.json() as { data?: Array<Record<string, string | undefined>> };
      for (const item of data.data ?? []) {
        eventos.push({
          plataforma: 'meta',
          tipo: item.event_type ?? 'change',
          descricao: item.translated_event_type ?? item.event_type ?? 'Alteração',
          autor: item.actor_name ?? 'Usuário Meta',
          campanha: item.object_type === 'CAMPAIGN' ? item.object_name : undefined,
          criadoEm: item.date_time_in_timezone ?? '',
        });
      }
    }));
  } catch { /* best-effort */ }
  return eventos;
}

const OP_LABEL: Record<string, string> = {
  CREATE: 'criou', UPDATE: 'alterou', REMOVE: 'removeu', ENABLE: 'ativou', PAUSE: 'pausou',
};

export async function buscarMudancasGoogle(
  pool: Pool, clientId: string, since: Date,
): Promise<EventoConta[]> {
  const eventos: EventoConta[] = [];
  try {
    const { rows: googleLinks } = await pool.query<{ account_id: string }>(
      `SELECT account_id FROM public.client_account_links
        WHERE client_id = $1 AND platform = 'google_ads'`,
      [clientId],
    );
    if (googleLinks.length === 0) return eventos;

    const { rows: googleConns } = await pool.query(
      `SELECT * FROM public.google_connections WHERE status = 'connected'`,
    );
    const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
    const sinceDate = since.toISOString().replace('T', ' ').slice(0, 19);

    await Promise.allSettled(googleConns.map(async (conn) => {
      const oauth2 = new googleapis.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2.setCredentials({ refresh_token: conn.refresh_token });
      let accessToken = conn.access_token;
      try {
        if (!conn.token_expiry || new Date(conn.token_expiry).getTime() < Date.now() + 5 * 60 * 1000) {
          const { credentials } = await oauth2.refreshAccessToken();
          accessToken = credentials.access_token ?? accessToken;
        }
      } catch { /* usa o existente */ }

      await Promise.allSettled(googleLinks.map(async (link) => {
        const accountId = link.account_id.replace(/\D/g, '');
        const res = await fetch(`https://googleads.googleapis.com/v24/customers/${accountId}/googleAds:search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `SELECT change_event.change_date_time, change_event.change_resource_type,
                           change_event.user_email, change_event.resource_change_operation,
                           change_event.new_resource, change_event.old_resource
                    FROM change_event
                    WHERE change_event.change_date_time >= '${sinceDate}'
                      AND change_event.change_resource_type IN ('CAMPAIGN','AD_GROUP','AD','AD_GROUP_AD')
                    ORDER BY change_event.change_date_time DESC LIMIT 50`,
          }),
        });
        if (!res.ok) return;
        const data = await res.json() as { results?: Array<{ changeEvent?: Record<string, string | undefined> }> };
        for (const row of data.results ?? []) {
          const ev = row.changeEvent ?? {};
          const type = ev.changeResourceType ?? 'RESOURCE';
          const op = ev.resourceChangeOperation ?? 'UPDATE';
          eventos.push({
            plataforma: 'google',
            tipo: `${op}_${type}`.toLowerCase(),
            descricao: `${OP_LABEL[op] ?? op} ${type.toLowerCase().replace('_', ' ')}`,
            autor: ev.userEmail ?? 'Usuário Google',
            criadoEm: ev.changeDateTime ?? '',
          });
        }
      }));
    }));
  } catch { /* best-effort */ }
  return eventos;
}
