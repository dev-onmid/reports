globalThis.__efeitos ??= { followup: [], conversao: [] };
export async function dispararEventosPorStatus(pool, clientId, status, lead, valor) {
  globalThis.__efeitos.conversao.push({ status, leadId: lead?.id });
}
export async function dispararEventoFechamento() {}
export function hasSuccessfulConversion() { return false; }
