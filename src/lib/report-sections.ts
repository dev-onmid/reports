// Catálogo de páginas (seções) selecionáveis por template de relatório.
// Usado pela UI de geração ("Personalizar páginas", checkboxes) e pelos builders
// (via sectionEnabled) para incluir/excluir slides na montagem.
//
// Importante: marcar uma página NÃO garante que ela apareça — a inclusão continua
// condicionada aos dados (página marcada sem dados segue oculta, como sempre foi).
// A capa nunca é selecionável: todo relatório tem capa.

export type ReportTemplateKey = 'performance' | 'delivery' | 'social';

export type ReportSectionDef = {
  key: string;
  label: string;
  desc: string;
};

// Bloco de conteúdo orgânico (Instagram) — compartilhado pelos 3 templates,
// na mesma ordem em que os slides são montados.
const CONTEUDO_SECTIONS: ReportSectionDef[] = [
  { key: 'instagram_resumo', label: 'Instagram — visão geral', desc: 'Seguidores, alcance e engajamento do perfil' },
  { key: 'calendario',       label: 'Calendário de postagens', desc: 'Um slide por mês do período' },
  { key: 'todos_conteudos',  label: 'Todos os conteúdos',      desc: 'Detalhamento post a post — engajamento e entrega' },
  { key: 'top_conteudos',    label: 'Top conteúdos do mês',    desc: 'Os 4 posts de melhor desempenho' },
  { key: 'melhor_conteudo',  label: 'Melhor conteúdo do mês',  desc: 'Destaque do post campeão do período' },
];

const META_SECTIONS: ReportSectionDef[] = [
  { key: 'meta_resumo',    label: 'Meta Ads — resumo',    desc: 'Investimento, resultados e custo por resultado' },
  { key: 'meta_campanhas', label: 'Meta Ads — campanhas', desc: 'Cards por campanha (ou conjunto)' },
  { key: 'criativos',      label: 'Criativos em destaque', desc: 'Os melhores anúncios do período' },
];

export const REPORT_SECTIONS: Record<ReportTemplateKey, ReportSectionDef[]> = {
  performance: [
    { key: 'visao_geral',      label: 'Visão geral (CRM)',        desc: 'Faturamento, pedidos e ticket médio' },
    { key: 'regioes',          label: 'Regiões',                  desc: 'Bairros/regiões dos clientes' },
    { key: 'trafego_resumo',   label: 'Tráfego pago — resumo',    desc: 'Meta e Google lado a lado' },
    ...META_SECTIONS,
    { key: 'google_resumo',    label: 'Google Ads — resumo',      desc: 'Investimento, cliques e conversões' },
    { key: 'google_campanhas', label: 'Google Ads — campanhas',   desc: 'Cards por campanha' },
    { key: 'google_keywords',  label: 'Google Ads — palavras-chave', desc: 'Top palavras-chave compradas' },
    ...CONTEUDO_SECTIONS,
  ],
  delivery: [
    { key: 'visao_geral',       label: 'Visão geral',        desc: 'Faturamento, pedidos e ticket médio' },
    { key: 'por_dia',           label: 'Pedidos por dia',    desc: 'Evolução diária do faturamento' },
    { key: 'regioes',           label: 'Regiões',            desc: 'Bairros/regiões dos pedidos' },
    { key: 'base_clientes',     label: 'Base de clientes',   desc: 'Ativos, inativos e potenciais' },
    { key: 'clientes_inativos', label: 'Clientes inativos',  desc: 'Faixas de inatividade' },
    ...META_SECTIONS,
    ...CONTEUDO_SECTIONS,
  ],
  social: [...CONTEUDO_SECTIONS],
};

// null/undefined = comportamento padrão (todas as páginas). Array = só as listadas.
export function sectionEnabled(sections: readonly string[] | null | undefined, key: string): boolean {
  if (!sections) return true;
  return sections.includes(key);
}
