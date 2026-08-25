/**
 * Classifica a ORIGEM de um lead em digital, offline ou desconhecida.
 *
 * Pedido do Matheus: "tudo relacionado a Origem precisamos puxar e identificar
 * o que é digital". Cada cliente cadastra a própria lista de origens no CRM, e
 * elas não têm vocabulário comum — o que existe é a INTENÇÃO por trás do nome.
 *
 * Vocabulário real das contas conectadas (2026-08-25):
 *  • Londrigifts/Incorpast: Google, Instagram, Email MKT, Linkedin, Indicação,
 *    Carteira, Licitação, Prospecção, Networking, Grupos, Representantes,
 *    Parceiros Comerciais, Resgate - Aquário, Fachada/Passou em Frente
 *  • Cinfel: Redes sociais, Site/Google, Mercado Livre, Fachada, Eventos/feiras,
 *    Indicação de clientes, Indicação de parceiros, Prospecção, Outros,
 *    Cliente da carteira
 *
 * ⚠️ Nunca devolve 'offline' por eliminação. Origem que não casa com nenhuma
 * das duas listas volta 'desconhecida' — chamar de offline o que não se
 * reconhece esconderia canal digital novo (um "TikTok" cadastrado amanhã
 * apareceria como offline e a mídia perderia crédito por uma lista velha).
 */

export type ClasseOrigem = 'digital' | 'offline' | 'desconhecida';

/**
 * Minúsculas, sem acento, só letras/números — e SINGULAR.
 *
 * ⚠️ O singular não é enfeite: as contas escrevem "Representantes",
 * "Eventos/feiras", "Indicação de clientes". Sem reduzir o plural, o termo
 * "representante" da lista nunca casava e a origem caía em 'desconhecida'.
 * O mesmo corte é aplicado ao TERMO da lista, então os dois lados se encontram
 * ("redes sociais" e o termo "redes sociais" viram a mesma coisa).
 */
function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/** Marcas e termos que só existem em canal digital. */
const DIGITAL = [
  'google', 'ads', 'adwords', 'instagram', 'insta', 'facebook', 'meta', 'whatsapp',
  'site', 'website', 'web', 'landing', 'formulario', 'form',
  'email mkt', 'e mail mkt', 'email marketing', 'emailmkt', 'newsletter', 'disparo',
  'redes sociais', 'rede social', 'social', 'linkedin', 'tiktok', 'youtube', 'twitter',
  'mercado livre', 'marketplace', 'shopee', 'olx',
  'trafego', 'anuncio', 'campanha', 'organico', 'seo', 'blog', 'chatwoot',
];

/** Termos que só existem fora do digital. */
const OFFLINE = [
  'indicacao', 'indicado', 'boca a boca', 'fachada', 'passou em frente', 'passante',
  'evento', 'feira', 'congresso', 'palestra', 'visita',
  'prospeccao', 'prospect', 'cold call', 'ligacao', 'telefone', 'ptv',
  'carteira', 'cliente da carteira', 'resgate', 'reativacao', 'reavaliacao',
  'licitacao', 'representante', 'parceiro', 'networking', 'radio', 'tv',
  'panfleto', 'outdoor', 'jornal', 'revista', 'balcao', 'loja',
];

/** `true` quando o termo aparece como palavra/expressão inteira no texto. */
function contem(texto: string, termo: string): boolean {
  return ` ${texto} `.includes(` ${termo} `) || texto.startsWith(`${termo} `) || texto.endsWith(` ${termo}`) || texto === termo;
}

export function classificarOrigem(origem: unknown): ClasseOrigem {
  const s = normalizar(origem);
  const casa = (lista: readonly string[]) => lista.some(t => contem(s, normalizar(t)));
  if (!s) return 'desconhecida';
  // ⚠️ Marcas da fonte não são origem: 'agendor'/'datalytics' é por onde o dado
  // ENTROU. Tratá-las como origem faria o painel dizer que o CRM é um canal.
  if (s === 'agendor' || s === 'datalytics' || s === 'outros' || s === 'outro') return 'desconhecida';

  // Digital vence: "Instagram - Indicação" é lead que veio do Instagram.
  if (casa(DIGITAL)) return 'digital';
  if (casa(OFFLINE)) return 'offline';
  return 'desconhecida';
}

/** `true` só quando é digital de verdade — desconhecida NÃO conta como digital. */
export function origemEhDigital(origem: unknown): boolean {
  return classificarOrigem(origem) === 'digital';
}
