import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { makeServerPool } from '@/lib/server-db';
import { resolverLeadExistente } from '@/lib/lead-identity';
import {
  origemPorToken, marcarRecebido, registrarLog, ensureLpOrigensSchema,
} from '@/lib/lp-origens';
import { ensureDefaultFunnel, getFirstFunnelStageLabel, normalizeCrmPhone } from '@/lib/crm-conversation-sync';
import {
  applyLeadAttribution, recordTrackingEvent, originFromTracking,
  extractTrackingFromText, type MergedTracking,
} from '@/lib/lead-tracking';
import { regiaoFromPhone } from '@/lib/ddd-regioes';
import { resolverNomesGoogle, pareceIdGoogle } from '@/lib/google-ad-resolver';

/**
 * Recebe lead de site/landing page DIRETO, sem intermediário.
 *
 * O token da URL resolve cliente E qual site — a página não precisa conhecer o
 * client_id nem mandar segredo no corpo. Vários tokens por cliente: cada
 * site/LP tem o seu, e o nome dele viaja com o lead (senão os leads de três
 * páginas do mesmo cliente chegam indistinguíveis).
 *
 * Rota PÚBLICA no proxy — o token de 48 hex é a credencial.
 *
 * Filosofia de resposta (espelha Datalytics e webhook genérico): payload ruim
 * responde 200 com ok:false, porque quem chama é um formulário e repetir não
 * conserta o conteúdo. Erro NOSSO responde 500, aí sim vale nova tentativa.
 */

export const runtime = 'nodejs';

// A resposta precisa ser legível pelo script rodando no domínio do CLIENTE.
// Sem isso o envio funciona mas o site não consegue saber se deu certo.
const CORS = { 'access-control-allow-origin': '*' };
const resposta = (corpo: unknown, status = 200) =>
  Response.json(corpo, { status, headers: CORS });

type Corpo = Record<string, unknown>;

const txt = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s ? s.slice(0, 400) : undefined;
};

