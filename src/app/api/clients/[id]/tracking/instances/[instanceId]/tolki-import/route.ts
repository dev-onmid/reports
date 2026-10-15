import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureCrmMessagesSchema, ensureDefaultFunnel, upsertLeadFromConversation,
} from '@/lib/crm-conversation-sync';
import { salvarMidia } from '@/lib/crm-midia';
import {
  baixarMidiaTolki, lerApiKeyTolki, listarConversasTolki, listarMensagensTolki, placeholderTolki, tipoDeMidiaTolki,
} from '@/lib/tolki';

// Importa o histórico da Tolki (conversas + mensagens) para o CRM, uma página
// de conversas por chamada — a tela chama em laço até `fim`. Só grava: nada de
// conversão, IA ou follow-up (é passado, não evento novo). Dedup por wamid.

export const maxDuration = 300;

const POR_PAGINA_PADRAO = 20;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> },
) {
  const { id: clientId, instanceId } = await params;
  const body = await req.json().catch(() => ({})) as { pagina?: number; por_pagina?: number; dias?: number; midia?: boolean };
  const pagina = Math.max(Number(body.pagina ?? 1), 1);
  const porPagina = Math.min(Math.max(Number(body.por_pagina ?? POR_PAGINA_PADRAO), 1), 50);
  const dias = Math.min(Math.max(Number(body.dias ?? 90), 1), 3650);
  const baixarMidia = body.midia !== false;
  const corte = Date.now() - dias * 86_400_000;

  const pool = makeServerPool();
  try {
    const { rows: [inst] } = await pool.query<{ instance_id: string; tolki_api_key: string | null }>(
      `SELECT instance_id, tolki_api_key FROM public.client_zapi_instances
        WHERE id = $1 AND client_id = $2 AND provider = 'tolki'`,
      [instanceId, clientId],
    );
    if (!inst) return Response.json({ error: 'Instância Tolki não encontrada' }, { status: 404 });
    const apiKey = lerApiKeyTolki(inst.tolki_api_key);
    if (!apiKey) return Response.json({ error: 'Instância sem chave da API da Tolki' }, { status: 400 });

    await ensureDefaultFunnel(pool, clientId);
    await ensureCrmMessagesSchema(pool);

    const lista = await listarConversasTolki(apiKey, pagina, porPagina);
    if (!lista.ok) return Response.json({ error: `Tolki: ${lista.error}` }, { status: 502 });

    let leads = 0, mensagens = 0, repetidas = 0, puladas = 0, foraDoPeriodo = 0;
    for (const conversa of lista.data.conversas) {
      const quando = conversa.lastMessageAt ?? conversa.createdAt;
      if (quando && new Date(quando).getTime() < corte) { foraDoPeriodo++; continue; }
      const phone = (conversa.contact?.phone ?? '').replace(/\D/g, '');
      if (!phone) { puladas++; continue; } // webchat / contato sem número

      const { id: leadId } = await upsertLeadFromConversation(pool, {
        clientId,
        phone,
        name: conversa.contact?.name ?? undefined,
        instanceId: inst.instance_id,
      });
      leads++;

      for (let p = 1; p <= 50; p++) {
        const msgs = await listarMensagensTolki(apiKey, conversa.id, p, 100);
        if (!msgs.ok) break;
        for (const m of msgs.data) {
          const tipoMidia = tipoDeMidiaTolki(m.type, m.mediaMimeType);
          let text = placeholderTolki(m.type, m.body);
          let tipo = 'texto';
          if (tipoMidia && baixarMidia && m.mediaUrl) {
            const baixada = await baixarMidiaTolki(m.mediaUrl);
            const salva = baixada
              ? await salvarMidia(pool, {
                  clientId, leadId, bytes: baixada.bytes, mime: m.mediaMimeType ?? baixada.mime,
                  origem: m.direction === 'out' ? 'enviada' : 'recebida',
                }).catch(() => null)
              : null;
            if (salva) { text = salva.url; tipo = tipoMidia; }
          }
          if (!text) { puladas++; continue; }
          const externalId = m.externalId ?? `tolki:${m.id}`;
          const r = await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, tipo, external_id, created_at, whatsapp_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
             ON CONFLICT DO NOTHING`,
            [leadId, clientId, m.direction, text, tipo, externalId, m.createdAt, m.direction === 'out' ? (m.status ?? 'sent') : null],
          ).catch(err => { console.error('[tolki-import insert]', err instanceof Error ? err.message : err); return { rowCount: 0 }; });
          if ((r.rowCount ?? 0) > 0) mensagens++; else repetidas++;
        }
        if (msgs.data.length < 100) break;
      }

      await pool.query(
        `UPDATE public.crm_leads l
            SET whatsapp_last_message_text = u.text,
                whatsapp_last_direction = u.direction,
                whatsapp_last_message_at = u.created_at,
                updated_at = NOW()
           FROM (SELECT text, direction, created_at FROM public.crm_messages
                  WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1) u
          WHERE l.id = $1
            AND (l.whatsapp_last_message_at IS NULL OR l.whatsapp_last_message_at < u.created_at)`,
        [leadId],
      ).catch(() => null);
    }

    const total = lista.data.total;
    const fim = pagina * porPagina >= total || lista.data.conversas.length === 0;
    return Response.json({ ok: true, pagina, por_pagina: porPagina, total, fim, leads, mensagens, repetidas, puladas, fora_do_periodo: foraDoPeriodo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tolki-import]', msg);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
