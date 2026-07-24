import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { upsertLeadFromConversation } from '@/lib/crm-conversation-sync';
import { recordTrackingEvent } from '@/lib/lead-tracking';
import { resolveMetaAdHierarchy } from '@/lib/meta-ad-resolver';
import { regiaoFromPhone } from '@/lib/ddd-regioes';

// Backfill retroativo de atribuição CTWA (anúncio de WhatsApp da Meta).
// Contexto: até 2026-07-24 o webhook descartava TODA mensagem real (bug do
// status DELIVERY_ACK) — os cliques em anúncio chegaram com externalAdReply
// (ctwaClid + sourceId) e foram perdidos. As mensagens seguem ARMAZENADAS na
// Evolution: esta rota varre o histórico de cada instância, acha as mensagens
// com marcação de anúncio e re-aplica a atribuição no lead (first-touch:
// nunca sobrescreve o que já existe; origin só muda se estiver 'organic').
// Idempotente — rodar de novo não duplica nada (COALESCE + dedup por external_id).

export const maxDuration = 300;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAdReply(obj: any, depth = 0): any | null {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  const ad = obj.externalAdReply;
  if (ad && (ad.ctwaClid || ad.sourceId || ad.sourceType === 'ad')) return ad;
  for (const k of Object.keys(obj)) {
    const r = findAdReply(obj[k], depth + 1);
    if (r) return r;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMessageRecords(raw: any): Array<Record<string, any>> {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.messages?.records)) return raw.messages.records;
  if (Array.isArray(raw?.messages)) return raw.messages;
  if (Array.isArray(raw?.records)) return raw.records;
  return [];
}

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  if (valid.length === 0 || !valid.includes(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 60), 1), 120);
  const cutoffSec = Math.floor(Date.now() / 1000) - days * 86_400;
  const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
  const apikey = process.env.EVOLUTION_API_KEY ?? '';
  if (!base || !apikey) {
    return Response.json({ ok: false, error: 'EVOLUTION_API_URL/KEY não configurados' }, { status: 500 });
  }

  const started = Date.now();
  const pool = makeServerPool();
  const results: Array<Record<string, unknown>> = [];

  try {
    const { rows: instances } = await pool.query<{ client_id: string; instance_id: string }>(
      `SELECT client_id, instance_id FROM public.client_zapi_instances
        WHERE ativo = TRUE AND provider = 'evolution'`,
    );

    for (const inst of instances) {
      if (Date.now() - started > 240_000) { results.push({ instance: inst.instance_id, skipped: true }); continue; }
      const r = { instance: inst.instance_id, scanned: 0, adMessages: 0, updated: 0, created: 0, hits: [] as Array<Record<string, unknown>> };
      const seen = new Set<string>();

      for (let page = 1; page <= 50; page++) {
        if (Date.now() - started > 240_000) break;
        const res = await fetch(`${base}/chat/findMessages/${encodeURIComponent(inst.instance_id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey },
          body: JSON.stringify({ where: {}, page, offset: 100 }),
          signal: AbortSignal.timeout(30_000),
        }).catch(() => null);
        if (!res?.ok) break;
        const records = extractMessageRecords(await res.json().catch(() => null));
        if (records.length === 0) break;
        r.scanned += records.length;

        let oldestSec = Number.POSITIVE_INFINITY;
        for (const rec of records) {
          const ts = Number(rec.messageTimestamp ?? 0);
          if (ts > 0 && ts < oldestSec) oldestSec = ts;
          if (ts > 0 && ts < cutoffSec) continue;

          const key = rec.key ?? {};
          if (key.fromMe === true) continue;
          const ad = findAdReply(rec);
          if (!ad) continue;
          const msgId = String(key.id ?? '');
          if (!msgId || seen.has(msgId)) continue;
          seen.add(msgId);
          r.adMessages++;

          // Telefone real: remoteJidAlt (modo LID) ou o próprio remoteJid
          const rawRemote = String(key.remoteJid ?? '');
          const altJid = String(key.remoteJidAlt ?? '');
          const isLid = rawRemote.endsWith('@lid');
          const phone = isLid ? digits(altJid) : digits(rawRemote);
          const lid = isLid ? digits(rawRemote) : '';
          if (!phone && !lid) continue;

          const ctwaClid = ad.ctwaClid ? String(ad.ctwaClid) : null;
          const sourceId = ad.sourceId ? String(ad.sourceId) : null;
          const sourceUrl = ad.sourceUrl ?? ad.mediaUrl ?? null;
          const hierarchy = sourceId
            ? await resolveMetaAdHierarchy(pool, inst.client_id, sourceId).catch(() => null)
            : null;
          const campaignName = hierarchy?.campaign_name ?? null;
          const adsetName = hierarchy?.adset_name ?? null;
          const adName = hierarchy?.ad_name ?? ad.title ?? null;
          const creativeName = ad.body ?? null;
          const dddInfo = phone ? regiaoFromPhone(phone) : null;

          // Acha o lead existente (numero real, numero=LID legado ou whatsapp_lid)
          const { rows: [lead] } = await pool.query<{ id: string }>(
            `SELECT id FROM public.crm_leads
              WHERE client_id = $1
                AND (
                  ($2::text <> '' AND NULLIF(regexp_replace(COALESCE(numero,''), '\\D', '', 'g'), '') = $2)
                  OR ($3::text <> '' AND (
                    NULLIF(regexp_replace(COALESCE(numero,''), '\\D', '', 'g'), '') = $3
                    OR whatsapp_lid = $3
                  ))
                )
              ORDER BY COALESCE(updated_at, created_at) DESC
              LIMIT 1`,
            [inst.client_id, phone, lid],
          );

          let leadId = lead?.id;
          if (leadId) {
            await pool.query(
              `UPDATE public.crm_leads SET
                 ctwa_clid     = COALESCE(NULLIF(ctwa_clid, ''), NULLIF($2, '')),
                 source_id     = COALESCE(NULLIF(source_id, ''), NULLIF($3, '')),
                 source_url    = COALESCE(NULLIF(source_url, ''), NULLIF($4, '')),
                 campaign_name = COALESCE(NULLIF(campaign_name, ''), NULLIF($5, '')),
                 adset_name    = COALESCE(NULLIF(adset_name, ''), NULLIF($6, '')),
                 ad_name       = COALESCE(NULLIF(ad_name, ''), NULLIF($7, '')),
                 creative_name = COALESCE(NULLIF(creative_name, ''), NULLIF($8, '')),
                 origin        = CASE WHEN COALESCE(origin, '') IN ('', 'organic') THEN 'meta' ELSE origin END,
                 canal         = CASE WHEN COALESCE(origin, '') IN ('', 'organic') THEN 'Facebook' ELSE canal END,
                 ddd           = COALESCE(NULLIF(ddd, ''), NULLIF($9, '')),
                 regiao_uf     = COALESCE(NULLIF(regiao_uf, ''), NULLIF($10, '')),
                 regiao_cidade = COALESCE(NULLIF(regiao_cidade, ''), NULLIF($11, '')),
                 regiao_fonte  = COALESCE(NULLIF(regiao_fonte, ''), CASE WHEN $9 <> '' THEN 'ddd' ELSE NULL END),
                 first_origin_at = COALESCE(first_origin_at, to_timestamp($12)),
                 updated_at    = NOW()
               WHERE id = $1`,
              [
                leadId, ctwaClid ?? '', sourceId ?? '', sourceUrl ?? '', campaignName ?? '',
                adsetName ?? '', adName ?? '', creativeName ?? '',
                dddInfo?.ddd ?? '', dddInfo?.uf ?? '', dddInfo?.regiao ?? '',
                Number(rec.messageTimestamp ?? Math.floor(Date.now() / 1000)),
              ],
            );
            r.updated++;
          } else {
            const created = await upsertLeadFromConversation(pool, {
              clientId: inst.client_id,
              phone,
              lid: lid || undefined,
              name: rec.pushName ?? undefined,
              lastMessageAt: rec.messageTimestamp ? new Date(Number(rec.messageTimestamp) * 1000).toISOString() : null,
              canal: 'Facebook',
              origin: 'meta',
              ctwaClid,
              sourceId,
              sourceUrl,
              campaignName,
              adsetName,
              adName,
              creativeName,
              instanceId: inst.instance_id,
            });
            leadId = created.id;
            r.created++;
          }

          await recordTrackingEvent(pool, {
            leadId: leadId!,
            clientId: inst.client_id,
            eventType: 'ctwa',
            origin: 'meta',
            canal: 'Facebook',
            externalId: msgId,
            ctwaClid,
            sourceId,
            sourceUrl,
            campaignName,
            adsetName,
            adName,
            creativeName,
            ddd: dddInfo?.ddd ?? null,
            regiaoUf: dddInfo?.uf ?? null,
            regiaoCidade: dddInfo?.regiao ?? null,
            raw: { backfill: true, adReply: ad, key },
          }).catch(() => null);

          r.hits.push({ phone: phone || `lid:${lid}`, campaign: campaignName, ad: adName, ctwa: Boolean(ctwaClid) });
        }

        // Página inteira mais velha que o corte → não há mais o que varrer
        if (oldestSec !== Number.POSITIVE_INFINITY && oldestSec < cutoffSec) break;
      }
      results.push(r);
    }

    const summary = {
      ok: true,
      days,
      tookMs: Date.now() - started,
      totals: {
        scanned: results.reduce((a, r) => a + (Number(r.scanned) || 0), 0),
        adMessages: results.reduce((a, r) => a + (Number(r.adMessages) || 0), 0),
        updated: results.reduce((a, r) => a + (Number(r.updated) || 0), 0),
        created: results.reduce((a, r) => a + (Number(r.created) || 0), 0),
      },
      results,
    };
    console.log('[backfill-ctwa]', JSON.stringify(summary.totals));
    return Response.json(summary);
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
