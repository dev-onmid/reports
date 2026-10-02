globalThis.__efeitos ??= { followup: [], conversao: [] };
export async function queueFollowupIfExists(pool, leadId, clientId, status) {
  globalThis.__efeitos.followup.push({ leadId, status });
}