/** Rastreio: aceita campo solto E extrai da page_url — o que vier. */
function lerTracking(c: Corpo): MergedTracking {
  const daUrl = txt(c.page_url) ? extractTrackingFromText(String(c.page_url)) : {};
  const pega = (k: string) => txt(c[k]) ?? (daUrl as Record<string, string | undefined>)[k];
  return {
    utm_source: pega('utm_source'), utm_medium: pega('utm_medium'),
    utm_campaign: pega('utm_campaign'), utm_content: pega('utm_content'),
    utm_term: pega('utm_term'),
    gclid: pega('gclid'), wbraid: pega('wbraid'), gbraid: pega('gbraid'),
    fbclid: pega('fbclid'), ttclid: pega('ttclid'),
    keyword: txt(c.keyword) ?? txt(c.palavra_chave),
    matchtype: txt(c.matchtype), device: txt(c.device),
    network: txt(c.network), placement: txt(c.placement),
    // A URL de onde o lead veio: o cadastro tem coluna para ela e antes ficava nula.
    source_url: txt(c.page_url) ?? txt(c.source_url) ?? txt(c.url),
  } as MergedTracking;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = makeServerPool();
  let raw: unknown = null;

  try {
    await ensureLpOrigensSchema(pool);
    const origem = await origemPorToken(pool, token);
    if (!origem) return resposta({ ok: false, erro: 'token_invalido' }, 401);
    if (!origem.enabled) {
      return resposta({ ok: false, erro: 'origem_desativada' });
    }

    // Lê como TEXTO e parseia: o script universal manda text/plain de propósito
    // — é requisição "simple" do CORS, sem preflight OPTIONS (o repo não tem
    // nenhum handler OPTIONS e continua assim). req.json() exigiria
    // application/json, que dispara preflight quando vem de outro domínio.
    try { raw = JSON.parse(await req.text()); }
    catch {
      await registrarLog(pool, { origemId: origem.id, clientId: origem.client_id, raw: null,
        resultado: 'erro', detalhe: 'corpo não é JSON' });
      return resposta({ ok: false, erro: 'json_invalido' });
    }
    const c = (raw ?? {}) as Corpo;

    const nome = txt(c.nome) ?? txt(c.name);
    const telefoneBruto = txt(c.telefone) ?? txt(c.phone) ?? txt(c.whatsapp);
    const telefone = telefoneBruto ? normalizeCrmPhone(telefoneBruto) : null;
    const email = txt(c.email);

    // Sem telefone E sem e-mail não há como identificar nem retornar contato.
    if (!telefone && !email) {
      await registrarLog(pool, { origemId: origem.id, clientId: origem.client_id, raw,
        resultado: 'sem_contato', detalhe: 'payload sem telefone e sem e-mail' });
      return resposta({ ok: false, erro: 'sem_contato' });
    }

    const tracking = lerTracking(c);
    const cidade = txt(c.cidade) ?? txt(c.city);
    const estado = txt(c.estado) ?? txt(c.uf);
    const funnelId = await ensureDefaultFunnel(pool, origem.client_id);
    const statusInicial = await getFirstFunnelStageLabel(pool, funnelId);

    // De qual site veio: entra na observação porque é informação de origem que
    // precisa aparecer para quem abre o lead, não só em relatório.
    const marca = `Origem: ${origem.nome}`;
    const observacao = [txt(c.observacao) ?? txt(c.mensagem), marca].filter(Boolean).join('\n');

    await pool.query('BEGIN');
    let leadId: string;
    let criado = false;
    try {
      await pool.query('SELECT pg_advisory_xact_lock(hashtext($1))',
        [`lp:${origem.client_id}:${telefone ?? email}`]);

      const achado = await resolverLeadExistente(pool, origem.client_id, {
        telefone: telefoneBruto ?? undefined, email,
      });

      if (achado) {
        leadId = achado.id;
        // Fill-blanks: quem já conhecia o lead sabe mais que um formulário novo.
        await pool.query(
          `UPDATE public.crm_leads SET
             nome = COALESCE(NULLIF(nome, ''), $2),
             email = COALESCE(NULLIF(email, ''), $3),
             city = COALESCE(NULLIF(city, ''), $4),
             observacao = CASE WHEN COALESCE(observacao, '') = '' THEN $5
                               WHEN observacao LIKE '%' || $6 || '%' THEN observacao
                               ELSE observacao || E'\\n' || $6 END,
             updated_at = NOW()
           WHERE id = $1::uuid`,
          [leadId, nome, email, cidade, observacao, marca],
        );
      } else {
        criado = true;
        const hoje = new Date();
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO public.crm_leads
             (client_id, mes, data, nome, numero, email, city, canal, origin,
              observacao, status, funnel_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
           RETURNING id`,
          [
            origem.client_id,
            hoje.toISOString().slice(0, 7),
            hoje.toISOString().slice(0, 10),
            nome ?? telefone ?? email ?? 'Lead',
            telefone, email, cidade,
            origem.nome,                          // canal = o site que originou
            originFromTracking(tracking) ?? 'site',
            observacao, statusInicial, funnelId,
          ],
        );
        leadId = rows[0].id;
      }
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {});
      throw e;
    }

    // Pós-processamento best-effort: não derruba o 200 do formulário.

    // O ValueTrack do Google só manda ID ({campaignid}) — não existe macro de
    // nome, ao contrário do Meta. Traduz aqui para o CRM mostrar "Revenda
    // Londrina Search" em vez de "22334455". Se a tradução falhar, o ID fica:
    // rastreio com ID é pior de ler, mas continua sendo rastreio.
    if (pareceIdGoogle(tracking.utm_campaign) || txt(c.campaignid)) {
      const nomes = await resolverNomesGoogle(pool, origem.client_id, {
        campaignId: txt(c.campaignid) ?? tracking.utm_campaign,
        adgroupId: txt(c.adgroupid),
      });
      if (nomes?.campaign_name) tracking.utm_campaign = nomes.campaign_name;
      if (nomes?.adgroup_name && !tracking.utm_term) tracking.utm_term = nomes.adgroup_name;
    }

    const regiao = regiaoFromPhone(telefoneBruto ?? telefone ?? '');
    await applyLeadAttribution(pool, leadId, {
      tracking,
      ddd: regiao?.ddd ?? null,
      regiaoUf: estado ?? regiao?.uf ?? null,
      regiaoCidade: cidade ?? regiao?.regiao ?? null,
      regiaoFonte: estado || cidade ? 'form' : regiao ? 'ddd' : null,
      city: cidade,
      email,
      hasClickMatch: false,
    }).catch(err => console.error('[lp] atribuicao', err));

    await recordTrackingEvent(pool, {
      leadId,
      clientId: origem.client_id,
      eventType: 'formulario',
      origin: originFromTracking(tracking),
      canal: origem.nome,
      // Dedupe de reenvio: origem + contato + dia.
      externalId: `lp:${origem.id}:${createHash('sha1')
        .update(String(telefone ?? email)).digest('hex').slice(0, 16)}:${new Date().toISOString().slice(0, 10)}`,
      tracking,
      ddd: regiao?.ddd ?? null,
      regiaoUf: estado ?? regiao?.uf ?? null,
      raw,
    }).catch(err => console.error('[lp] tracking event', err));

    await marcarRecebido(pool, origem.id).catch(() => {});
    await registrarLog(pool, {
      origemId: origem.id, clientId: origem.client_id, raw,
      resultado: criado ? 'criado' : 'atualizado',
      detalhe: [nome ?? telefone ?? email, tracking.utm_campaign ?? tracking.gclid ?? null]
        .filter(Boolean).join(' · '),
      leadId,
    });

    return resposta({ ok: true, lead_id: leadId, criado, cliente: origem.client_id, site: origem.nome });
  } catch (err) {
    console.error('[lp origens] erro', err);
    await registrarLog(pool, { origemId: null, clientId: null, raw,
      resultado: 'erro', detalhe: err instanceof Error ? err.message : String(err) }).catch(() => {});
    return resposta({ ok: false, erro: 'erro_interno' }, 500);
  } finally {
    await pool.end().catch(() => {});
  }
}

/** GET serve de teste rápido: a LP consegue falar com o Reports? */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = makeServerPool();
  try {
    const origem = await origemPorToken(pool, token);
    if (!origem) return resposta({ ok: false, erro: 'token_invalido' }, 401);
    return resposta({ ok: true, site: origem.nome, ativo: origem.enabled, metodo: 'use POST' });
  } catch {
    return resposta({ ok: false, erro: 'erro_interno' }, 500);
  } finally {
    await pool.end().catch(() => {});
  }
}
