// ── Meta Lead Ads: formulários nativos da Página do cliente ───────────────────
//
// Pedido do Matheus (13/09): "forms meta nas formas de captura deveria puxar
// todos os forms nativos vinculados à página e IG, só selecionar". Antes o
// tipo "Meta Forms" do wizard só gerava um webhook para Make/Zapier.
//
// Fluxo nativo: resolver a Página do cliente → listar `/{page}/leadgen_forms`
// → o gestor escolhe → conectar = (1) mapa página→cliente para o webhook
// resolver o dono do lead, (2) assinar a Página no nosso app com o campo
// `leadgen` (medido em 13/09: a Página do CondoStore tinha ZERO assinaturas —
// sem isso a Meta nunca manda o evento), (3) registrar o formulário escolhido.
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
  `);
  schemaOk = true;
}

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
 * Liga o formulário ao cliente. ⚠️ A Página é PK do mapa página→cliente: se
 * já pertence a OUTRO cliente, recusa em vez de roubar em silêncio — o webhook
 * passaria a entregar todos os leads daquela Página no cliente errado.
 */
export async function conectarFormularios(
  pool: Pool, clientId: string, pagina: PaginaDoCliente, forms: FormularioMeta[],
): Promise<{ conectados: string[]; erro: string | null }> {
  await ensureLeadgenFormsSchema(pool);
  const { rows: [dono] } = await pool.query<{ client_id: string }>(
    `SELECT client_id FROM public.meta_leadgen_page_map WHERE page_id = $1`, [pagina.pageId]);
  if (dono && dono.client_id !== clientId) {
    const { rows: [c] } = await pool.query<{ name: string }>(`SELECT name FROM public.clients WHERE id = $1`, [dono.client_id]).catch(() => ({ rows: [] as Array<{ name: string }> }));
    return { conectados: [], erro: `A Página ${pagina.pageName} já está ligada ao cliente "${c?.name ?? dono.client_id}". Uma Página entrega leads para um cliente só.` };
  }
  await pool.query(
    `INSERT INTO public.meta_leadgen_page_map (page_id, client_id) VALUES ($1, $2)
     ON CONFLICT (page_id) DO NOTHING`, [pagina.pageId, clientId]);
  const conectados: string[] = [];
  for (const f of forms) {
    await pool.query(
      `INSERT INTO public.meta_leadgen_forms (form_id, client_id, page_id, form_name, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (form_id) DO UPDATE SET form_name = EXCLUDED.form_name, status = EXCLUDED.status
       WHERE public.meta_leadgen_forms.client_id = EXCLUDED.client_id`,
      [f.id, clientId, pagina.pageId, f.nome, f.status]);
    conectados.push(f.id);
  }
  return { conectados, erro: null };
}

export async function desconectarFormulario(pool: Pool, clientId: string, formId: string): Promise<boolean> {
  await ensureLeadgenFormsSchema(pool);
  const r = await pool.query(`DELETE FROM public.meta_leadgen_forms WHERE client_id = $1 AND form_id = $2`, [clientId, formId]);
  return (r.rowCount ?? 0) > 0;
}
