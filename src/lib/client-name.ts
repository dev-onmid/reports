/**
 * Espelha `normalizeClientName` de `src/lib/reuniao-intake.ts` (que é server-only,
 * puxa `@/lib/clickup` → `pg`) — versão client-safe, mesma lógica exata, porque o
 * casamento de reunião/ClickUp usa essa forma normalizada do nome. Renomear um
 * cliente pra algo que colida com outro já cadastrado torna os dois "ambíguos"
 * pro matcher (nem um resolve mais) — telas de edição de nome devem checar isso
 * ANTES de salvar, não depois.
 */
export function normalizeClientName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
