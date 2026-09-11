/**
 * Resumo de tráfego — puxa Meta + Google, aplica a régua de `resumo-diario.ts`
 * e manda os 3 resumos (LEADS, VENDA, GOOGLE) no grupo do WhatsApp.
 *
 * A JANELA MUDA COM O DIA DA SEMANA (`decidirJanela`):
 *   terça a sexta ... o dia anterior
 *   segunda ......... a semana anterior inteira (segunda a domingo)
 *   sábado/domingo .. não envia
 *
 * Cron na VPS às 07h15 BRT (10h15 UTC), de segunda a sexta — NÃO no GitHub
 * Actions, que estrangula os crons deste repo (ver CLAUDE.md, nota de 31/07).
 *
 * `?dry=1` devolve os textos sem enviar nada.
 * `?hoje=YYYY-MM-DD` finge outra data (útil para conferir a janela de segunda).
 * `?forcar=1` ignora a trava de fim de semana.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { sendTextByInstanceId } from '@/lib/whatsapp-send';
import {
  agregarCampanhas, agruparPorTipo, baldeDoPeriodo, classificarGoogle, classificarMeta,
  contemDataRelativa, decidirJanela, montarResumoGoogle, montarResumoLeads, montarResumoVenda,
  statusCpl, statusCustoCompra,
  type Balde, type CampanhaDia, type ContaDiaria, type LinhaDesperdicio, type LinhaLead,
  type LinhaSimples, type LinhaVenda, type Periodo,
} from '@/lib/resumo-diario';

export const maxDuration = 300;

const GRUPO_PADRAO = '120363156855361648@g.us'; // "Onmid • Tráfego"
const GOOGLE_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';
const GOOGLE_API = 'https://googleads.googleapis.com/v24';
const ORCAMENTO_MS = 260_000;

function autorizado(req: NextRequest): boolean {
  const esperados = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter((s): s is string => Boolean(s));
  if (!esperados.length) return false;
  const q = req.nextUrl.searchParams.get('secret');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return esperados.some(s => s === q || s === bearer);
}

/** Hoje (YYYY-MM-DD) em BRT (UTC-3). */
function hojeBRT(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Famílias canônicas — mesma regra de `meta-results.ts`: dentro da família conta
// só o primeiro presente, nunca soma aliases do mesmo resultado.
const FAM_CONVERSA = ['onsite_conversion.messaging_conversation_started_7d', 'messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection', 'total_messaging_connection', 'onsite_conversion.messaging_first_reply'];
const FAM_LEAD = ['onsite_conversion.lead_grouped', 'lead', 'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.lead', 'onsite_conversion.lead', 'onsite_web_lead', 'onsite_web_app_lead'];
const FAM_COMPRA = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];

type MetaAction = { action_type?: string; value?: string };
function mapaDeAcoes(actions: MetaAction[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of actions ?? []) {
    if (!a?.action_type) continue;
    m.set(a.action_type, (m.get(a.action_type) ?? 0) + (Number(a.value) || 0));
  }
  return m;
}
function contarFamilia(m: Map<string, number>, familia: string[]): number {
  for (const t of familia) if (m.has(t)) return m.get(t)!;
  return 0;
}

const num = (v: unknown) => Number(v) || 0;

// ─── Meta ─────────────────────────────────────────────────────────────────

type ContaVinculada = {
  clientId: string; nome: string; cplMeta: number | null; tipoDashboard: string | null; accountId: string;
};

