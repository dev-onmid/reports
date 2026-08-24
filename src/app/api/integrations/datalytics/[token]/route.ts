import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { makeServerPool } from '@/lib/server-db';
import { resolverLeadExistente } from '@/lib/lead-identity';
import { extrairLeadDatalytics, type LeadDatalytics } from '@/lib/datalytics';
import {
  conexaoPorToken, registrarLogDatalytics, ensureDatalyticsSchema,
} from '@/lib/datalytics-server';
import { sinaisDoStatus } from '@/lib/importacao-origem';
import { classificarEtapa, normalizarEtiqueta } from '@/lib/funil-etapas';
import { ensureDefaultFunnel, getFirstFunnelStageLabel } from '@/lib/crm-conversation-sync';
import {
  applyLeadAttribution, recordTrackingEvent, originFromTracking, type MergedTracking,
} from '@/lib/lead-tracking';
import { regiaoFromPhone } from '@/lib/ddd-regioes';
import { dispararEventosPorStatus } from '@/lib/conversions';

/**
 * Receptor do webhook do Datalytics (CRM externo) — um token POR CLIENTE.
 *
 * O usuário cola `https://reports.onmid.app/api/integrations/datalytics/{token}`
 * no "Nova integração" do Datalytics: uma integração "Lead criado" + uma
 * "Etapa do lead atualizada" POR etapa, todas com a MESMA URL — aqui um único
 * handler trata tudo (etapa presente = mudança de etapa; ausente = lead novo),
 * porque o shape exato do payload deles é desconhecido e o campo de evento
 * pode nem vir.
 *
 * Rota é PUBLIC_PREFIX no proxy — o token de 48 hex é a credencial.
 *
 * Filosofia de resposta (espelha o webhook genérico): payload ruim → 200 com
 * ok:false (retry não conserta payload; política de retry deles é desconhecida
 * e o Cardápio Web ensina que provedores PAUSAM webhook após N falhas). Erro
 * NOSSO (banco) → 500, retry bem-vindo. Tudo vai pro datalytics_log com o
 * payload CRU — é como se descobre o shape real depois do "Testar requisição".
 */
export const maxDuration = 60;

async function ensureColunasLead(pool: ReturnType<typeof makeServerPool>) {
  // Colunas que o INSERT/UPDATE daqui usa e que outros ensures criam por ALTER
  // (instalação nova pode não ter passado por eles ainda).
  await pool.query(`
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS observacao TEXT,
      ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
      ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS agendou BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS compareceu BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS external_id TEXT
  `).catch(() => {});
}

/**
 * Espelha a etapa no Kanban: se o funil do lead ainda não tem uma coluna com
 * esse rótulo (comparação sem acento/caixa), cria — já classificada pro Funil
 * de Performance. Decisão do Matheus: lead nunca some do board por causa de
 * etapa que só existe no Datalytics ("Follow 2" etc.).
 */
async function espelharEtapa(
  pool: ReturnType<typeof makeServerPool>, clientId: string, funnelId: string, label: string,
) {
  const { rows } = await pool.query<{ label: string }>(
    `SELECT label FROM public.crm_stages WHERE funnel_id = $1`,
    [funnelId],
  );
  const alvo = normalizarEtiqueta(label);
  if (rows.some(r => normalizarEtiqueta(r.label) === alvo)) return;
  await pool.query(
    `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
     SELECT $1, $2, $3, '#94a3b8', COALESCE(MAX(position), -1) + 1, $4
       FROM public.crm_stages WHERE funnel_id = $1`,
    [funnelId, clientId, label, classificarEtapa(label)],
  );
}

type ResultadoUpsert = {
  leadId: string;
  criado: boolean;
  statusAnterior: string | null;
  statusNovo: string;
};

