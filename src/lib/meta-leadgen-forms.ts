// ── Meta Lead Ads: formulários nativos da Página do cliente ───────────────────
//
// Pedido do Matheus (13/09): "forms meta nas formas de captura deveria puxar
// todos os forms nativos vinculados à página e IG, só selecionar". Antes o
// tipo "Meta Forms" do wizard só gerava um webhook para Make/Zapier.
//
// 2ª decisão do Matheus, mesma tarde: "deixa automático qualquer formulário
// vinculado à página ou à conta do cliente, sem selecionar qual form vai pro
// CRM". Então NÃO há escolha: conectar é por PÁGINA — (1) mapa página→cliente
// para o webhook resolver o dono do lead, (2) assinar a Página no nosso app
// com o campo `leadgen` (medido em 13/09: a Página do CondoStore tinha ZERO
// assinaturas — sem isso a Meta nunca manda o evento), (3) registrar TODOS os
// formulários da Página (só para a tela mostrar contadores; formulário novo
// criado depois entra do mesmo jeito, porque a assinatura é da Página).
// Roda sozinho: ao abrir a aba do cliente (GET) e na rotina diária da carteira.
//
// ⚠️ A ingestão em si já existia (`processLeadgenEvent`, webhook `object=page`
// + `field=leadgen`). Este módulo só liga a tubulação que faltava; não cria um
// segundo caminho de lead.

import type { Pool } from 'pg';
import { getFreshMetaToken } from '@/lib/meta-token';

// Mesmo shape mínimo que getClientMetaAdsToken passa ao getFreshMetaToken.
type MetaConnRow = { id: string; app_id: string; access_token: string; token_expiry: string | null };
import { ensureLeadgenSchema } from '@/lib/meta-leadgen';

const GRAPH = 'https://graph.facebook.com/v21.0';

export type FormularioMeta = {
  id: string;
  nome: string;
  status: string;            // ACTIVE | ARCHIVED | DELETED | DRAFT
  leadsTotal: number;        // leads_count da Meta (histórico do formulário)
  criadoEm: string | null;
  perguntas: string[];       // chaves das perguntas (full_name, phone_number, …)
};

export type PaginaDoCliente = {
  pageId: string;
  pageName: string;
  pageToken: string;
};

export type FormularioConectado = {
  formId: string;
  pageId: string;
  formName: string;
  status: string | null;
  leadsRecebidos: number;
  lastLeadAt: string | null;
  connectedAt: string;
};

