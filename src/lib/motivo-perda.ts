/**
 * Motivo de perda — por que o lead não virou venda.
 *
 * ⚠️ Existe porque, numa auditoria de 356 conversas da Tapeçaria Chic
 * (02/10/2026), APENAS DOIS clientes disseram o motivo — e os dois foram
 * acionáveis na hora: um apontou falta de produto (tapete branco de fio baixo,
 * que não existe em estoque) e outro, política de preço por volume (perdido por
 * R$ 2,50 em 19 rolos de papel de parede). O resto virou "Sem Interesse", que
 * não ensina nada a ninguém.
 *
 * A lista é curta de propósito: motivo com 15 opções vira campo que o gestor
 * preenche no automático, sempre o primeiro da lista.
 */
export const MOTIVOS_PERDA = [
  { id: 'preco',       label: 'Preço',                 ajuda: 'Achou caro ou um concorrente cobrou menos' },
  { id: 'produto',     label: 'Produto',               ajuda: 'Não tínhamos o que ele queria (cor, modelo, medida)' },
  { id: 'prazo',       label: 'Prazo',                 ajuda: 'Precisava para antes do que conseguimos entregar' },
  { id: 'concorrente', label: 'Fechou com concorrente', ajuda: 'Comprou em outro lugar — sem dizer preço ou produto' },
  { id: 'sem_retorno', label: 'Parou de responder',    ajuda: 'Sumiu durante o atendimento' },
  { id: 'adiado',      label: 'Adiou a compra',        ajuda: 'Tem interesse mas deixou para depois' },
  { id: 'nao_era_lead',label: 'Não era cliente',       ajuda: 'Fornecedor, equipe, engano ou fora do nosso ramo' },
  { id: 'outro',       label: 'Outro',                 ajuda: 'Descreva no campo ao lado' },
] as const;

export type MotivoPerdaId = (typeof MOTIVOS_PERDA)[number]['id'];

const IDS = new Set(MOTIVOS_PERDA.map(m => m.id as string));

export function motivoValido(id: string | null | undefined): id is MotivoPerdaId {
  return typeof id === 'string' && IDS.has(id);
}

export function rotuloMotivo(id: string | null | undefined): string | null {
  return MOTIVOS_PERDA.find(m => m.id === id)?.label ?? null;
}

/**
 * ⚠️ "Outro" sem detalhe é o mesmo que não registrar: o campo existe para
 * ensinar o que ajustar na compra e no preço, e "outro" sozinho não ensina.
 */
export function motivoCompleto(id: string | null | undefined, detalhe: string | null | undefined): boolean {
  if (!motivoValido(id)) return false;
  if (id === 'outro') return !!detalhe && detalhe.trim().length >= 3;
  return true;
}
