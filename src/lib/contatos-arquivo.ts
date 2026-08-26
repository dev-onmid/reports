/**
 * Leitura de arquivo de contatos (client-safe).
 *
 * ⚠️ Planilha de cliente NÃO tem formato fixo: cada um exporta do seu sistema
 * com as colunas na ordem que vierem, com ou sem cabeçalho. Em vez de exigir um
 * modelo (que ninguém segue), o leitor procura o que reconhece e ignora o resto.
 *
 * Quando a planilha traz HISTÓRICO — última compra, nº de pedidos, total gasto —
 * a base importada passa a ser segmentável: cliente sem integração de delivery
 * nenhuma ganha "em risco", "inativo" e "VIP" iguais aos de quem tem.
 */

export type ContatoLido = {
  telefone: string;
  nome: string | null;
  pedidos: number | null;
  totalGasto: number | null;
  /** ISO da última compra. */
  ultimaCompra: string | null;
};

const RE_PEDIDOS = /(qtd|quant|n[º°.]?\s*de\s*pedidos?|pedidos?|compras?|frequ)/i;
const RE_GASTO = /(total|valor|gasto|receita|ticket|faturad)/i;
const RE_DATA = /(ltima|ultimo|last|data|dt[_ ]|compra|pedido em|acesso)/i;
const RE_NOME = /(nome|cliente|contato|name)/i;
const RE_FONE = /(telefone|celular|whats|fone|phone|tel)/i;

function soDigitos(v: string): string { return v.replace(/\D/g, ''); }

function pareceTelefone(v: string): boolean {
  const d = soDigitos(v);
  // 10–13 dígitos: fixo com DDD até celular com DDI. Acima disso é código,
  // CPF ou CNPJ — nada que se possa mandar mensagem.
  return d.length >= 10 && d.length <= 13;
}

/**
 * Número em formato BR ou US. "1.234,56" e "1,234.56" são o mesmo valor escrito
 * por planilhas diferentes; ler os dois evita transformar R$ 1.234,56 em 1,23.
 */
export function parseNumero(v: string): number | null {
  const limpo = String(v ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!limpo) return null;
  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');
  let normal = limpo;
  if (temVirgula && temPonto) {
    // O separador decimal é o que aparece por ÚLTIMO.
    normal = limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo.replace(/,/g, '');
  } else if (temVirgula) {
    normal = limpo.replace(',', '.');
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/**
 * Data em dd/mm/aaaa, aaaa-mm-dd ou serial do Excel.
 *
 * ⚠️ dd/mm vem ANTES de mm/dd de propósito: a planilha é brasileira, e ler
 * 03/08 como 8 de março jogaria o cliente de "comprou semana passada" para
 * "sumido há cinco meses".
 */
export function parseData(v: string): string | null {
  const bruto = String(v ?? '').trim();
  if (!bruto) return null;

  const br = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (br) {
    const [, d, m, a] = br;
    const ano = a.length === 2 ? 2000 + Number(a) : Number(a);
    const dt = new Date(Date.UTC(ano, Number(m) - 1, Number(d), 12));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  const iso = bruto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const dt = new Date(`${iso[0]}T12:00:00.000Z`);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  // Serial do Excel (dias desde 30/12/1899). Só acima de 20000 para não
  // confundir com "5 pedidos" numa célula de número solto.
  const n = Number(bruto);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString();
  }
  return null;
}

/** Índices de coluna descobertos pelo cabeçalho, quando ele existe. */
type Mapa = { fone: number; nome: number; pedidos: number; gasto: number; data: number };

function mapearCabecalho(linha: string[]): Mapa | null {
  const acha = (re: RegExp) => linha.findIndex(c => re.test(c));
  const fone = acha(RE_FONE);
  if (fone < 0) return null; // sem coluna de telefone não é cabeçalho útil
  return {
    fone,
    nome: acha(RE_NOME),
    // ⚠️ Data primeiro: "última compra" casa com RE_DATA e com nada mais; sem
    // essa ordem, uma coluna "Data do último pedido" cairia em `pedidos`.
    data: acha(RE_DATA),
    pedidos: linha.findIndex((c, i) => i !== acha(RE_DATA) && RE_PEDIDOS.test(c)),
    gasto: acha(RE_GASTO),
  };
}

export function linhasDaPlanilha(linhas: unknown[][]): ContatoLido[] {
  const saida: ContatoLido[] = [];
  let mapa: Mapa | null = null;

  for (const linha of linhas) {
    if (!Array.isArray(linha)) continue;
    const celulas = linha.map(c => String(c ?? '').trim());
    if (celulas.every(c => !c)) continue;

    // Cabeçalho: primeira linha SEM telefone reconhecível mas COM rótulos.
    if (!mapa && !celulas.some(pareceTelefone)) {
      mapa = mapearCabecalho(celulas);
      continue;
    }

    if (mapa) {
      const fone = celulas[mapa.fone] ?? '';
      if (!pareceTelefone(fone)) continue;
      saida.push({
        telefone: fone,
        nome: mapa.nome >= 0 ? (celulas[mapa.nome] || null) : null,
        pedidos: mapa.pedidos >= 0 ? parseNumero(celulas[mapa.pedidos]) : null,
        totalGasto: mapa.gasto >= 0 ? parseNumero(celulas[mapa.gasto]) : null,
        ultimaCompra: mapa.data >= 0 ? parseData(celulas[mapa.data]) : null,
      });
      continue;
    }

    // Sem cabeçalho: acha o telefone e usa o primeiro texto com letras como
    // nome. Histórico não é adivinhado — sem rótulo, não dá para saber se
    // "3" é o número de pedidos ou o número da casa.
    const cheias = celulas.filter(Boolean);
    const iFone = cheias.findIndex(pareceTelefone);
    if (iFone < 0) continue;
    const nome = cheias.find((c, i) => i !== iFone && /\p{L}{2,}/u.test(c)) ?? null;
    saida.push({
      telefone: cheias[iFone], nome, pedidos: null, totalGasto: null, ultimaCompra: null,
    });
  }
  return saida;
}

export async function lerArquivoContatos(file: File): Promise<ContatoLido[]> {
  const nome = file.name.toLowerCase();

  if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
    const texto = await file.text();
    const linhas = texto.split(/\r?\n/).filter(l => l.trim()).map((l) => {
      const sep = l.includes(';') ? ';' : l.includes('\t') ? '\t' : ',';
      return l.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
    });
    return linhasDaPlanilha(linhas);
  }

  // Import dinâmico: a xlsx é pesada e só o upload de planilha precisa dela.
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const aba = wb.Sheets[wb.SheetNames[0]];
  return linhasDaPlanilha(XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: false, defval: '' }));
}

/** Volta ao formato de texto (uma linha por pessoa) para o campo de colar. */
export function contatosParaTexto(contatos: ContatoLido[]): string {
  return contatos.map(c => (c.nome ? `${c.telefone},${c.nome}` : c.telefone)).join('\n');
}
