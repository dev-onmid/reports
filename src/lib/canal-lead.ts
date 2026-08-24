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
 *
 * ⚠️ A expressão pressupõe que a tabela `crm_leads` esteja sem alias (ou que o
 * caller passe o alias em `pre`).
 */
export function canalSql(pre = ''): string {
  const c = pre ? `${pre}.` : '';
  return `CASE
  WHEN NULLIF(${c}ctwa_clid, '') IS NOT NULL OR NULLIF(${c}fbclid, '') IS NOT NULL THEN 'Meta Ads'
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
