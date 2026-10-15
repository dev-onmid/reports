/**
 * Recuperação de leads de FORMULÁRIO da Meta que o webhook não entregou.
 *
 * ⚠️ POR QUE ISTO EXISTE (caso REAL do CondoStore, 2026-10-15): a Página
 * `112045230489360` estava assinada em `leadgen`, o app tinha a assinatura
 * `object=page active=true fields=[leadgen]`, o mapa Página→cliente existia e o
 * formulário estava registrado — e MESMO ASSIM nenhum lead chegou nunca, nos 4
 * meses em que o formulário acumulou 276 respostas (76 só em 01–15/10). Outros
 * clientes (Incorpast, SorriLeve, IGA Barney) recebiam normalmente pelo MESMO
 * endpoint no mesmo período, então não é o nosso receptor: é a entrega da Meta
 * para aquela Página que silenciosamente não acontece.
 *
 * A lição é que webhook de terceiro não é fonte confiável de lead: quando ele
 * falha, falha CALADO e o prejuízo é lead de anúncio pago que ninguém atende. A
 * API, por outro lado, entrega as respostas sob demanda — então esta varredura
 * é a rede de segurança (e, rodando no cron, a garantia de que nenhum lead de
 * formulário se perde mesmo que o webhook morra de novo, para qualquer cliente).
 *
 * Reusa `processLeadgenEvent` — o MESMO caminho do webhook. Nada de ingestão
 * paralela: a dedupe por `leadgen:{id}` em `lead_tracking_events` é o que
 * permite as duas portas conviverem sem criar lead em dobro.
 *
 * ⚠️ Não dispara conversão para Meta/Google: `processLeadgenEvent` nunca o fez,
 * e é isso que torna seguro varrer meses de histórico (mesma lição do backfill
 * do Agendor, que reenviaria venda velha para a otimização das campanhas).
 */
import type { Pool } from 'pg';
import { processLeadgenEvent } from '@/lib/meta-leadgen';
import {
  ensureLeadgenFormsSchema, listarFormularios, resolverPaginaDoCliente, tokenDeUsuario,
  type PaginaDoCliente,
} from '@/lib/meta-leadgen-forms';

const GRAPH = 'https://graph.facebook.com/v21.0';

export type ResumoFormulario = {
  formId: string;
  formName: string;
  vistos: number;
  novos: number;
  jaTinha: number;
  falhas: number;
};

export type ResultadoRecuperacao = {
  clientId: string;
  pageId: string | null;
  pageName: string | null;
  erro: string | null;
  desde: string;
  formularios: ResumoFormulario[];
  novos: number;
  jaTinha: number;
  falhas: number;
  motivosDeFalha: string[];
  semTempo: boolean;
};

type RespostaLeads = {
  data?: Array<{ id?: string; created_time?: string; ad_id?: string }>;
  paging?: { next?: string };
  error?: { message?: string };
};

/** Lista os ids de resposta de um formulário até a data de corte (mais novo primeiro). */
async function idsDoFormulario(
  formId: string, token: string, desdeISO: string, tetoPaginas = 20,
): Promise<{ ids: Array<{ id: string; adId: string | null }>; erro: string | null }> {
  const ids: Array<{ id: string; adId: string | null }> = [];
  let path: string | null = `/${formId}/leads?fields=id,created_time,ad_id&limit=100`;
  for (let i = 0; i < tetoPaginas && path; i++) {
    let r: RespostaLeads | null = null;
    try {
      const url = new URL(`${GRAPH}${path}`);
      if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
      r = await (await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) })).json() as RespostaLeads;
    } catch { return { ids, erro: 'Sem resposta da Meta ao listar respostas.' }; }
    if (r?.error) return { ids, erro: r.error.message ?? 'A Meta recusou a listagem de respostas.' };
    let passouDoCorte = false;
    for (const l of r?.data ?? []) {
      if (!l.id) continue;
      // A Meta devolve do mais novo para o mais velho: ao cruzar o corte, para.
      if (l.created_time && String(l.created_time) < desdeISO) { passouDoCorte = true; continue; }
      ids.push({ id: String(l.id), adId: l.ad_id ? String(l.ad_id) : null });
    }
    if (passouDoCorte) break;
    path = r?.paging?.next ? r.paging.next.replace(GRAPH, '') : null;
  }
  return { ids, erro: null };
}

/** Quais destes leadgen_id já viraram evento aqui (uma consulta, não N). */
async function jaProcessados(pool: Pool, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await pool.query<{ external_id: string }>(
    `SELECT external_id FROM public.lead_tracking_events
      WHERE event_type = 'formulario' AND external_id = ANY($1::text[])`,
    [ids.map(i => `leadgen:${i}`)],
  ).catch(() => ({ rows: [] as Array<{ external_id: string }> }));
  return new Set(rows.map(r => r.external_id.replace(/^leadgen:/, '')));
}

