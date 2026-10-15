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
  /**
   * Outros nomes que a MESMA coluna recebe em planilha de cliente.
   *
   * ⚠️ Casados por IGUALDADE (sem acento e sem caixa), nunca por "contém" — a
   * lição do `resolverAbaDoMes`: com `contains`, uma coluna "PRODUTOS" casaria
   * com OUT(ubro) e o sistema importaria a coisa errada calado. "VALOR" solto
   * fica fora de `revenue` de propósito: numa planilha com orçamento e venda,
   * ele cairia no campo errado e a receita viraria estimativa.
   */
  sinonimos?: string[];
};

/**
 * ⚠️ `clinic` fica FORA de propósito: aqui a planilha é de UM cliente, e mandar
 * a coluna de clínica faz a rota tentar um de-para clínica→cliente que não
 * existe neste caminho (ver `sheets-sync.ts`).
 */
export const CAMPOS: CampoMapeamento[] = [
  { chave: 'date', rotulo: 'Data do lead', ajuda: 'Quando o lead entrou. É por ela que o lead cai no mês certo.', essencial: true,
    sinonimos: ['DATA ENTRADA', 'DATA DE ENTRADA', 'DATA DO LEAD', 'DATA CADASTRO', 'DATA DE CADASTRO', 'DT ENTRADA', 'ENTRADA', 'DATA LEAD'] },
  { chave: 'name', rotulo: 'Nome', ajuda: 'Nome de quem entrou em contato.', essencial: true,
    sinonimos: ['NOME COMPLETO', 'NOME DO LEAD', 'PACIENTE', 'CLIENTE', 'LEAD', 'NOME CLIENTE'] },
  { chave: 'phone', rotulo: 'Telefone', ajuda: 'É a chave que junta a linha da planilha com a conversa do WhatsApp.', essencial: true,
    sinonimos: ['TEL', 'FONE', 'CELULAR', 'WHATSAPP', 'WHATS', 'NUMERO', 'TELEFONE CONTATO', 'TELEFONE PACIENTE'] },
  { chave: 'channel', rotulo: 'Canal / origem', ajuda: 'Como o lead chegou. Alimenta o gráfico de canais.',
    sinonimos: ['ORIGEM', 'MIDIA', 'FONTE', 'COMO NOS CONHECEU', 'PLATAFORMA', 'CANAL DE ENTRADA'] },
  { chave: 'status', rotulo: 'Situação', ajuda: 'Texto livre do CRM do cliente. É daqui que sai a etapa do funil.',
    sinonimos: ['SITUACAO', 'STATUS LEAD', 'STATUS DO LEAD', 'SITUACAO DO LEAD'] },
  { chave: 'stage', rotulo: 'Etapa do funil', ajuda: 'Use quando a planilha tiver uma coluna de etapa separada da situação.',
    sinonimos: ['ETAPA', 'FASE', 'FUNIL', 'ESTAGIO'] },
  { chave: 'scheduledDate', rotulo: 'Data agendada', ajuda: 'Consulta/reunião marcada. Separa quem ainda vai vir de quem faltou.',
    sinonimos: ['DATA AGENDADA', 'DATA DO AGENDAMENTO', 'AGENDAMENTO', 'DATA AVALIACAO AGENDADA', 'DATA DA CONSULTA'] },
  { chave: 'updatedDate', rotulo: 'Data do último contato', ajuda: 'Decide qual versão da linha é a mais nova ao reimportar.',
    sinonimos: ['DATA CONTATO', 'DATA DO CONTATO', 'ULTIMO CONTATO', 'DATA ULTIMO CONTATO', 'DATA DE RETORNO'] },
  { chave: 'revenue', rotulo: 'Faturamento (R$)', ajuda: 'Valor da venda FECHADA. Só entra na receita se a planilha estiver marcada como fonte de faturamento.',
    sinonimos: ['VALOR FECHADO', 'VALOR DA VENDA', 'FATURAMENTO', 'RECEITA', 'VALOR PAGO', 'TOTAL PAGO'] },
  { chave: 'budget', rotulo: 'Orçamento (R$)', ajuda: 'Valor estimado do negócio em aberto. Nunca vira receita.',
    sinonimos: ['ORCAMENTO', 'VALOR ORCAMENTO', 'VALOR DO ORCAMENTO', 'VALOR DO ORCAM', 'ORCAM'] },
  { chave: 'closed', rotulo: 'Fechou', ajuda: 'Coluna que declara a venda (Sim/Não, ✅/❌).',
    sinonimos: ['FECHOU?', 'FECHADO', 'VENDEU', 'CONVERTEU', 'VENDA'] },
  { chave: 'attended', rotulo: 'Compareceu', ajuda: 'Coluna que declara o comparecimento (Sim/Não, ✅/❌).',
    sinonimos: ['COMP', 'COMPARECIMENTO', 'PRESENCA', 'COMPARECEU?'] },
  { chave: 'contact', rotulo: 'Tentativas de contato', ajuda: 'A fileira de colunas de tentativa ("1º contato", "2º contato"…). Pode marcar várias.', lista: true },
  { chave: 'dealId', rotulo: 'Nº do negócio / orçamento', ajuda: 'Identificador do negócio. É o que liga a linha de venda ao lead que a originou.',
    sinonimos: ['NUMERO ORCAMENTO', 'N ORCAMENTO', 'ID NEGOCIO', 'CODIGO', 'NUMERO DO NEGOCIO'] },
  { chave: 'neighborhood', rotulo: 'Bairro / região', ajuda: 'Usado no mapa e nos recortes por região.',
    sinonimos: ['REGIAO', 'BAIRRO CIDADE', 'LOCALIZACAO'] },
  { chave: 'payment', rotulo: 'Forma de pagamento', ajuda: 'Só informativo, aparece no detalhe do lead.',
    sinonimos: ['PAGAMENTO', 'FORMA PAGAMENTO', 'CONDICAO DE PAGAMENTO'] },
  { chave: 'notes', rotulo: 'Observação', ajuda: 'Texto livre que aparece no detalhe do lead.',
    sinonimos: ['OBS', 'OBSERVACOES', 'ANOTACOES', 'COMENTARIO', 'COMENTARIOS'] },
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

// ── Casamento POR ABA ────────────────────────────────────────────────────────

/** Sem acento, sem caixa, sem pontuação — a forma de comparar nome de coluna. */
function chaveColuna(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

export type CasamentoAba = {
  /** O de-para que vale NESTA aba: campo → nome exato da coluna aqui. */
  mapa: Mapeamento;
  /** Como cada campo foi resolvido — a tela mostra isso ao gestor. */
  origem: Record<string, 'padrao' | 'sinonimo' | 'manual'>;
  /** Campos do de-para padrão que esta aba não comporta. */
  faltam: string[];
};

/**
 * O de-para que vale para UMA aba.
 *
 * ⚠️⚠️ Mapeamento é POR COLUNA, não por posição nem por planilha. A coluna de
 * data pode estar em A numa aba e em C em outra, chamar-se `DATA` num mês e
 * `Data Entrada` no anterior — o que importa é que o dado dela caia no campo de
 * data do CRM. Antes havia UM mapeamento para a planilha inteira, e a aba que
 * escrevesse o nome de outro jeito era descartada por completo: a Romanza
 * perdia 12 abas (quase um ano) porque 2024/2025 usam "Data Entrada".
 *
 * A ordem é do mais seguro para o menos: nome exato do de-para → mesmo nome
 * ignorando caixa/acento → sinônimo conhecido do campo → o que o gestor
 * escolheu à mão para esta aba (que vence tudo).
 *
 * ⚠️ Uma coluna nunca serve a dois campos: a primeira a reivindicar fica com
 * ela. Sem isso, numa planilha com "Valor" e "Valor do Orçamento", receita e
 * orçamento disputariam a mesma coluna e um dos dois sairia errado — calado.
 */
export function casarColunasDaAba(
  cabecalho: string[],
  padrao: Mapeamento | null,
  manual?: Mapeamento | null,
): CasamentoAba {
  const colunas = cabecalho.filter(c => String(c ?? '').trim().length > 0);
  const porChave = new Map<string, string>();
  for (const c of colunas) {
    const k = chaveColuna(c);
    if (k && !porChave.has(k)) porChave.set(k, c);  // primeira ocorrência vence
  }

  const mapa: Mapeamento = {};
  const origem: CasamentoAba['origem'] = {};
  const faltam: string[] = [];
  const usadas = new Set<string>();

  const achar = (alvo: string): string | null => {
    const exata = colunas.find(c => c === alvo) ?? colunas.find(c => c.trim() === alvo.trim());
    if (exata && !usadas.has(exata)) return exata;
    const porNome = porChave.get(chaveColuna(alvo));
    return porNome && !usadas.has(porNome) ? porNome : null;
  };

  for (const campo of CAMPOS) {
    const pedidoManual = manual?.[campo.chave];
    const doPadrao = padrao?.[campo.chave];

    if (campo.lista) {
      // A fileira de tentativas encolhe e cresce de um mês para outro; aqui o
      // que não existir simplesmente fica de fora, sem reprovar a aba.
      const fonte = Array.isArray(pedidoManual) ? pedidoManual : Array.isArray(doPadrao) ? doPadrao : [];
      const achadas = fonte.map(c => achar(String(c))).filter((c): c is string => !!c);
      for (const c of achadas) usadas.add(c);
      mapa[campo.chave] = achadas.length ? achadas : null;
      if (achadas.length) origem[campo.chave] = Array.isArray(pedidoManual) ? 'manual' : 'padrao';
      continue;
    }

    // 1) escolha do gestor para esta aba — vence tudo, inclusive o padrão.
    if (typeof pedidoManual === 'string' && pedidoManual) {
      const real = achar(pedidoManual);
      if (real) { mapa[campo.chave] = real; origem[campo.chave] = 'manual'; usadas.add(real); continue; }
    }

    // 2) o nome do de-para padrão, igual ou só com outra caixa/acento.
    if (typeof doPadrao === 'string' && doPadrao) {
      const real = achar(doPadrao);
      if (real) { mapa[campo.chave] = real; origem[campo.chave] = 'padrao'; usadas.add(real); continue; }

      // 3) sinônimo conhecido — é o que faz "Data Entrada" virar a data do lead.
      const porSinonimo = (campo.sinonimos ?? [])
        .map(s => porChave.get(chaveColuna(s)))
        .find((c): c is string => !!c && !usadas.has(c));
      if (porSinonimo) { mapa[campo.chave] = porSinonimo; origem[campo.chave] = 'sinonimo'; usadas.add(porSinonimo); continue; }

      // O padrão pede este campo e esta aba não tem como entregá-lo.
      mapa[campo.chave] = null;
      faltam.push(campo.chave);
      continue;
    }

    mapa[campo.chave] = null;
  }

  return { mapa, origem, faltam };
}

/**
 * A aba tem o mínimo para virar lead?
 *
 * ⚠️ Só o ESSENCIAL reprova. A exigência de todas as colunas mapeadas fazia
 * sentido quando o sync mandava o de-para cru e a rota recusava o lote inteiro;
 * agora que cada aba manda só as colunas que tem, faltar `Observação` custaria
 * um mês inteiro de leads por um campo que ninguém usa para decidir nada.
 */
export function abaUtilizavel(c: CasamentoAba, exigirReceita = false): { ok: boolean; faltamEssenciais: string[] } {
  const faltamEssenciais: string[] = [];
  for (const campo of CAMPOS) {
    if (!campo.essencial) continue;
    if (!c.mapa[campo.chave]) faltamEssenciais.push(campo.chave);
  }
  // Numa planilha que é fonte de faturamento, aba sem a coluna de receita
  // entraria com R$ 0 e o mês mentiria na dashboard — pior que não importar.
  if (exigirReceita && !c.mapa.revenue) faltamEssenciais.push('revenue');
  // Nome OU telefone já identifica a pessoa; exigir os dois reprovaria planilha
  // de formulário que só tem e-mail e nome.
  const semIdentidade = faltamEssenciais.includes('name') && faltamEssenciais.includes('phone');
  const semData = faltamEssenciais.includes('date');
  return { ok: !semData && !semIdentidade && !faltamEssenciais.includes('revenue'), faltamEssenciais };
}
