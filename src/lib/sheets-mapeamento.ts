/**
 * De-para de colunas da planilha → campos do CRM.
 *
 * A IA resolve isso sozinha na análise, mas o gestor precisa poder corrigir:
 * planilha de cliente não tem padrão, e a IA erra em coluna ambígua (duas datas,
 * "VALOR" que às vezes é orçamento e às vezes é venda). Pedido do Matheus
 * (2026-10-07): *"além de ser automático pela IA, gostaria de poder alterar se
 * for preciso"*.
 *
 * ⚠️ Os nomes de campo aqui são os MESMOS que `/api/integrations/spreadsheet`
 * aceita como override (`dateColumn`, `nameColumn`, …) e os mesmos que a IA
 * devolve. Renomear um deles quebra a importação em silêncio: a coluna
 * simplesmente deixa de ser usada e a linha entra sem o dado.
 */

export type CampoMapeamento = {
  chave: string;
  rotulo: string;
  /** O que esse campo faz com o dado — é o que o gestor lê para decidir. */
  ajuda: string;
  /** `contact` é a fileira de tentativas; os demais apontam uma coluna só. */
  lista?: boolean;
  /** Sem isto a importação não tem como identificar nem datar a linha. */
  essencial?: boolean;
};

/**
 * ⚠️ `clinic` fica FORA de propósito: aqui a planilha é de UM cliente, e mandar
 * a coluna de clínica faz a rota tentar um de-para clínica→cliente que não
 * existe neste caminho (ver `sheets-sync.ts`).
 */
export const CAMPOS: CampoMapeamento[] = [
  { chave: 'date', rotulo: 'Data do lead', ajuda: 'Quando o lead entrou. É por ela que o lead cai no mês certo.', essencial: true },
  { chave: 'name', rotulo: 'Nome', ajuda: 'Nome de quem entrou em contato.', essencial: true },
  { chave: 'phone', rotulo: 'Telefone', ajuda: 'É a chave que junta a linha da planilha com a conversa do WhatsApp.', essencial: true },
  { chave: 'channel', rotulo: 'Canal / origem', ajuda: 'Como o lead chegou. Alimenta o gráfico de canais.' },
  { chave: 'status', rotulo: 'Situação', ajuda: 'Texto livre do CRM do cliente. É daqui que sai a etapa do funil.' },
  { chave: 'stage', rotulo: 'Etapa do funil', ajuda: 'Use quando a planilha tiver uma coluna de etapa separada da situação.' },
  { chave: 'scheduledDate', rotulo: 'Data agendada', ajuda: 'Consulta/reunião marcada. Separa quem ainda vai vir de quem faltou.' },
  { chave: 'updatedDate', rotulo: 'Data do último contato', ajuda: 'Decide qual versão da linha é a mais nova ao reimportar.' },
  { chave: 'revenue', rotulo: 'Faturamento (R$)', ajuda: 'Valor da venda FECHADA. Só entra na receita se a planilha estiver marcada como fonte de faturamento.' },
  { chave: 'budget', rotulo: 'Orçamento (R$)', ajuda: 'Valor estimado do negócio em aberto. Nunca vira receita.' },
  { chave: 'closed', rotulo: 'Fechou', ajuda: 'Coluna que declara a venda (Sim/Não, ✅/❌).' },
  { chave: 'attended', rotulo: 'Compareceu', ajuda: 'Coluna que declara o comparecimento (Sim/Não, ✅/❌).' },
  { chave: 'contact', rotulo: 'Tentativas de contato', ajuda: 'A fileira de colunas de tentativa ("1º contato", "2º contato"…). Pode marcar várias.', lista: true },
  { chave: 'dealId', rotulo: 'Nº do negócio / orçamento', ajuda: 'Identificador do negócio. É o que liga a linha de venda ao lead que a originou.' },
  { chave: 'neighborhood', rotulo: 'Bairro / região', ajuda: 'Usado no mapa e nos recortes por região.' },
  { chave: 'payment', rotulo: 'Forma de pagamento', ajuda: 'Só informativo, aparece no detalhe do lead.' },
  { chave: 'notes', rotulo: 'Observação', ajuda: 'Texto livre que aparece no detalhe do lead.' },
];