async function upsertLead(
  pool: ReturnType<typeof makeServerPool>, clientId: string, lead: LeadDatalytics,
): Promise<ResultadoUpsert> {
  await ensureColunasLead(pool);

  // makeServerPool é max:1 — BEGIN/lock via pool.query ficam na MESMA conexão
  // (mesmo padrão de upsertLeadFromConversation). O lock serializa o "Lead
  // criado" e o "Etapa atualizada" que o Datalytics manda quase juntos.
  await pool.query('BEGIN');
  try {
    await pool.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`datalytics:${clientId}:${lead.telefone}`],
    );

    const funnelId = await ensureDefaultFunnel(pool, clientId);

    // Régua ÚNICA de identidade (lead-identity.ts): telefone (BR e estrangeiro),
    // id do negócio, e-mail.
    // ⚠️ Antes isto carregava TODOS os leads do cliente pra memória a cada
    // webhook e comparava em JS — com 27 mil leads na base, uma varredura
    // inteira por mensagem recebida.
    const achado = await resolverLeadExistente(pool, clientId, {
      telefone: lead.telefoneBruto ?? lead.telefone,
      negocioExternoId: lead.idExterno,
      email: lead.email,
    });
    let match: { id: string; status: string | null; funnel_id: string | null } | null = null;
    if (achado) {
      const { rows: [row] } = await pool.query<{ id: string; status: string | null; funnel_id: string | null }>(
        `SELECT id, status, funnel_id FROM public.crm_leads WHERE id = $1`, [achado.id],
      );
      match = row ?? null;
    }

    const labelEtapa = lead.etapa && 'label' in lead.etapa ? lead.etapa.label : null;

    if (match) {
      const statusNovo = labelEtapa ?? match.status ?? '';
      const sinais = sinaisDoStatus(labelEtapa ?? '');
      const leadFunnel = match.funnel_id ?? funnelId;
      await pool.query(
        `UPDATE public.crm_leads SET
           -- Etapa: o Datalytics é a fonte de verdade — SOBRESCREVE (exceção
           -- deliberada ao fill-blanks; sem etapa no payload, status fica).
           status = COALESCE($2, status),
           -- Booleans só AVANÇAM: retroceder etapa lá não desfaz agendamento,
           -- presença nem venda que já aconteceram aqui.
           agendou = COALESCE(agendou, FALSE) OR $3,
           compareceu = COALESCE(compareceu, FALSE) OR $4,
           fechou = COALESCE(fechou, FALSE) OR $5,
           valor_rs = COALESCE($6, valor_rs),
           revenue = COALESCE($6, revenue),
           -- Identidade: só preenche o que está VAZIO — quem viu o lead chegar
           -- (WhatsApp/planilha) sabe disso melhor que o webhook.
           nome = COALESCE(NULLIF(nome, ''), $7),
           email = COALESCE(NULLIF(email, ''), $8),
           city = COALESCE(NULLIF(city, ''), $9),
           observacao = COALESCE(NULLIF(observacao, ''), $10),
           external_id = COALESCE(external_id, $11),
           funnel_id = COALESCE(funnel_id, $12),
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          match.id, labelEtapa, sinais.agendou, sinais.compareceu, sinais.fechou,
          lead.valor, lead.nome, lead.email, lead.cidade, lead.observacao,
          lead.idExterno, funnelId,
        ],
      );
      if (labelEtapa) await espelharEtapa(pool, clientId, leadFunnel, labelEtapa);
      await pool.query('COMMIT');
      return { leadId: match.id, criado: false, statusAnterior: match.status, statusNovo };
    }

    const status = labelEtapa ?? await getFirstFunnelStageLabel(pool, funnelId);
    const sinais = sinaisDoStatus(status);
    const now = new Date();
    const { rows: [novo] } = await pool.query<{ id: string }>(
      `INSERT INTO public.crm_leads
         (client_id, mes, data, nome, numero, canal, origin, observacao, status,
          funnel_id, email, city, valor_rs, revenue, agendou, compareceu, fechou, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        clientId,
        `${now.toLocaleString('pt-BR', { month: 'short' })}/${now.getFullYear()}`,
        now.toISOString().slice(0, 10),
        lead.nome,
        lead.telefoneBruto,
        'datalytics',
        originFromTracking(trackingDe(lead)) ?? 'Datalytics',
        lead.observacao,
        status,
        funnelId,
        lead.email,
        lead.cidade,
        lead.valor,
        sinais.agendou,
        sinais.compareceu,
        sinais.fechou,
        lead.idExterno,
      ],
    );
    if (labelEtapa) await espelharEtapa(pool, clientId, funnelId, labelEtapa);
    await pool.query('COMMIT');
    return { leadId: novo.id, criado: true, statusAnterior: null, statusNovo: status };
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

function trackingDe(lead: LeadDatalytics): MergedTracking {
  const t = lead.tracking;
  return {
    utm_source: t.utm_source ?? undefined,
    utm_medium: t.utm_medium ?? undefined,
    utm_campaign: t.utm_campaign ?? undefined,
    utm_content: t.utm_content ?? undefined,
    utm_term: t.utm_term ?? undefined,
    gclid: t.gclid ?? undefined,
    fbclid: t.fbclid ?? undefined,
    matchtype: t.matchtype ?? undefined,
    device: t.device ?? undefined,
    network: t.network ?? undefined,
    placement: t.placement ?? undefined,
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = makeServerPool();
  try {
    // Body ANTES do token: o payload cru precisa estar disponível pra logar em
    // qualquer desfecho. Não-JSON vira {_raw} — nunca se perde a evidência.
    const raw: unknown = await req.json().catch(async () => {
      const texto = await req.text().catch(() => '');
      return { _raw: texto };
    });

    const conn = await conexaoPorToken(pool, token);
    if (!conn) {
      await registrarLogDatalytics(pool, { clientId: null, raw, resultado: 'token_invalido' });
      return Response.json({ ok: false, erro: 'token_invalido' }, { status: 401 });
    }
    if (!conn.enabled) {
      await registrarLogDatalytics(pool, { clientId: conn.client_id, raw, resultado: 'desativado' });
      return Response.json({ ok: false, erro: 'integracao_desativada' }, { status: 403 });
    }

    await pool.query(
      `UPDATE public.datalytics_connections SET last_received_at = NOW() WHERE id = $1`,
      [conn.id],
    ).catch(() => {});

    const lead = extrairLeadDatalytics(raw);

    if (!lead.telefone) {
      const etapaOpaca = lead.etapa && 'idOpaco' in lead.etapa;
      await registrarLogDatalytics(pool, {
        clientId: conn.client_id, raw,
        resultado: etapaOpaca ? 'etapa_opaca' : 'sem_telefone',
        detalhe: etapaOpaca ? `stageId sem nome: ${(lead.etapa as { idOpaco: string }).idOpaco}` : 'payload sem telefone reconhecível',
      });
      return Response.json({ ok: false, erro: 'sem_telefone' });
    }

    const r = await upsertLead(pool, conn.client_id, lead);

    // Etapa veio só como id opaco: o upsert rodou (identidade/valor), mas o
    // status ficou intacto — registrado pra ficar visível no log da UI.
    const soIdOpaco = lead.etapa && 'idOpaco' in lead.etapa;

    // Pós-processamento fora da transação — best-effort, nunca derruba o 200.
    const regiao = regiaoFromPhone(lead.telefoneBruto);
    await applyLeadAttribution(pool, r.leadId, {
      tracking: trackingDe(lead),
      ddd: regiao?.ddd ?? null,
      regiaoUf: lead.estado ?? regiao?.uf ?? null,
      regiaoCidade: lead.cidade ?? regiao?.regiao ?? null,
      regiaoFonte: lead.estado || lead.cidade ? 'form' : regiao ? 'ddd' : null,
      email: lead.email,
      hasClickMatch: false,
    });
    await recordTrackingEvent(pool, {
      leadId: r.leadId,
      clientId: conn.client_id,
      eventType: 'datalytics',
      origin: originFromTracking(trackingDe(lead)),
      canal: 'datalytics',
      // Dedupe de entregas repetidas: id do lead lá + etapa + dia.
      externalId: `dl:${lead.idExterno ?? createHash('sha1')
        .update(`${token}:${lead.telefone}`).digest('hex').slice(0, 16)}:${r.statusNovo}:${new Date().toISOString().slice(0, 10)}`,
      tracking: trackingDe(lead),
      ddd: regiao?.ddd ?? null,
      regiaoUf: lead.estado ?? regiao?.uf ?? null,
      raw,
    }).catch(err => console.error('[datalytics] tracking event', err));

    // Mesmo gatilho de conversão do caminho da UI — deduplicado internamente
    // por hasSuccessfulConversion, então entrega repetida não duplica evento.
    if (r.criado || r.statusNovo !== (r.statusAnterior ?? '')) {
      await dispararEventosPorStatus(pool, conn.client_id, r.statusNovo, {
        id: r.leadId, phone: lead.telefoneBruto ?? lead.telefone,
      }, lead.valor).catch(err => console.error('[datalytics] conversao', err));
    }

    await registrarLogDatalytics(pool, {
      clientId: conn.client_id, raw,
      resultado: r.criado ? 'criado' : 'atualizado',
      detalhe: [
        lead.nome ?? lead.telefone,
        r.criado ? `entrou em "${r.statusNovo}"` : `"${r.statusAnterior ?? '—'}" → "${r.statusNovo}"`,
        soIdOpaco ? '(etapa veio só como id — status não mudou)' : null,
      ].filter(Boolean).join(' · '),
      leadId: r.leadId,
    });

    return Response.json({ ok: true, resultado: r.criado ? 'criado' : 'atualizado', leadId: r.leadId });
  } catch (err) {
    console.error('[datalytics] erro na recepção', err);
    await registrarLogDatalytics(pool, {
      clientId: null, raw: { erro: true },
      resultado: 'erro', detalhe: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    // 500 de propósito: erro NOSSO — se o Datalytics tiver retry, é bem-vindo.
    return Response.json({ ok: false, erro: 'interno' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/** Teste de conectividade — "colou a URL certa?" sem efeito colateral. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = makeServerPool();
  try {
    await ensureDatalyticsSchema(pool);
    const conn = await conexaoPorToken(pool, token);
    if (!conn) return Response.json({ ok: false, erro: 'token_invalido' }, { status: 401 });
    await registrarLogDatalytics(pool, {
      clientId: conn.client_id, raw: { teste: 'GET' }, resultado: 'teste_get',
    });
    return Response.json({ ok: true, integracao: 'datalytics', cliente: conn.client_id, ativa: conn.enabled });
  } finally {
    await pool.end();
  }
}