async function buscarCampanhasMeta(
  conta: ContaVinculada, token: string, desde: string, ate: string,
): Promise<CampanhaDia[]> {
  const campos = 'campaign_name,objective,spend,actions,action_values,impressions,clicks,reach';
  const url = `https://graph.facebook.com/v21.0/${conta.accountId}/insights`
    + `?level=campaign&time_increment=1&fields=${campos}&limit=500`
    + `&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: ate }))}`
    + `&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.data ?? []) as any[]).map((row) => {
    const m = mapaDeAcoes(row.actions);
    return {
      dia: row.date_start, nome: row.campaign_name ?? '(sem nome)', objetivo: row.objective,
      gasto: num(row.spend),
      resultados: contarFamilia(m, FAM_CONVERSA) + contarFamilia(m, FAM_LEAD),
      compras: contarFamilia(m, FAM_COMPRA),
      receita: contarFamilia(mapaDeAcoes(row.action_values), FAM_COMPRA),
      cliques: num(row.clicks), alcance: num(row.reach), impressoes: num(row.impressions),
    };
  });
}

// ─── Google ───────────────────────────────────────────────────────────────

const soDigitos = (s: string) => String(s ?? '').replace(/\D/g, '');

/**
 * ⚠️ Refresh por fetch cru no oauth2 — `googleapis.refreshAccessToken` falha em
 * silêncio neste projeto (ver optimizer-execucao.ts).
 */
async function tokenGoogle(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString(),
  }).catch(() => null);
  if (!res?.ok) return null;
  const d = await res.json().catch(() => null) as { access_token?: string } | null;
  return d?.access_token ?? null;
}

/**
 * ⚠️ Cada credencial resolve a PRÓPRIA lista de MCCs. Listar as contas
 * acessíveis com o token errado (GA4/Gmail) devolve 403, a cascata nunca chega
 * no MCC certo e TODAS as contas falham com "invalid authentication credentials"
 * — erro que parece credencial quebrada e é cascata errada.
 */
async function mccsAcessiveis(token: string): Promise<string[]> {
  const res = await fetch(`${GOOGLE_API}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${token}`, 'developer-token': GOOGLE_DEV_TOKEN },
  });
  if (!res.ok) return [];
  const d = await res.json().catch(() => ({})) as { resourceNames?: string[] };
  return (d.resourceNames ?? []).map(r => soDigitos(r.split('/')[1]));
}

type CredGoogle = { token: string; logins: (string | null)[] };

async function gaql(customerId: string, query: string, cred: CredGoogle, login: string | null) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${cred.token}`, 'developer-token': GOOGLE_DEV_TOKEN, 'Content-Type': 'application/json',
  };
  if (login) h['login-customer-id'] = soDigitos(login);
  const res = await fetch(`${GOOGLE_API}/customers/${soDigitos(customerId)}/googleAds:search`, {
    method: 'POST', headers: h, body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!res.ok) return { ok: false as const, results: [] as any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true as const, results: (data.results ?? []) as any[] };
}

// ─── Montagem ─────────────────────────────────────────────────────────────

type Agrupado = ReturnType<typeof agruparPorTipo>;

