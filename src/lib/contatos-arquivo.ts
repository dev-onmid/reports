/**
 * Leitura de arquivo de contatos (client-safe).
 *
 * Devolve linhas no formato `telefone,nome` — o mesmo que `parseListaManual`
 * já sabe interpretar. Mora numa lib própria, e não dentro do componente, para
 * poder ser exercitada com um .xlsx de verdade num teste.
 */

/**
 * ⚠️ Planilha de cliente NÃO tem formato fixo: cada um exporta do seu sistema
 * com as colunas na ordem que vierem, com ou sem cabeçalho. Em vez de exigir um
 * modelo (que ninguém segue), procura em cada linha a célula que PARECE
 * telefone — 10+ dígitos — e usa o primeiro texto restante como nome. Linha sem
 * telefone nenhum, incluindo o cabeçalho, cai fora sozinha.
 */
export function linhasDaPlanilha(linhas: unknown[][]): string {
  const saida: string[] = [];
  for (const linha of linhas) {
    if (!Array.isArray(linha)) continue;
    const celulas = linha.map(c => String(c ?? '').trim()).filter(Boolean);
    if (celulas.length === 0) continue;
    const iFone = celulas.findIndex(c => c.replace(/\D/g, '').length >= 10);
    if (iFone < 0) continue;
    const fone = celulas[iFone];
    // Nome é a primeira célula com letras que NÃO seja a do telefone. Isso
    // descarta sozinho colunas de código, data e valor.
    const nome = celulas.find((c, i) => i !== iFone && /\p{L}{2,}/u.test(c)) ?? '';
    saida.push(nome ? `${fone},${nome}` : fone);
  }
  return saida.join('\n');
}

export async function lerArquivoContatos(file: File): Promise<string> {
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
    const texto = await file.text();
    return texto.split(/\r?\n/).filter(l => l.trim()).join('\n');
  }

  // Import dinâmico: a xlsx é pesada e só o upload de planilha precisa dela.
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const aba = wb.Sheets[wb.SheetNames[0]];
  return linhasDaPlanilha(XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: false, defval: '' }));
}
