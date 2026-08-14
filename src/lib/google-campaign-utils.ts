// Helpers PUROS da criação de campanha Google Ads da Luna (client-safe, zero deps).
// Vivem fora de luna-tools.ts pra serem testáveis sem arrastar pg/servidor.

export type KeywordDescartada = { kw: string; motivo: string };

// A API recusa keyword com aspas/colchetes/til (notação de correspondência do PAINEL —
// na API o tipo vai no campo matchType separado), com mais de 80 caracteres ou mais de
// 10 palavras. E duplicata no MESMO lote também é erro. Como o mutate é atômico por
// padrão, QUALQUER uma dessas derrubava o lote inteiro e a campanha nascia sem nenhuma
// palavra-chave — por isso a limpeza acontece toda aqui, ANTES do envio.
export function sanitizeGoogleKeywords(
  raw: unknown,
  cap = 20,
): { validas: string[]; descartadas: KeywordDescartada[] } {
  const validas: string[] = [];
  const descartadas: KeywordDescartada[] = [];
  const vistas = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const kw = String(item).replace(/["[\]~]/g, '').replace(/\s+/g, ' ').trim();
    if (!kw) continue;
    const chave = kw.toLowerCase();
    if (vistas.has(chave)) { descartadas.push({ kw, motivo: 'duplicada' }); continue; }
    vistas.add(chave);
    if (kw.length > 80) { descartadas.push({ kw, motivo: 'mais de 80 caracteres' }); continue; }
    if (kw.split(' ').length > 10) { descartadas.push({ kw, motivo: 'mais de 10 palavras' }); continue; }
    if (validas.length >= cap) { descartadas.push({ kw, motivo: `acima do limite de ${cap}` }); continue; }
    validas.push(kw);
  }
  return { validas, descartadas };
}

// Nomes de cidade no geo_target_constant do Google vêm SEM acento ("Florianopolis",
// "Sao Paulo") — busca exata com o nome acentuado devolve vazio e a campanha caía no
// fallback "Brasil inteiro" (visto ao vivo na Cost Odonto). Gera as variantes.
export function cityNameVariants(nome: string): string[] {
  const limpo = nome.replace(/\s+/g, ' ').trim();
  const semAcento = limpo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [...new Set([limpo, semAcento])].filter(Boolean);
}

export type PartialFailureResult = {
  okIndexes: number[];
  failed: Array<{
    index: number;
    message: string;
    // Presente quando a recusa é de POLÍTICA e o Google aceita pedido de isenção
    // (isExemptible) — termos de saúde tipo "implante dentário". Reenviar a operação
    // com exemptPolicyViolationKeys=[key] é o mesmo pedido que o painel faz sozinho.
    exemptKey?: { policyName: string; violatingText: string };
  }>;
};

// Lê a resposta de um mutate com partialFailure:true. `results` vem com o MESMO tamanho
// das operations; posição que falhou vem como {} (sem resourceName). Os erros individuais
// vêm em partialFailureError.details[].errors[], cada um apontando a operação culpada em
// location.fieldPathElements (fieldName 'operations' + index).
export function parsePartialFailure(body: unknown, totalOperations: number): PartialFailureResult {
  const b = body as {
    results?: Array<{ resourceName?: string } | null>;
    partialFailureError?: {
      message?: string;
      details?: Array<{
        errors?: Array<{
          message?: string;
          location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
          details?: {
            policyViolationDetails?: {
              isExemptible?: boolean;
              key?: { policyName?: string; violatingText?: string };
            };
          };
        }>;
      }>;
    };
  } | null;
  const okIndexes: number[] = [];
  (Array.isArray(b?.results) ? b.results : []).forEach((x, i) => {
    if (x && typeof x.resourceName === 'string' && x.resourceName) okIndexes.push(i);
  });
  const failed: PartialFailureResult['failed'] = [];
  for (const d of b?.partialFailureError?.details ?? []) {
    for (const e of d?.errors ?? []) {
      const op = (e?.location?.fieldPathElements ?? []).find(p => p?.fieldName === 'operations');
      const pol = e?.details?.policyViolationDetails;
      failed.push({
        index: typeof op?.index === 'number' ? op.index : -1,
        message: String(e?.message ?? 'erro desconhecido'),
        ...(pol?.isExemptible && pol.key?.policyName
          ? { exemptKey: { policyName: String(pol.key.policyName), violatingText: String(pol.key.violatingText ?? '') } }
          : {}),
      });
    }
  }
  // Falha reportada sem detalhe estruturado (raro): repassa a mensagem geral.
  if (failed.length === 0 && okIndexes.length < totalOperations && b?.partialFailureError?.message) {
    failed.push({ index: -1, message: String(b.partialFailureError.message) });
  }
  return { okIndexes, failed };
}