let schemaOk = false;
export async function ensureLeadgenFormsSchema(pool: Pool) {
  if (schemaOk) return;
  await ensureLeadgenSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_leadgen_forms (
      form_id         TEXT PRIMARY KEY,
      client_id       TEXT NOT NULL,
      page_id         TEXT NOT NULL,
      form_name       TEXT,
      status          TEXT,
      leads_recebidos INT NOT NULL DEFAULT 0,
      last_lead_at    TIMESTAMPTZ,
      connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS meta_leadgen_forms_client_idx ON public.meta_leadgen_forms (client_id);
    CREATE TABLE IF NOT EXISTS public.meta_leadgen_paginas (
      client_id   TEXT PRIMARY KEY,
      page_id     TEXT,
      page_name   TEXT,
      assinada    BOOLEAN NOT NULL DEFAULT FALSE,
      formularios INT NOT NULL DEFAULT 0,
      erro        TEXT,
      checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaOk = true;
}

export type StatusPagina = {
  pageId: string | null;
  pageName: string | null;
  assinada: boolean;
  formularios: number;
  erro: string | null;
  checkedAt: string | null;
};

// ── Puras (testáveis sem rede) ───────────────────────────────────────────────

type RawForm = {
  id?: string; name?: string; status?: string; leads_count?: number; created_time?: string;
  questions?: Array<{ key?: string; label?: string; type?: string }>;
};

export function normalizarFormulario(raw: RawForm): FormularioMeta | null {
  const id = String(raw?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    nome: String(raw.name ?? '').trim() || `Formulário ${id}`,
    status: String(raw.status ?? 'UNKNOWN').toUpperCase(),
    leadsTotal: Number.isFinite(Number(raw.leads_count)) ? Number(raw.leads_count) : 0,
    criadoEm: raw.created_time ?? null,
    perguntas: (raw.questions ?? []).map(q => String(q?.key ?? q?.type ?? '').trim()).filter(Boolean),
  };
}

/** Ordem de exibição: ativos primeiro, depois quem mais gerou lead, depois nome. */
export function ordenarFormularios(lista: FormularioMeta[]): FormularioMeta[] {
  const peso = (s: string) => (s === 'ACTIVE' ? 0 : s === 'DRAFT' ? 1 : 2);
  return [...lista].sort((a, b) =>
    peso(a.status) - peso(b.status) || b.leadsTotal - a.leadsTotal || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Campos a assinar na Página. ⚠️ O POST em `subscribed_apps` SUBSTITUI a lista
 * de campos do app naquela Página — mandar só `leadgen` desligaria `feed`/
 * `messages` que outra automação já use. Por isso mescla com o que existe.
 */
export function mesclarCamposAssinados(existentes: string[] | null | undefined, novo: string): string[] {
  const set = new Set((existentes ?? []).map(s => s.trim()).filter(Boolean));
  set.add(novo);
  return [...set].sort();
}

// ── Token e Página ───────────────────────────────────────────────────────────

async function tokenDeUsuario(pool: Pool, clientId: string): Promise<string | null> {
  // Preferência: a conexão vinculada à conta de anúncio do cliente; senão a
  // conexão conectada mais recente (é a de agência, vê todas as Páginas).
  const { rows: links } = await pool.query<{ connection_id: string | null }>(
    `SELECT connection_id FROM public.client_account_links
      WHERE client_id = $1 AND platform IN ('meta_ads','meta') AND connection_id IS NOT NULL
      ORDER BY created_at ASC LIMIT 1`, [clientId],
  ).catch(() => ({ rows: [] as Array<{ connection_id: string | null }> }));
  const connId = links[0]?.connection_id ?? null;
  const { rows: conns } = await pool.query<MetaConnRow>(
    connId
      ? `SELECT * FROM public.meta_connections WHERE id = $1 AND status = 'connected' LIMIT 1`
      : `SELECT * FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
    connId ? [connId] : [],
  ).catch(() => ({ rows: [] as MetaConnRow[] }));
  const conn = conns[0] ?? (connId
    ? (await pool.query<MetaConnRow>(`SELECT * FROM public.meta_connections WHERE status='connected' ORDER BY connected_at DESC LIMIT 1`)).rows[0]
    : undefined);
  if (!conn) return null;
  try { return await getFreshMetaToken(conn); } catch { return conn.access_token ?? null; }
}

/**
 * Resolve a Página do Facebook do cliente e o token dela.
 * Ordem: snapshot do monitor social (já resolvido e barato) → vínculo
 * `facebook` → vínculo `instagram` (acha a Página dona do IG em me/accounts).
 * ⚠️ Nunca chuta "a primeira Página da conexão" — lição do bug de conta
 * cruzada de 04/08.
 */
export async function resolverPaginaDoCliente(
  pool: Pool, clientId: string,
): Promise<{ pagina: PaginaDoCliente | null; motivo: string | null }> {
  const token = await tokenDeUsuario(pool, clientId);
  if (!token) return { pagina: null, motivo: 'Nenhuma conexão Meta ativa.' };

  const { rows: [snap] } = await pool.query<{ page_id: string | null; ig_id: string | null }>(
    `SELECT page_id, ig_id FROM public.social_monitor_snapshots WHERE client_id = $1 LIMIT 1`, [clientId],
  ).catch(() => ({ rows: [] as Array<{ page_id: string | null; ig_id: string | null }> }));
  const { rows: links } = await pool.query<{ platform: string; account_id: string }>(
    `SELECT platform, account_id FROM public.client_account_links
      WHERE client_id = $1 AND platform IN ('facebook','instagram') ORDER BY created_at ASC`, [clientId],
  ).catch(() => ({ rows: [] as Array<{ platform: string; account_id: string }> }));

  let pageId: string | null = snap?.page_id ?? links.find(l => l.platform === 'facebook')?.account_id ?? null;

  if (!pageId) {
    const igId = snap?.ig_id ?? links.find(l => l.platform === 'instagram')?.account_id ?? null;
    if (igId) {
      const r = await graph<{ data?: Array<{ id: string; instagram_business_account?: { id: string } }> }>(
        `/me/accounts?fields=id,instagram_business_account{id}&limit=100`, token);
      pageId = r?.data?.find(p => p.instagram_business_account?.id === igId)?.id ?? null;
    }
  }
  if (!pageId) {
    return { pagina: null, motivo: 'Este cliente não tem Página do Facebook nem Instagram vinculados. Vincule pelos ícones do cliente (Facebook ou Instagram) e volte aqui.' };
  }

  const page = await graph<{ id?: string; name?: string; access_token?: string; error?: { message?: string } }>(
    `/${pageId}?fields=id,name,access_token`, token);
  if (!page?.access_token) {
    return { pagina: null, motivo: `A conexão Meta atual não administra a Página ${page?.name ?? pageId}. Reconecte a Meta com um perfil que seja admin dessa Página.` };
  }
  return { pagina: { pageId: String(page.id ?? pageId), pageName: page.name ?? pageId, pageToken: page.access_token }, motivo: null };
}

// ── Graph ────────────────────────────────────────────────────────────────────

async function graph<T>(path: string, token: string, init?: RequestInit): Promise<T | null> {
  try {
    const url = new URL(`${GRAPH}${path}`);
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
    const res = await fetch(url.toString(), { ...init, signal: AbortSignal.timeout(15000) });
    return await res.json() as T;
  } catch { return null; }
}

export async function listarFormularios(pagina: PaginaDoCliente): Promise<{ formularios: FormularioMeta[]; erro: string | null }> {
  const out: FormularioMeta[] = [];
  let path: string | null = `/${pagina.pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time,questions{key,label,type}&limit=100`;
  type Pagina = { data?: RawForm[]; paging?: { next?: string }; error?: { message?: string } };
  for (let i = 0; i < 5 && path; i++) {
    const r: Pagina | null = await graph<Pagina>(path, pagina.pageToken);
    if (!r) return { formularios: out, erro: 'Sem resposta da Meta.' };
    if (r.error) return { formularios: out, erro: r.error.message ?? 'A Meta recusou a listagem de formulários.' };
    for (const f of r.data ?? []) { const n = normalizarFormulario(f); if (n) out.push(n); }
    path = r.paging?.next ? r.paging.next.replace(GRAPH, '') : null;
  }
  return { formularios: ordenarFormularios(out), erro: null };
}

/** Quais campos o NOSSO app já recebe desta Página (vazio = Página não assinada). */
export async function camposAssinadosNaPagina(pagina: PaginaDoCliente): Promise<string[]> {
  const r = await graph<{ data?: Array<{ subscribed_fields?: string[] }> }>(`/${pagina.pageId}/subscribed_apps`, pagina.pageToken);
  return r?.data?.[0]?.subscribed_fields ?? [];
}

export async function assinarPaginaParaLeadgen(pagina: PaginaDoCliente): Promise<{ ok: boolean; campos: string[]; erro: string | null }> {
  const atuais = await camposAssinadosNaPagina(pagina);
  const campos = mesclarCamposAssinados(atuais, 'leadgen');
  if (atuais.includes('leadgen')) return { ok: true, campos: atuais, erro: null };
  const r = await graph<{ success?: boolean; error?: { message?: string } }>(
    `/${pagina.pageId}/subscribed_apps`, pagina.pageToken,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed_fields: campos.join(','), access_token: pagina.pageToken }) },
  );
  if (!r?.success) return { ok: false, campos: atuais, erro: r?.error?.message ?? 'A Meta recusou a assinatura da Página.' };
  return { ok: true, campos, erro: null };
}

// ── Persistência ─────────────────────────────────────────────────────────────

export async function listarConectados(pool: Pool, clientId: string): Promise<FormularioConectado[]> {
  await ensureLeadgenFormsSchema(pool);
  const { rows } = await pool.query(
    `SELECT form_id, page_id, form_name, status, leads_recebidos, last_lead_at, connected_at
       FROM public.meta_leadgen_forms WHERE client_id = $1 ORDER BY connected_at DESC`, [clientId]);
  return rows.map(r => ({
    formId: r.form_id, pageId: r.page_id, formName: r.form_name ?? '', status: r.status ?? null,
    leadsRecebidos: Number(r.leads_recebidos ?? 0), lastLeadAt: r.last_lead_at ?? null, connectedAt: r.connected_at,
  }));
}

/**
 * Conecta a PÁGINA do cliente inteira ao CRM — idempotente, roda sozinha.
 * ⚠️ A Página é PK do mapa página→cliente: se já pertence a OUTRO cliente,
 * recusa em vez de roubar em silêncio (o webhook passaria a entregar todos os
 * leads daquela Página no cliente errado — caso real Cinfel/Cinfel Filial).
 */
export async function conectarPaginaDoCliente(pool: Pool, clientId: string): Promise<StatusPagina> {
  await ensureLeadgenFormsSchema(pool);
  const gravar = async (s: Omit<StatusPagina, 'checkedAt'>) => {
    await pool.query(
      `INSERT INTO public.meta_leadgen_paginas (client_id, page_id, page_name, assinada, formularios, erro, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (client_id) DO UPDATE SET page_id=EXCLUDED.page_id, page_name=EXCLUDED.page_name,
         assinada=EXCLUDED.assinada, formularios=EXCLUDED.formularios, erro=EXCLUDED.erro, checked_at=NOW()`,
      [clientId, s.pageId, s.pageName, s.assinada, s.formularios, s.erro]).catch(() => null);
    return { ...s, checkedAt: new Date().toISOString() };
  };

  const { pagina, motivo } = await resolverPaginaDoCliente(pool, clientId);
  if (!pagina) return gravar({ pageId: null, pageName: null, assinada: false, formularios: 0, erro: motivo });

  const { rows: [dono] } = await pool.query<{ client_id: string }>(
    `SELECT client_id FROM public.meta_leadgen_page_map WHERE page_id = $1`, [pagina.pageId]);
  if (dono && dono.client_id !== clientId) {
    const { rows: [c] } = await pool.query<{ name: string }>(`SELECT name FROM public.clients WHERE id = $1`, [dono.client_id]).catch(() => ({ rows: [] as Array<{ name: string }> }));
    return gravar({ pageId: pagina.pageId, pageName: pagina.pageName, assinada: false, formularios: 0,
      erro: `A Página ${pagina.pageName} já entrega leads para o cliente "${c?.name ?? dono.client_id}". Uma Página alimenta um cliente só.` });
  }
  await pool.query(`INSERT INTO public.meta_leadgen_page_map (page_id, client_id) VALUES ($1,$2) ON CONFLICT (page_id) DO NOTHING`,
    [pagina.pageId, clientId]);

  const assinatura = await assinarPaginaParaLeadgen(pagina);
  const { formularios, erro: erroLista } = await listarFormularios(pagina);
  for (const f of formularios) {
    await pool.query(
      `INSERT INTO public.meta_leadgen_forms (form_id, client_id, page_id, form_name, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (form_id) DO UPDATE SET form_name = EXCLUDED.form_name, status = EXCLUDED.status, page_id = EXCLUDED.page_id
       WHERE public.meta_leadgen_forms.client_id = EXCLUDED.client_id`,
      [f.id, clientId, pagina.pageId, f.nome, f.status]).catch(() => null);
  }
  return gravar({ pageId: pagina.pageId, pageName: pagina.pageName, assinada: assinatura.ok, formularios: formularios.length,
    erro: assinatura.ok ? erroLista : (assinatura.erro ?? 'A Meta recusou a assinatura da Página.') });
}

export async function statusDaPagina(pool: Pool, clientId: string): Promise<StatusPagina | null> {
  await ensureLeadgenFormsSchema(pool);
  const { rows: [r] } = await pool.query(`SELECT * FROM public.meta_leadgen_paginas WHERE client_id = $1`, [clientId]);
  if (!r) return null;
  return { pageId: r.page_id ?? null, pageName: r.page_name ?? null, assinada: !!r.assinada,
    formularios: Number(r.formularios ?? 0), erro: r.erro ?? null, checkedAt: r.checked_at ?? null };
}

/** Desliga: tira `leadgen` da assinatura da Página, solta o mapa e apaga o status. Os formulários ficam (histórico). */
export async function desligarPaginaDoCliente(pool: Pool, clientId: string): Promise<boolean> {
  await ensureLeadgenFormsSchema(pool);
  const { pagina } = await resolverPaginaDoCliente(pool, clientId);
  if (pagina) {
    const atuais = await camposAssinadosNaPagina(pagina);
    const restantes = atuais.filter(c => c !== 'leadgen');
    if (atuais.includes('leadgen')) {
      await graph(`/${pagina.pageId}/subscribed_apps`, pagina.pageToken,
        restantes.length
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscribed_fields: restantes.join(','), access_token: pagina.pageToken }) }
          : { method: 'DELETE' });
    }
    await pool.query(`DELETE FROM public.meta_leadgen_page_map WHERE page_id = $1 AND client_id = $2`, [pagina.pageId, clientId]);
  }
  const r = await pool.query(`DELETE FROM public.meta_leadgen_paginas WHERE client_id = $1`, [clientId]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Rotina da carteira: garante Página mapeada + assinada para todo cliente
 * ativo com Página/Instagram vinculado. Orçamento de tempo para caber num cron.
 */
export async function garantirLeadgenParaTodos(pool: Pool, orcamentoMs = 200_000): Promise<{
  total: number; assinadas: number; semPagina: number; erros: number; semTempo: number; detalhes: Array<{ clientId: string; nome: string; ok: boolean; erro: string | null }>;
}> {
  const inicio = Date.now();
  const { rows: clientes } = await pool.query<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM public.clients c
      WHERE COALESCE(c.status,'Ativo') NOT IN ('Arquivado','Inativo')
        AND (EXISTS (SELECT 1 FROM public.client_account_links l WHERE l.client_id = c.id AND l.platform IN ('facebook','instagram'))
          OR EXISTS (SELECT 1 FROM public.social_monitor_snapshots s WHERE s.client_id = c.id AND s.page_id IS NOT NULL))
      ORDER BY c.name`);
  const out = { total: clientes.length, assinadas: 0, semPagina: 0, erros: 0, semTempo: 0, detalhes: [] as Array<{ clientId: string; nome: string; ok: boolean; erro: string | null }> };
  for (const c of clientes) {
    if (Date.now() - inicio > orcamentoMs) { out.semTempo++; continue; }
    const s = await conectarPaginaDoCliente(pool, c.id).catch(e => ({ pageId: null, pageName: null, assinada: false, formularios: 0, erro: e instanceof Error ? e.message : String(e), checkedAt: null } as StatusPagina));
    if (s.assinada) out.assinadas++; else if (!s.pageId) out.semPagina++; else out.erros++;
    out.detalhes.push({ clientId: c.id, nome: c.name, ok: s.assinada, erro: s.assinada ? null : s.erro });
  }
  return out;
}
