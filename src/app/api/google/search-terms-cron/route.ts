import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { logAiUsage } from '@/lib/ai-usage-logger';
import {
  lunaGoogleSearch, lunaGoogleMutatePartial, criarKeywordsGoogle, resolveGoogleAccountIds,
} from '@/lib/luna-tools';
import { ensureOtimizacaoHistoricoSchema } from '@/lib/otimizacao-historico';
import {
  filtrarTermosParaAnalise, planejarAplicacao, parseDecisoesIa, resumoParaHistorico,
  PROMPT_SISTEMA_TERMOS, type TermoBruto,
} from '@/lib/search-terms-rotina';

/**
 * Rotina SEMANAL de saneamento de termos de pesquisa do Google Ads.
 *
 * Por cliente com conta Google vinculada: lê os termos reais de 30 dias →
 * pré-filtra sem IA → a IA classifica (negativar / promover / ignorar) → as
 * decisões passam pelas travas de `search-terms-rotina.ts` → aplica na conta e
 * grava no HISTÓRICO do cliente (`otimizacao_registros`, canal google, autor
 * "Luna IA"), que é a trilha que outro gestor lê pra assumir a conta.
 *
 * Modo APLICA SOZINHA (decisão do Matheus). As travas que impedem estrago:
 * negativa nunca pode bloquear keyword ativa, keyword nova só com conversão ou
 * volume de cliques, e tetos por rodada. `?dry=1` roda tudo SEM aplicar.
 *
 * Cadência: semanal (o Google esconde termo de baixo volume; janela de 30 dias
 * com corte semanal é o ponto onde a amostra é significativa e nada se perde).
 */

export const maxDuration = 300;

const MODELO = 'claude-haiku-4-5-20251001';
const JANELA_DIAS = 30;

