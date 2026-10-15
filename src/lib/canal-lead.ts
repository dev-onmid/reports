/**
 * O CANAL de um lead — de onde ele veio, não por qual porta o dado entrou.
 *
 * ⚠️ NÃO use `origin`. Levantamento em produção: `origin` guarda de onde o lead
 * foi IMPORTADO ('Agendor', 'Datalytics') ou o default 'organic' — nunca o
 * canal. Quem guarda o canal de verdade é **`canal`**: 'Indicação', 'TV',
 * 'Fachada/Passou em Frente', 'Facebook - WhatsApp'… (vem da coluna de origem
 * do próprio export do CRM do cliente).
 *
 * Vive numa lib compartilhada porque o donut de canais e a lista de leads do
 * funil PRECISAM concordar: dois SQLs parecidos divergiriam na primeira
 * mudança, e o gestor veria um canal no gráfico e outro na lista do mesmo lead.
 */

/**
 * Rótulos que, PARA UM CLIENTE, nomeiam a MESMA coisa e devem virar uma fatia só.
 *
 * Existe porque o rótulo não é nosso: vem da lista de origens cadastrada no CRM
 * do próprio cliente, e lá o mesmo canal costuma ter mais de um nome. No
 * CondoStore (SULTS) há duas origens para a mesma landing page — "Landing Page
 * (Google)" (id 12, usada pelo mapa da conexão) e "LP | CondoStore" (criada
 * depois, à mão) — e mais os leads em que o `gclid` sobreviveu, que caíam numa
 * terceira fatia ("Google Ads"). Três fatias para um canal.
 *
 * ⚠️ A fusão é POR CLIENTE, nunca global: em outras contas "Google Ads" e uma
 * landing page são canais legitimamente distintos, e juntá-los apagaria a
 * medição de quem paga por clique.
 *
 * ⚠️ `origens` casa contra a coluna `canal` CRUA (minúscula, sem espaço nas
 * pontas), não contra o rótulo derivado — e o branch entra ANTES da leitura de
 * click id, então aqui o canal declarado pelo cliente vence o `gclid`. É o que
 * impede um lead da OUTRA landing page do mesmo cliente (ex.: "LP | CondoStore
 * Mercado", a página de quem já conhece o produto) de ser sugado para esta
 * fatia só porque o clique veio do Google. Rótulo fora da lista continua
 * inteiro: fundir é decisão explícita, item por item.
 */
export const FUSOES_CANAL: Record<string, { destino: string; origens: string[] }[]> = {
  // CondoStore — decisão do Matheus em 2026-09-30.
  'client-1778639563347': [
    {
      destino: 'Landing Page (Google)',
      origens: ['landing page (google)', 'lp | condostore', 'google ads'],
    },
    // ⚠️ A LP /mercado é a página do público que JÁ conhece mercado autônomo
    // (criada em 2026-09-13 junto com a home, para o outro nível de
    // consciência) — fica FORA da fusão acima de propósito, senão a separação
    // que justifica as duas páginas deixa de ser medível. A entrada de um item
    // só existe para o canal declarado vencer o `gclid` aqui também: sem ela o
    // lead dessa LP reaparece como "Google Ads", o rótulo genérico que a fusão
    // veio tirar da tela.
    { destino: 'LP | CondoStore Mercado', origens: ['lp | condostore mercado'] },
  ],
};

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Branches de fusão (vazio quando não há nenhuma cadastrada). */
function fusoesSql(c: string): string {
  const linhas: string[] = [];
  for (const [clientId, regras] of Object.entries(FUSOES_CANAL)) {
    for (const regra of regras) {
      if (regra.origens.length === 0) continue;
      const lista = regra.origens.map((o) => lit(o.toLowerCase())).join(', ');
      linhas.push(
        `  WHEN ${c}client_id = ${lit(clientId)}
` +
          `   AND lower(btrim(${c}canal)) IN (${lista}) THEN ${lit(regra.destino)}`,
      );
    }
  }
  return linhas.length ? `${linhas.join('\n')}\n` : '';
}

/**
 * Expressão SQL do canal do lead.
 *
 * ⚠️ Pressupõe a tabela `crm_leads` sem alias (ou o alias em `pre`), e usa as
 * colunas `client_id` e `canal` — as fusões de `FUSOES_CANAL` dependem das duas.
 */
export function canalSql(pre = ''): string {
  const c = pre ? `${pre}.` : '';
  return `CASE
${fusoesSql(c)}  -- Lead de anúncio da Meta (click id presente): a REDE vem do que o webhook
  -- gravou em canal/origin ("Instagram", "Facebook", "Facebook - WhatsApp"…) e o
  -- TIPO do que o trouxe — formulário nativo ou conversa no WhatsApp. Pedido do
  -- Matheus (08/10/2026): "Meta Ads tem que ser dividido entre Facebook e
  -- Instagram, e aí dividir o que for formulário e o que for whatsapp". Antes
  -- tudo isso virava a fatia única "Meta Ads", jogando fora o que já estava gravado.
  WHEN NULLIF(${c}ctwa_clid, '') IS NOT NULL OR NULLIF(${c}fbclid, '') IS NOT NULL THEN
    (CASE
       WHEN lower(${c}canal) LIKE '%instagram%' OR ${c}origin = 'instagram' THEN 'Instagram'
       WHEN lower(${c}canal) LIKE '%facebook%' OR lower(${c}canal) LIKE 'fb%' OR ${c}origin = 'meta' THEN 'Facebook'
       ELSE 'Meta Ads'
     END)
    || (CASE
          WHEN lower(${c}canal) LIKE '%formul%' THEN ' · Formulário'
          WHEN NULLIF(${c}ctwa_clid, '') IS NOT NULL THEN ' · WhatsApp'
          ELSE ''
        END)
  WHEN NULLIF(${c}gclid, '') IS NOT NULL OR NULLIF(${c}wbraid, '') IS NOT NULL
    OR NULLIF(${c}gbraid, '') IS NOT NULL THEN 'Google Ads'
  WHEN NULLIF(btrim(${c}canal), '') IS NOT NULL
   AND lower(btrim(${c}canal)) NOT IN ('agendor', 'datalytics', 'planilha', 'importacao', 'crm')
    THEN btrim(${c}canal)
  -- Leads do Agendor: a ingestão grava canal='agendor' e joga a origem real
  -- ("Origem no Agendor: Google") só dentro da observação. Enquanto ela não
  -- gravar isso em coluna própria, é daqui que o canal sai.
  WHEN ${c}observacao LIKE '%Origem no Agendor: %'
    THEN btrim(substring(${c}observacao from 'Origem no Agendor: ([^·]+)'))
  WHEN NULLIF(btrim(${c}utm_source), '') IS NOT NULL THEN btrim(${c}utm_source)
  ELSE NULL
END`;
}

/** Sem alias — o caso do agrupamento por canal. */
export const CANAL_SQL = canalSql();

/** Rótulos legíveis para os canais que chegam em vocabulário de máquina. */
export const ROTULO_CANAL: Record<string, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  organic: 'Orgânico / Direto',
  organico: 'Orgânico / Direto',
};

/** Nome de exibição do canal. Vazio vira o rótulo de lacuna, nunca string vazia. */
export function rotularCanal(cru: string | null | undefined): string | null {
  const t = cru?.trim();
  if (!t) return null;
  return ROTULO_CANAL[t.toLowerCase()] ?? t;
}
