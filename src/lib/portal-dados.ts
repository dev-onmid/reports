// ── Portal do cliente: ponte read-only para as rotas internas ────────────────
//
// O cliente final não tem login no app (o porquê está em src/lib/crm-portal.ts:
// a maioria das rotas internas não filtra por quem chamou, então um login de
// cliente conseguiria pedir o `clientId` do concorrente). Esta ponte deixa a
// página do portal reaproveitar as MESMAS rotas que alimentam a dashboard
// interna — em vez de reimplementar a agregação e deixar os dois números
// divergirem na primeira mudança — mas por uma allowlist fechada.
//
// Três travas, nesta ordem:
//
//  1. A chave pedida tem que estar em FONTES. Qualquer outra é 404: a ponte
//     não encaminha caminho arbitrário, então ela não vira um túnel para as
//     303 rotas da API.
//  2. O identificador de cliente NUNCA vem do chamador. `clientId`/`clientIds`
//     que chegarem na URL do portal são descartados em PARAMS_PERMITIDOS e
//     reescritos aqui a partir do token. É isto que impede o cliente de trocar
//     o id na barra de endereço e ver a carteira do vizinho.
//  3. Rota que responde a carteira INTEIRA (crm/summary ignora `clientIds` e
//     devolve todos os clientes) passa por `filtrar`, que corta o que não é do
//     token. Sem esse passo o portal entregaria o funil de todo mundo — o
//     encaminhamento sozinho não basta.
//
// Só GET, só leitura. Fonte nova aqui = decisão de privacidade: conferir o que
// a rota devolve para o cliente ANTES de acrescentar a chave.

import { resolveMetaPeriod } from '@/lib/period-utils';

/** Parâmetros que o portal pode repassar. Tudo que não está aqui é ignorado —
 *  em especial `clientId`/`clientIds`, que são escritos a partir do token. */
const PARAMS_PERMITIDOS = ['period', 'dateFrom', 'dateTo', 'from', 'to', 'days'] as const;

type Fonte = {
  /** Monta o caminho interno já com o cliente do token embutido. */
  path: (clientId: string, p: URLSearchParams) => string;
  /** Recorta a resposta quando a rota interna responde além do cliente. */
  filtrar?: (json: unknown, clientId: string) => unknown;
};

/** Mantém só os parâmetros da allowlist, na ordem declarada (chave de cache estável). */
function limpar(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of PARAMS_PERMITIDOS) {
    const v = sp.get(k);
    if (v) out.set(k, v);
  }
  return out;
}

/**
 * Janela das rotas do CRM, que exigem `from`/`to` explícitos.
 *
 * ⚠️ Derivada do MESMO resolvedor que as rotas de mídia usam a partir de
 * `period`, não calculada aqui nem no navegador. Os dois não coincidem por
 * acaso: `last_7d` no resolvedor canônico vai de 7 dias atrás até ONTEM
 * (exclui hoje, porque o dado de mídia do dia corrente ainda está se
 * formando), e ele trabalha no fuso do Brasil, não no do aparelho de quem
 * abriu o link. Uma janela própria aqui faria o funil contar os leads de hoje
 * contra um investimento que não os inclui — e o custo por lead da tela sairia
 * diferente do custo por lead da mesma tela.
 */
function janela(sp: URLSearchParams): { from: string; to: string } {
  const bruto = resolveMetaPeriod(
    sp.get('period') ?? 'last_30d',
    sp.get('dateFrom') ?? sp.get('from') ?? '',
    sp.get('dateTo') ?? sp.get('to') ?? '',
  );
  const m = /^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(bruto);
  if (m) return { from: m[1], to: m[2] };
  // O resolvedor sempre devolve esse formato; o ramo existe para o dia em que
  // mudar, e cai numa janela válida em vez de mandar `undefined` pro SQL.
  const hoje = new Date().toISOString().slice(0, 10);
  return { from: sp.get('from') ?? hoje, to: sp.get('to') ?? hoje };
}

/** Encanamento da agência que a rota de campanhas carrega junto e a tela não usa. */
const CAMPOS_INTERNOS_CAMPANHA = ['connectionId', 'accountId', 'accountName'];

export const FONTES: Record<string, Fonte> = {
  /** Números do topo: investimento, leads, CPL, faturamento e a série diária. */
  metricas: {
    path: (id, p) => `/api/clients/${encodeURIComponent(id)}/metrics?${limpar(p)}`,
  },

  /** Campanhas de Meta e Google no período. */
  campanhas: {
    path: (id, p) => {
      const q = limpar(p);
      q.set('clientIds', id);
      return `/api/campaigns?${q}`;
    },
    // A rota devolve `connectionId` (o id da conexão de anúncios DA AGÊNCIA) e
    // o id da conta junto de cada campanha. A tela não usa nenhum dos três, e
    // encanamento interno não tem por que trafegar no navegador do cliente —
    // some aqui, não no componente, porque quem vê o payload é o navegador.
    filtrar: (json) => Array.isArray(json)
      ? json.map(c => {
          const copia = { ...(c as Record<string, unknown>) };
          for (const campo of CAMPOS_INTERNOS_CAMPANHA) delete copia[campo];
          return copia;
        })
      : json,
  },

  /** Funil comercial. ⚠️ A rota IGNORA clientIds e responde a carteira inteira —
   *  o recorte é feito aqui, não lá. */
  funil: {
    path: (_id, p) => {
      const { from, to } = janela(p);
      return `/api/crm/summary?from=${from}&to=${to}`;
    },
    filtrar: (json, id) =>
      Array.isArray(json) ? json.filter(r => (r as { clientId?: string })?.clientId === id) : [],
  },

  /** Faturamento e leads por canal de origem. */
  canais: {
    path: (id, p) => {
      const { from, to } = janela(p);
      return `/api/crm/por-canal?clientIds=${encodeURIComponent(id)}&from=${from}&to=${to}`;
    },
  },

  /** Quem vendeu e o que se vendeu. */
  comercial: {
    path: (id, p) => {
      const { from, to } = janela(p);
      return `/api/crm/desempenho?clientIds=${encodeURIComponent(id)}&from=${from}&to=${to}`;
    },
  },

  /** Instagram orgânico. */
  social: {
    path: (id, p) => {
      const { from, to } = janela(p);
      return `/api/meta/page-insights?clientIds=${encodeURIComponent(id)}&from=${from}&to=${to}`;
    },
  },

  /** Landing page (GA4). */
  landing: {
    path: (id, p) => `/api/clients/${encodeURIComponent(id)}/ga4?${limpar(p)}`,
  },

  /** Criativos com resultado. */
  criativos: {
    path: (id, p) => {
      const q = limpar(p);
      q.set('clientId', id);
      return `/api/creative-library?${q}`;
    },
  },
};

export type ChaveFonte = keyof typeof FONTES;

export function fonteValida(chave: string | null): chave is string {
  return !!chave && Object.hasOwn(FONTES, chave);
}