/**
 * De onde sai a lista de formulários a varrer.
 *
 * ⚠️ NÃO basta `listarFormularios` (a listagem da Meta): medido no CondoStore em
 * 15/10/2026, `GET /{page}/leadgen_forms` devolveu **lista vazia** com o token
 * de agência, embora a MESMA credencial leia `GET /{form}/leads` do formulário
 * ativo sem problema (100 respostas na primeira página). Depender só dela faria
 * a recuperação "rodar com sucesso" e não achar nada — a pior falha possível
 * aqui, porque é silenciosa. Então a lista é a UNIÃO de três fontes:
 *   1. a listagem da Meta (quando responde, é a mais completa);
 *   2. `meta_leadgen_forms`, o que já conhecemos deste cliente;
 *   3. o `lead_gen_form_id` dos criativos — o formulário que está de fato
 *      rodando hoje, que é justamente o que não pode escapar.
 */
async function formulariosParaVarrer(
  pool: Pool, pagina: PaginaDoCliente, clientId: string,
): Promise<Array<{ id: string; nome: string; leadsTotal: number | null }>> {
  // leadsTotal = null quando a fonte não sabe (banco/criativo); 0 só vem da
  // listagem da Meta, e aí é seguro pular — formulário que nunca teve resposta
  // não tem o que recuperar. No CondoStore isso corta 22 das 23 consultas.
  const porId = new Map<string, { nome: string; leadsTotal: number | null }>();
  const { formularios } = await listarFormularios(pagina);
  for (const f of formularios) porId.set(f.id, { nome: f.nome, leadsTotal: f.leadsTotal ?? null });

  const { rows } = await pool.query<{ form_id: string; form_name: string | null }>(
    `SELECT form_id, form_name FROM public.meta_leadgen_forms WHERE page_id = $1 OR client_id = $2`,
    [pagina.pageId, clientId],
  ).catch(() => ({ rows: [] as Array<{ form_id: string; form_name: string | null }> }));
  for (const r of rows) if (!porId.has(r.form_id)) porId.set(r.form_id, { nome: r.form_name ?? r.form_id, leadsTotal: null });

  for (const id of await formulariosDosCriativos(pool, clientId, pagina.pageToken)) {
    if (!porId.has(id)) porId.set(id, { nome: id, leadsTotal: null });
  }
  return [...porId].map(([id, v]) => ({ id, nome: v.nome, leadsTotal: v.leadsTotal }));
}

/** O formulário que os anúncios do cliente estão usando agora. */
async function formulariosDosCriativos(pool: Pool, clientId: string, token: string): Promise<string[]> {
  const { rows } = await pool.query<{ account_id: string }>(
    `SELECT account_id FROM public.client_account_links
      WHERE client_id = $1 AND platform IN ('meta_ads','meta') LIMIT 3`, [clientId],
  ).catch(() => ({ rows: [] as Array<{ account_id: string }> }));
  const ids = new Set<string>();
  for (const { account_id } of rows) {
    const act = account_id.startsWith('act_') ? account_id : `act_${account_id}`;
    type Ad = { effective_status?: string; creative?: { object_story_spec?: {
      link_data?: { call_to_action?: { value?: { lead_gen_form_id?: string } } };
      video_data?: { call_to_action?: { value?: { lead_gen_form_id?: string } } };
    } } };
    let r: { data?: Ad[] } | null = null;
    try {
      const url = `${GRAPH}/${act}/ads?fields=effective_status,creative{object_story_spec{link_data{call_to_action{value}},video_data{call_to_action{value}}}}&limit=200&access_token=${encodeURIComponent(token)}`;
      r = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).json() as { data?: Ad[] };
    } catch { continue; }
    for (const a of r?.data ?? []) {
      const s = a.creative?.object_story_spec;
      const f = s?.link_data?.call_to_action?.value?.lead_gen_form_id
        ?? s?.video_data?.call_to_action?.value?.lead_gen_form_id;
      if (f) ids.add(String(f));
    }
  }
  return [...ids];
}

