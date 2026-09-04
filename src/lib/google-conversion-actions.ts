// ── Google Ads: ações de conversão (listar / criar) ──────────────────────────
//
// Consumidor: o rastreio das landing pages (~/Documents/lps, `bin/gtag ads`).
// Para montar a tag de conversão do Google Ads no GTM é preciso o par
// "ID de conversão" (AW-xxxxxxxxx) + "rótulo" — e o Google só expõe os dois
// dentro do snippet de evento (`tag_snippets[].event_snippet`, no `send_to`).
// O ID NÃO é necessariamente o customer id: com conversão entre contas
// (cross-account) o AW- é o da MCC. Por isso o parse vem do snippet, não da conta.
//
// Token/dev-token/MCC: reaproveita google-offline-conversions (mesmo caminho da
// Luna e da conversão offline).

import type { Pool } from 'pg';
import { DEV_TOKEN, gadsSearch, resolveGoogleAdsAccess, type GoogleAdsAccess } from '@/lib/google-offline-conversions';

export type ConversaoGoogle = {
  id: string;
  nome: string;
  status: string;
  tipo: string;
  categoria: string;
  contagem: string;
  principal: boolean;
  /** "AW-123456789" — vazio quando o Google não devolveu snippet */
  conversionId: string;
  /** "AbCdEfGh" — vazio quando o Google não devolveu snippet */
  rotulo: string;
  /** "AW-123456789/AbCdEfGh" — o que vai no campo send_to / na tag do GTM */
  sendTo: string;
};

/** Extrai "AW-xxx/rotulo" de um snippet de evento do Google Ads. */
export function parseSendTo(eventSnippet: string | null | undefined): { conversionId: string; rotulo: string; sendTo: string } {
  const m = /send_to['"]?\s*:\s*['"]([^'"]+)['"]/.exec(eventSnippet ?? '');
  const sendTo = m?.[1]?.trim() ?? '';
  const [conversionId = '', rotulo = ''] = sendTo.split('/');
  return { conversionId, rotulo, sendTo };
}

/** Mesmo nome, ignorando caixa/acentos/espaços repetidos — evita duplicar ação. */
export function normalizarNome(nome: string): string {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function acharPorNome(lista: ConversaoGoogle[], nome: string): ConversaoGoogle | undefined {
  const alvo = normalizarNome(nome);
  return lista.find(c => normalizarNome(c.nome) === alvo);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function linhaParaConversao(r: any): ConversaoGoogle {
  const ca = r?.conversionAction ?? {};
  const snippets: Array<{ type?: string; pageFormat?: string; eventSnippet?: string }> = ca.tagSnippets ?? [];
  const web = snippets.find(s => s.type === 'WEBPAGE' && s.pageFormat === 'HTML') ?? snippets.find(s => s.type === 'WEBPAGE') ?? snippets[0];
  return {
    id: String(ca.id ?? ''),
    nome: String(ca.name ?? ''),
    status: String(ca.status ?? ''),
    tipo: String(ca.type ?? ''),
    categoria: String(ca.category ?? ''),
    contagem: String(ca.countingType ?? ''),
    principal: Boolean(ca.primaryForGoal),
    ...parseSendTo(web?.eventSnippet),
  };
}

export const CATEGORIAS_ACEITAS = ['LEAD', 'SUBMIT_LEAD_FORM', 'CONTACT', 'PHONE_CALL_LEAD', 'BOOK_APPOINTMENT', 'SIGNUP', 'PURCHASE', 'PAGE_VIEW', 'DEFAULT'] as const;
export type CategoriaConversao = typeof CATEGORIAS_ACEITAS[number];

export type NovaConversao = {
  nome: string;
  categoria?: CategoriaConversao;
  contagem?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
  /** valor padrão em R$ (0 = sem valor) */
  valor?: number;
};

/** Operação de criação no formato da Google Ads API (conversionActions:mutate). */
export function operacaoCriar(n: NovaConversao): Record<string, unknown> {
  const valor = Number.isFinite(n.valor) && (n.valor ?? 0) > 0 ? Number((n.valor as number).toFixed(2)) : 0;
  return {
    create: {
      name: n.nome.trim(),
      type: 'WEBPAGE',
      status: 'ENABLED',
      category: n.categoria ?? 'LEAD',
      countingType: n.contagem ?? 'ONE_PER_CLICK',
      primaryForGoal: true,
      clickThroughLookbackWindowDays: 30,
      viewThroughLookbackWindowDays: 1,
      valueSettings: { defaultValue: valor, defaultCurrencyCode: 'BRL', alwaysUseDefaultValue: false },
    },
  };
}

const GAQL_LISTA =
  `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type,
          conversion_action.category, conversion_action.counting_type, conversion_action.primary_for_goal,
          conversion_action.tag_snippets
     FROM conversion_action
    WHERE conversion_action.status = 'ENABLED'
      AND conversion_action.type = 'WEBPAGE'
 ORDER BY conversion_action.name`;

export async function listarConversoes(access: GoogleAdsAccess): Promise<ConversaoGoogle[] | null> {
  const data = await gadsSearch(access.customerId, GAQL_LISTA, access.token, access.loginCustomerId);
  if (!data) return null;
  return (data.results ?? []).map(linhaParaConversao).filter(c => c.id);
}

export async function criarConversao(
  access: GoogleAdsAccess, nova: NovaConversao,
): Promise<{ resourceName: string } | { error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${access.token}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json',
  };
  if (access.loginCustomerId) headers['login-customer-id'] = access.loginCustomerId;
  const r = await fetch(`https://googleads.googleapis.com/v24/customers/${access.customerId}/conversionActions:mutate`, {
    method: 'POST', headers, body: JSON.stringify({ operations: [operacaoCriar(nova)] }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!r) return { error: 'sem resposta da Google Ads API' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await r.json().catch(() => ({})) as any;
  if (!r.ok) {
    const msg = body?.error?.details?.[0]?.errors?.[0]?.message ?? body?.error?.message ?? `HTTP ${r.status}`;
    return { error: String(msg) };
  }
  const rn = body?.results?.[0]?.resourceName;
  return rn ? { resourceName: String(rn) } : { error: 'Google não devolveu o resourceName da ação criada' };
}

export type ClienteResolvido = { id: string; name: string };

/** id exato > nome (ILIKE). Devolve todos os candidatos para o chamador decidir quando há ambiguidade. */
export async function resolverCliente(pool: Pool, ref: string): Promise<ClienteResolvido[]> {
  const termo = ref.trim();
  if (!termo) return [];
  const { rows } = await pool.query<ClienteResolvido>(
    `SELECT id, name FROM public.clients WHERE id = $1 OR name ILIKE $2 ORDER BY (id = $1) DESC, name ASC LIMIT 10`,
    [termo, `%${termo}%`],
  );
  if (rows.some(r => r.id === termo)) return rows.filter(r => r.id === termo);
  const exato = rows.filter(r => normalizarNome(r.name) === normalizarNome(termo));
  return exato.length === 1 ? exato : rows;
}

export { resolveGoogleAdsAccess };