type ResultadoCliente = {
  client_id: string;
  nome: string | null;
  conta?: string;
  analisados?: number;
  negativadas?: number;
  promovidas?: number;
  recusadas?: number;
  erro?: string;
  pulado?: string;
  /** Só em ?dry=1: o QUE seria feito. Dry-run sem isso não dá pra aprovar. */
  plano?: {
    negativar: Array<{ termo: string; motivo: string }>;
    promover: Array<{ termo: string; motivo: string }>;
    recusadas: Array<{ termo: string; decisao: string; motivo: string }>;
  };
};

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  if (valid.length === 0 || !valid.includes(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const soCliente = req.nextUrl.searchParams.get('clientId') ?? '';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ ok: false, error: 'ANTHROPIC_API_KEY ausente' }, { status: 503 });

  const started = Date.now();
  const deadlineMs = 260_000;
  const pool = makeServerPool();
  const anthropic = new Anthropic({ apiKey });
  const resultados: ResultadoCliente[] = [];
  let semTempo = false;

  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    const { rows: clientes } = await pool.query(
      `SELECT DISTINCT c.id, c.name, c.city
         FROM public.clients c
         JOIN public.client_account_links l ON l.client_id = c.id
        WHERE l.platform IN ('google_ads','google')
          AND COALESCE(c.status, 'ativo') <> 'inativo'
          ${soCliente ? 'AND c.id = $1' : ''}
        ORDER BY c.name`,
      soCliente ? [soCliente] : [],
    ).catch(async () => {
      // Instalação sem clients.city: mesma query sem a coluna.
      const r = await pool.query(
        `SELECT DISTINCT c.id, c.name
           FROM public.clients c
           JOIN public.client_account_links l ON l.client_id = c.id
          WHERE l.platform IN ('google_ads','google')
            AND COALESCE(c.status, 'ativo') <> 'inativo'
            ${soCliente ? 'AND c.id = $1' : ''}
          ORDER BY c.name`,
        soCliente ? [soCliente] : [],
      );
      return r;
    });

    for (const cliente of clientes) {
      if (Date.now() - started > deadlineMs) { semTempo = true; break; }
      const res: ResultadoCliente = { client_id: cliente.id, nome: cliente.name };
      try {
        const [customerId] = await resolveGoogleAccountIds(pool, cliente.id);
        if (!customerId) { res.pulado = 'sem conta google'; resultados.push(res); continue; }
        res.conta = customerId;

        const termosRes = await lunaGoogleSearch(customerId,
          `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
                  search_term_view.search_term, search_term_view.status,
                  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
             FROM search_term_view
            WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'
            ORDER BY metrics.cost_micros DESC LIMIT 400`);
        if (!termosRes) { res.erro = 'sem acesso à conta google'; resultados.push(res); continue; }

        const brutos: TermoBruto[] = termosRes.results.map((r) => ({
          termo: String(r.searchTermView?.searchTerm ?? ''),
          situacao: String(r.searchTermView?.status ?? ''),
          campaignId: String(r.campaign?.id ?? ''),
          campanha: String(r.campaign?.name ?? ''),
          adGroupId: String(r.adGroup?.id ?? ''),
          grupo: String(r.adGroup?.name ?? ''),
          impressoes: Number(r.metrics?.impressions ?? 0),
          cliques: Number(r.metrics?.clicks ?? 0),
          gasto: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
          conversoes: Number(r.metrics?.conversions ?? 0),
        })).filter((t) => t.termo && t.campaignId && t.adGroupId);

        const analisar = filtrarTermosParaAnalise(brutos);
        res.analisados = analisar.length;
        if (analisar.length === 0) { res.pulado = 'nenhum termo relevante no período'; resultados.push(res); continue; }

        // Keywords ATIVAS da conta: base das travas (negativa não pode matar keyword).
        const kwRes = await lunaGoogleSearch(customerId,
          `SELECT ad_group_criterion.keyword.text FROM ad_group_criterion
            WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
              AND ad_group_criterion.status = 'ENABLED' AND campaign.status = 'ENABLED' LIMIT 3000`);
        const keywordsAtivas = (kwRes?.results ?? [])
          .map((r) => String(r.adGroupCriterion?.keyword?.text ?? '')).filter(Boolean);

        const contexto = [
          `Cliente: ${cliente.name ?? '(sem nome)'}`,
          cliente.city ? `Área de atendimento: ${cliente.city}` : 'Área de atendimento: não informada (não negative por cidade sem certeza)',
          `Palavras-chave ativas da conta: ${keywordsAtivas.slice(0, 60).join(' | ') || '(nenhuma)'}`,
          '',
          'Termos de pesquisa dos últimos 30 dias (termo | impressões | cliques | gasto R$ | conversões):',
          ...analisar.map((t) => `${t.termo} | ${t.impressoes} | ${t.cliques} | ${t.gasto.toFixed(2)} | ${t.conversoes}`),
        ].join('\n');

        const msg = await anthropic.messages.create({
          model: MODELO,
          max_tokens: 4000,
          system: [{ type: 'text', text: PROMPT_SISTEMA_TERMOS, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: contexto }],
        });
        await logAiUsage({
          source: 'google_search_terms', model: MODELO,
          inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens,
          cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
        }).catch(() => {});

        const texto = msg.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
        const plano = planejarAplicacao(parseDecisoesIa(texto), analisar, keywordsAtivas);
        res.recusadas = plano.recusadas.length;

        let negativadas = 0;
        let promovidas = 0;
        if (!dry) {
          // Negativas agrupadas por campanha (o critério é do nível campanha).
          const porCampanha = new Map<string, string[]>();
          for (const n of plano.negativar) {
            porCampanha.set(n.campaignId, [...(porCampanha.get(n.campaignId) ?? []), n.termo]);
          }
          for (const [campaignId, termos] of porCampanha) {
            const campRn = `customers/${customerId}/campaigns/${campaignId}`;
            const out = await lunaGoogleMutatePartial(customerId, termosRes.token, termosRes.login, 'campaignCriteria',
              termos.map((kw) => ({ create: { campaign: campRn, negative: true, keyword: { text: kw, matchType: 'PHRASE' } } })));
            if (!('error' in out)) negativadas += out.okIndexes.length;
          }
          // Promoções, uma por grupo de origem (usa o mesmo caminho da criação,
          // com partialFailure + pedido de isenção de política).
          const porGrupo = new Map<string, string[]>();
          for (const p of plano.promover) {
            porGrupo.set(p.adGroupId, [...(porGrupo.get(p.adGroupId) ?? []), p.termo]);
          }
          for (const [adGroupId, termos] of porGrupo) {
            const agRn = `customers/${customerId}/adGroups/${adGroupId}`;
            const out = await criarKeywordsGoogle(customerId, termosRes.token, termosRes.login, agRn, termos, 'PHRASE');
            promovidas += out.criadas;
          }
        }
        res.negativadas = dry ? plano.negativar.length : negativadas;
        res.promovidas = dry ? plano.promover.length : promovidas;
        if (dry) {
          res.plano = {
            negativar: plano.negativar.map((x) => ({ termo: x.termo, motivo: x.motivo })),
            promover: plano.promover.map((x) => ({ termo: x.termo, motivo: x.motivo })),
            recusadas: plano.recusadas,
          };
        }

        // Histórico do cliente: trilha pro próximo gestor. Só grava quando houve
        // ação de verdade (rodada muda nada não polui a timeline).
        if (!dry && (negativadas > 0 || promovidas > 0)) {
          const gastoAnalisado = analisar.reduce((s, t) => s + t.gasto, 0);
          await pool.query(
            `INSERT INTO public.otimizacao_registros (client_id, user_id, user_name, canal, acoes, descricao, origem)
             VALUES ($1, NULL, 'Luna IA (rotina automática)', 'google', $2, $3, 'automacao')`,
            [cliente.id, ['keywords'], resumoParaHistorico(plano, { negativadas, promovidas }, { dias: JANELA_DIAS, gastoAnalisado })],
          ).catch(() => {});
        }
      } catch (e) {
        res.erro = e instanceof Error ? e.message.slice(0, 200) : 'erro desconhecido';
      }
      resultados.push(res);
    }
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'erro' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }

  const total = resultados.reduce((acc, r) => ({
    negativadas: acc.negativadas + (r.negativadas ?? 0),
    promovidas: acc.promovidas + (r.promovidas ?? 0),
  }), { negativadas: 0, promovidas: 0 });
  return Response.json({
    ok: true, dry, semTempo, clientes: resultados.length,
    ...total, tookMs: Date.now() - started, resultados,
  });
}