export async function recuperarLeadsDoCliente(
  pool: Pool,
  clientId: string,
  opts: { dias?: number; orcamentoMs?: number; dry?: boolean; iniciadoEm?: number } = {},
): Promise<ResultadoRecuperacao> {
  const dias = Math.max(1, Math.min(opts.dias ?? 30, 400));
  const t0 = opts.iniciadoEm ?? Date.now();
  const orcamento = opts.orcamentoMs ?? 240_000;
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const base: ResultadoRecuperacao = {
    clientId, pageId: null, pageName: null, erro: null, desde,
    formularios: [], novos: 0, jaTinha: 0, falhas: 0, motivosDeFalha: [], semTempo: false,
  };

  await ensureLeadgenFormsSchema(pool);
  const { pagina, motivo } = await resolverPaginaDoCliente(pool, clientId);
  if (!pagina) return { ...base, erro: motivo ?? 'Página não resolvida.' };
  const userToken = (await tokenDeUsuario(pool, clientId)) ?? pagina.pageToken;

  const res: ResultadoRecuperacao = { ...base, pageId: pagina.pageId, pageName: pagina.pageName };
  const formularios = await formulariosParaVarrer(pool, pagina as PaginaDoCliente, clientId);
  if (formularios.length === 0) return { ...res, erro: 'Nenhum formulário encontrado para esta Página.' };

  for (const form of formularios) {
    if (Date.now() - t0 > orcamento) { res.semTempo = true; break; }
    if (form.leadsTotal === 0) continue; // nunca teve resposta — nada a buscar
    const { ids, erro: erroIds } = await idsDoFormulario(form.id, pagina.pageToken, desde);
    if (erroIds && ids.length === 0) {
      if (!res.motivosDeFalha.includes(erroIds)) res.motivosDeFalha.push(erroIds);
      continue;
    }
    const vistos = new Set(await jaProcessados(pool, ids.map(i => i.id)));
    const faltantes = ids.filter(i => !vistos.has(i.id));
    const resumo: ResumoFormulario = {
      formId: form.id, formName: form.nome,
      vistos: ids.length, novos: 0, jaTinha: ids.length - faltantes.length, falhas: 0,
    };

    for (const lead of faltantes) {
      if (Date.now() - t0 > orcamento) { res.semTempo = true; break; }
      if (opts.dry) { resumo.novos++; continue; }
      const r = await processLeadgenEvent(
        pool,
        { leadgen_id: lead.id, page_id: pagina.pageId, form_id: form.id, ad_id: lead.adId ?? undefined },
        userToken, pagina.pageToken,
      ).catch(e => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
      if (r.ok && r.reason === 'já processado') resumo.jaTinha++;
      else if (r.ok) resumo.novos++;
      else {
        resumo.falhas++;
        const m = r.reason ?? 'falha sem motivo';
        if (!res.motivosDeFalha.includes(m)) res.motivosDeFalha.push(m);
      }
    }

    res.formularios.push(resumo);
    res.novos += resumo.novos;
    res.jaTinha += resumo.jaTinha;
    res.falhas += resumo.falhas;
    if (res.semTempo) break;
  }
  return res;
}

// ⚠️ Memoizado: `ALTER TABLE` pede lock ACCESS EXCLUSIVE **mesmo quando é no-op**,
// e esta rota é chamada pelo cron de 15 em 15 minutos. Rodando a cada chamada,
// duas execuções que se cruzam se enfileiram no lock da tabela e a requisição
// morre sem resposta — foi exatamente o apagão do CRM em 16/09/2026, e repeti o
// erro aqui: a varredura passou a devolver 502 depois de 70s. Mesma lição,
// mesmo remédio.
let colunaRodizioOk = false;
async function garantirColunaRodizio(pool: Pool): Promise<void> {
  if (colunaRodizioOk) return;
  await pool.query(
    `ALTER TABLE public.meta_leadgen_paginas ADD COLUMN IF NOT EXISTS recuperado_em TIMESTAMPTZ`,
  ).catch(() => null);
  colunaRodizioOk = true;
}

/** Varre a carteira: todo cliente com Página assinada em leadgen. */
export async function recuperarLeadsDaCarteira(
  pool: Pool, opts: { dias?: number; orcamentoMs?: number; dry?: boolean } = {},
): Promise<{ clientes: Array<ResultadoRecuperacao & { nome: string }>; novos: number; semTempo: boolean }> {
  await ensureLeadgenFormsSchema(pool);
  const t0 = Date.now();
  const orcamento = opts.orcamentoMs ?? 240_000;
  // ⚠️ A ORDEM É DE RODÍZIO, não alfabética. Uma rodada raramente cabe no
  // orçamento (a carteira inteira estoura os 240s), e ordenada por nome ela
  // varreria SEMPRE os mesmos primeiros clientes — quem está no fim do alfabeto
  // nunca seria olhado, e a falha ficaria invisível exatamente como a da Meta.
  // Ordenar por "quem esperou mais" faz toda a carteira ser coberta ao longo
  // das rodadas.
  await garantirColunaRodizio(pool);
  const { rows } = await pool.query<{ client_id: string; name: string }>(
    `SELECT p.client_id, COALESCE(c.name, p.client_id) AS name
       FROM public.meta_leadgen_paginas p
       LEFT JOIN public.clients c ON c.id = p.client_id
      WHERE p.assinada = true
      ORDER BY p.recuperado_em ASC NULLS FIRST, name`,
  ).catch(() => ({ rows: [] as Array<{ client_id: string; name: string }> }));

  const clientes: Array<ResultadoRecuperacao & { nome: string }> = [];
  let novos = 0, semTempo = false;
  for (const c of rows) {
    if (Date.now() - t0 > orcamento) { semTempo = true; break; }
    const r = await recuperarLeadsDoCliente(pool, c.client_id, { ...opts, orcamentoMs: orcamento, iniciadoEm: t0 });
    if (!opts.dry) {
      await pool.query(`UPDATE public.meta_leadgen_paginas SET recuperado_em = NOW() WHERE client_id = $1`,
        [c.client_id]).catch(() => null);
    }
    clientes.push({ ...r, nome: c.name });
    novos += r.novos;
    if (r.semTempo) { semTempo = true; break; }
  }
  return { clientes, novos, semTempo };
}