function linhaLead(nome: string, meta: number | null, b: Balde, bAnt: Balde): LinhaLead {
  const cpl = b.resultados > 0 ? b.gasto / b.resultados : null;
  return {
    nome, cpl, meta, status: statusCpl(cpl, meta),
    resultados: b.resultados, resultadosAnterior: bAnt.resultados, gasto: b.gasto,
  };
}
const linhaSimples = (nome: string, b: Balde): LinhaSimples => ({
  nome, gasto: b.gasto, cliques: b.cliques, alcance: b.alcance, impressoes: b.impressoes, resultados: b.resultados,
});

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  const inicio = Date.now();
  const seco = req.nextUrl.searchParams.get('dry') === '1';
  const forcar = req.nextUrl.searchParams.get('forcar') === '1';
  const hoje = req.nextUrl.searchParams.get('hoje') ?? hojeBRT();
  const janela = decidirJanela(hoje);
  const { atual, anterior } = janela;

  // Sábado e domingo não têm relatório. `forcar=1` existe para teste manual.
  if (!janela.enviar && !forcar) {
    return Response.json({ ok: true, pulado: 'fim de semana', hoje, diaDaSemana: new Date(`${hoje}T12:00:00Z`).getUTCDay() });
  }
  // A busca cobre as duas janelas de uma vez.
  const inicioBusca = anterior.inicio, fimBusca = atual.fim;

  const pool = makeServerPool();
  const avisos: string[] = [];
  try {
    const { rows: contas } = await pool.query<ContaVinculada & { plataforma: string }>(`
      SELECT c.id AS "clientId", c.name AS nome, c.dashboard_type AS "tipoDashboard",
             p.cpl_meta::float AS "cplMeta", l.account_id AS "accountId", l.platform AS plataforma
        FROM clients c
        JOIN client_account_links l ON l.client_id = c.id
        LEFT JOIN public.client_planning p ON p.client_id = c.id
       WHERE COALESCE(c.status,'Ativo') NOT IN ('Arquivado','Inativo')
         AND l.platform IN ('meta_ads','meta','google_ads','google')
       ORDER BY c.name`);

    const ehMeta = (p: string) => p === 'meta_ads' || p === 'meta';
    const contasMeta = contas.filter(c => ehMeta(c.plataforma));
    const contasGoogle = contas.filter(c => !ehMeta(c.plataforma));

    // ── Meta
    const { rows: [conn] } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM meta_connections
        WHERE status='connected' ORDER BY connected_at DESC LIMIT 1`);
    const agrupadosMeta = new Map<string, { conta: ContaVinculada; dados: Agrupado }>();
    const contasVistas = new Set<string>();
    if (conn) {
      const token = await getFreshMetaToken(conn);
      for (let i = 0; i < contasMeta.length; i += 5) {
        if (Date.now() - inicio > ORCAMENTO_MS) { avisos.push('orçamento de tempo estourou no Meta'); break; }
        await Promise.all(contasMeta.slice(i, i + 5).map(async (c) => {
          // Conta compartilhada entre dois clientes contaria em dobro no total.
          if (contasVistas.has(c.accountId)) return;
          contasVistas.add(c.accountId);
          try {
            const campanhas = await buscarCampanhasMeta(c, token, inicioBusca, fimBusca);
            const conta: ContaDiaria = { ...c, campanhas };
            agrupadosMeta.set(c.clientId, {
              conta: c,
              dados: agruparPorTipo(conta, k => classificarMeta(k.nome, k.objetivo, k.resultados, k.compras)),
            });
          } catch (e) { avisos.push(`Meta ${c.nome}: ${(e as Error).message}`); }
        }));
      }
    } else {
      avisos.push('nenhuma conexão Meta conectada');
    }

    // ── Google
    const { rows: conexoesG } = await pool.query<{ refresh_token: string }>(
      `SELECT refresh_token FROM public.google_connections WHERE status='connected' ORDER BY connected_at DESC`);
    const creds: CredGoogle[] = [];
    for (const c of conexoesG) {
      const t = await tokenGoogle(c.refresh_token);
      if (!t) continue;
      const mccs = await mccsAcessiveis(t);
      if (mccs.length) creds.push({ token: t, logins: [...mccs, null] });
    }
    const agrupadosGoogle = new Map<string, { conta: ContaVinculada; dados: Agrupado }>();
    if (creds.length) {
      const QUERY = `SELECT campaign.name, campaign.advertising_channel_type, segments.date,
          metrics.cost_micros, metrics.conversions, metrics.all_conversions, metrics.clicks, metrics.impressions
        FROM campaign WHERE segments.date BETWEEN '${inicioBusca}' AND '${fimBusca}'`;
      type Tentativa = { cred: CredGoogle; login: string | null };
      let atalho: Tentativa | null = null;
      for (const c of contasGoogle) {
        if (Date.now() - inicio > ORCAMENTO_MS) { avisos.push('orçamento de tempo estourou no Google'); break; }
        const tentativas: Tentativa[] = atalho ? [atalho] : [];
        for (const cred of creds) for (const login of cred.logins) tentativas.push({ cred, login });
        let r: Awaited<ReturnType<typeof gaql>> | null = null;
        for (const t of tentativas) {
          r = await gaql(c.accountId, QUERY, t.cred, t.login);
          if (r.ok) { atalho = t; break; }
        }
        if (!r?.ok) { avisos.push(`Google ${c.nome}: sem acesso`); continue; }
        const campanhas: CampanhaDia[] = r.results.map((row) => {
          const m = row.metrics ?? {};
          const conv = num(m.conversions) > 0 ? num(m.conversions) : num(m.allConversions);
          return {
            dia: row.segments.date, nome: row.campaign?.name ?? '(sem nome)',
            canal: row.campaign?.advertisingChannelType,
            gasto: num(m.costMicros) / 1e6, resultados: conv, compras: 0, receita: 0,
            cliques: num(m.clicks), alcance: 0, impressoes: num(m.impressions),
          };
        });
        agrupadosGoogle.set(c.clientId, {
          conta: c,
          dados: agruparPorTipo({ ...c, campanhas }, k => classificarGoogle(k.nome, k.canal, k.resultados)),
        });
      }
    } else {
      avisos.push('nenhuma credencial Google com acesso ao Ads');
    }

    // ── Linhas do Meta
    const leads: LinhaLead[] = [];
    const vendas: LinhaVenda[] = [];
    const semCompra: LinhaVenda[] = [];
    const desperdicio: LinhaDesperdicio[] = [];
    const trafego: LinhaSimples[] = [], branding: LinhaSimples[] = [], engajamento: LinhaSimples[] = [];
    let mGasto = 0, mRes = 0, mGastoAnt = 0, mResAnt = 0;
    let vGasto = 0, vCompras = 0, vReceita = 0, vGastoAnt = 0, vComprasAnt = 0, vReceitaAnt = 0;
    let totalMeta = 0;

    for (const { conta, dados } of agrupadosMeta.values()) {
      const L = baldeDoPeriodo(dados, atual, 'lead'), L2 = baldeDoPeriodo(dados, anterior, 'lead');
      const V = baldeDoPeriodo(dados, atual, 'venda'), V2 = baldeDoPeriodo(dados, anterior, 'venda');
      for (const t of ['lead', 'venda', 'trafego', 'branding', 'engajamento'] as const) {
        totalMeta += baldeDoPeriodo(dados, atual, t).gasto;
      }
      mGasto += L.gasto; mRes += L.resultados; mGastoAnt += L2.gasto; mResAnt += L2.resultados;
      vGasto += V.gasto; vCompras += V.compras; vReceita += V.receita;
      vGastoAnt += V2.gasto; vComprasAnt += V2.compras; vReceitaAnt += V2.receita;

      if (L.gasto > 0) leads.push(linhaLead(conta.nome, conta.cplMeta, L, L2));
      if (V.gasto > 0) {
        const custo = V.compras > 0 ? V.gasto / V.compras : null;
        const roi = V.gasto > 0 ? V.receita / V.gasto : 0;
        const linha: LinhaVenda = {
          nome: conta.nome, custo, status: statusCustoCompra(custo, roi), compras: V.compras,
          comprasAnterior: V2.compras, receita: V.receita, roi, gasto: V.gasto, conversas: V.resultados,
        };
        (custo === null ? semCompra : vendas).push(linha);
      }
      // Agregada: na janela semanal, um dia sem resultado não condena a campanha.
      const perdidas = agregarCampanhas(L).filter(k => k.resultados === 0);
      if (perdidas.length) {
        desperdicio.push({
          nome: conta.nome, gasto: perdidas.reduce((s, k) => s + k.gasto, 0),
          campanhas: perdidas.length, cliques: perdidas.reduce((s, k) => s + k.cliques, 0),
        });
      }
      for (const [tipo, alvo] of [['trafego', trafego], ['branding', branding], ['engajamento', engajamento]] as const) {
        const b = baldeDoPeriodo(dados, atual, tipo);
        if (b.gasto > 0) alvo.push(linhaSimples(conta.nome, b));
      }
    }

    // ── Linhas do Google
    const gLinhas: LinhaLead[] = [], gSemConv: LinhaSimples[] = [], gBranding: LinhaSimples[] = [];
    let gGasto = 0, gConv = 0, gGastoAnt = 0, gConvAnt = 0, totalGoogle = 0;
    for (const { conta, dados } of agrupadosGoogle.values()) {
      const P = baldeDoPeriodo(dados, atual, 'lead'), P2 = baldeDoPeriodo(dados, anterior, 'lead');
      for (const t of ['lead', 'trafego', 'branding'] as const) totalGoogle += baldeDoPeriodo(dados, atual, t).gasto;
      gGasto += P.gasto; gConv += P.resultados; gGastoAnt += P2.gasto; gConvAnt += P2.resultados;
      if (P.gasto > 0) {
        const l = linhaLead(conta.nome, conta.cplMeta, P, P2);
        if (l.cpl === null) gSemConv.push(linhaSimples(conta.nome, P)); else gLinhas.push(l);
      }
      for (const t of ['branding', 'trafego'] as const) {
        const b = baldeDoPeriodo(dados, atual, t);
        if (b.gasto > 0) gBranding.push(linhaSimples(conta.nome, b));
      }
    }

    const ordenarGasto = <T extends { gasto: number }>(a: T[]) => a.sort((x, y) => y.gasto - x.gasto);
    const textos = {
      leads: montarResumoLeads({
        atual, anterior, gasto: mGasto, resultados: mRes, gastoAnterior: mGastoAnt, resultadosAnterior: mResAnt,
        linhas: leads, desperdicio: ordenarGasto(desperdicio),
      }),
      venda: montarResumoVenda({
        atual, anterior, gasto: vGasto, compras: vCompras, receita: vReceita,
        gastoAnterior: vGastoAnt, comprasAnterior: vComprasAnt, receitaAnterior: vReceitaAnt,
        linhas: ordenarGasto(vendas), semCompra: ordenarGasto(semCompra),
        trafego: ordenarGasto(trafego), branding: ordenarGasto(branding), engajamento: ordenarGasto(engajamento),
      }),
      google: montarResumoGoogle({
        atual, anterior, gasto: gGasto, conversoes: gConv, gastoAnterior: gGastoAnt, conversoesAnterior: gConvAnt,
        cplMediaMeta: mRes > 0 ? mGasto / mRes : null,
        linhas: gLinhas, semConversao: ordenarGasto(gSemConv), branding: ordenarGasto(gBranding),
        totalMeta, totalGoogle,
      }),
    };

    // Trava: o relatório é de um dia passado; "ontem/hoje" não tem âncora.
    for (const [rot, txt] of Object.entries(textos)) {
      if (contemDataRelativa(txt)) avisos.push(`${rot}: contém data relativa`);
    }

    if (seco) {
      return Response.json({
        ok: true, dry: true, tipo: janela.tipo, hoje, atual, anterior, avisos,
        contas: { meta: agrupadosMeta.size, google: agrupadosGoogle.size },
        tamanhos: Object.fromEntries(Object.entries(textos).map(([k, v]) => [k, v.length])),
        textos,
      });
    }

    const { rows: cfg } = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM system_settings WHERE key IN ('resumo_diario_group_id','resumo_diario_zapi_client_id','luna_zapi_client_id')`);
    const conf = Object.fromEntries(cfg.map(r => [r.key, r.value]));
    const grupo = conf.resumo_diario_group_id || GRUPO_PADRAO;
    const instancia = conf.resumo_diario_zapi_client_id || conf.luna_zapi_client_id;
    if (!instancia) return Response.json({ ok: false, erro: 'nenhuma instância de envio configurada', avisos }, { status: 500 });

    const enviados: Record<string, unknown>[] = [];
    for (const [rot, txt] of Object.entries(textos)) {
      const r = await sendTextByInstanceId(pool, instancia, grupo, txt);
      enviados.push({ resumo: rot, ok: r.ok, erro: r.ok ? undefined : r.error });
      if (!r.ok) avisos.push(`envio ${rot}: ${r.error}`);
      await new Promise(res => setTimeout(res, 2500));
    }
    return Response.json({ ok: true, tipo: janela.tipo, hoje, atual, anterior, grupo, enviados, avisos, tookMs: Date.now() - inicio });
  } catch (e) {
    return Response.json({ ok: false, erro: (e as Error).message, avisos }, { status: 500 });
  } finally {
    await pool.end();
  }
}