export const CHAVES = new Set(CAMPOS.map((c) => c.chave));
export const CAMPOS_LISTA = new Set(CAMPOS.filter((c) => c.lista).map((c) => c.chave));

export type Mapeamento = Record<string, string | string[] | null>;

/** Compara nome de coluna como a importação compara: sem espaço sobrando. */
function mesma(a: string, b: string): boolean {
  return a === b || a.trim() === b.trim();
}

/**
 * Limpa o que vem da tela antes de gravar.
 *
 * ⚠️ Campo desconhecido é DESCARTADO, não gravado "por via das dúvidas": a
 * importação transforma cada chave em `<chave>Column`, então uma chave inventada
 * vira um campo de formulário que ninguém lê — e o gestor ficaria achando que
 * mapeou algo.
 *
 * ⚠️ Coluna que não existe no cabeçalho também sai. A sincronização recusa a aba
 * inteira quando uma coluna mapeada não existe (`abasCompativeis`), então deixar
 * passar um nome digitado errado derruba a importação do cliente no dia seguinte.
 * Sem `colunas`, a checagem de existência não roda (a tela pode não ter o
 * cabeçalho em mãos) e só o formato é validado.
 */
export function normalizarMapeamento(bruto: unknown, colunas?: string[] | null): Mapeamento | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const existe = (c: string) => !colunas?.length || colunas.some((h) => mesma(h, c));
  const out: Mapeamento = {};

  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!CHAVES.has(chave)) continue;

    if (CAMPOS_LISTA.has(chave)) {
      const lista = (Array.isArray(valor) ? valor : typeof valor === 'string' ? valor.split(',') : [])
        .map((v) => String(v ?? '').trim())
        .filter((v) => v.length > 0 && existe(v));
      // Sem duplicata: a mesma coluna marcada duas vezes contaria a tentativa em dobro.
      out[chave] = lista.length ? [...new Set(lista)] : null;
      continue;
    }

    const texto = typeof valor === 'string' ? valor.trim() : '';
    out[chave] = texto && existe(texto) ? texto : null;
  }
  return out;
}

/** Campos que a planilha preencheu, na ordem do catálogo. */
export function camposPreenchidos(m: Mapeamento | null): CampoMapeamento[] {
  if (!m) return [];
  return CAMPOS.filter((c) => {
    const v = m[c.chave];
    return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.length > 0;
  });
}

/**
 * Avisos para a tela. Não bloqueiam nada — a planilha do cliente é como é, e já
 * houve caso de import útil só com nome e data.
 */
export function avisosDoMapeamento(m: Mapeamento | null): string[] {
  const avisos: string[] = [];
  if (!m) return ['Nenhuma coluna mapeada ainda — analise a planilha.'];

  const tem = (k: string) => {
    const v = m[k];
    return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.length > 0;
  };

  if (!tem('date')) avisos.push('Sem a coluna de data, todo lead entra com a data da importação e o mês fica errado.');
  if (!tem('phone')) avisos.push('Sem telefone, a linha não se junta à conversa do WhatsApp e vira um lead separado.');
  if (!tem('name') && !tem('phone')) avisos.push('Sem nome e sem telefone não há como identificar a pessoa.');
  if (tem('revenue') && !tem('date')) avisos.push('Há faturamento mapeado sem data: a receita não vai cair em nenhum mês.');

  // A mesma coluna em dois campos quase sempre é engano da IA em planilha com
  // cabeçalho repetido — e o efeito (receita = orçamento) é silencioso.
  const usados = new Map<string, string[]>();
  for (const c of CAMPOS) {
    const v = m[c.chave];
    const cols = Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];
    for (const col of cols) {
      const lista = usados.get(col) ?? [];
      lista.push(c.rotulo);
      usados.set(col, lista);
    }
  }
  for (const [col, campos] of usados) {
    if (campos.length > 1) avisos.push(`A coluna "${col}" está em ${campos.join(' e ')} ao mesmo tempo.`);
  }
  return avisos;
}
