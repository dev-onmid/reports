/**
 * Normalizes any Brazilian phone number format to 55XXXXXXXXXXX.
 * Accepts:
 *   (43) 9 9999-1111  →  5543999991111
 *   43 99999-1111      →  5543999991111
 *   5543999991111      →  5543999991111
 *   +55 43 9 6666-4444 →  5543966664444
 *   11988887777        →  5511988887777
 */
export function formatPhone(raw: string): string | null {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return null;

  // DDD + 8-digit (landline) or 9-digit (mobile). Vem ANTES do teste do "55":
  // ⚠️ DDD 55 (Santa Maria/RS) começa com 55 e era confundido com o código do
  // país — "55 99681-7357" virava local de 9 dígitos e o contato era DESCARTADO
  // (2 pacientes reais da Cost Odonto, 2026-10-02). Com o 55 do país o número
  // teria 12 ou 13 dígitos, então 10/11 é sempre DDD + número.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  // Already has country code 55
  if (digits.startsWith('55')) {
    const local = digits.slice(2);
    if (local.length === 10 || local.length === 11) return digits;
    return null;
  }

  return null;
}

/** Parses a textarea value into a list of { phone, name } entries.
 *  Each line can be:
 *    phone
 *    phone,name
 *    phone;name
 */
export function parsePhoneList(raw: string): { phone: string; name: string }[] {
  const results: { phone: string; name: string }[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.includes(';') ? ';' : ',';
    const [rawPhone, rawName = ''] = trimmed.split(sep);
    const phone = formatPhone(rawPhone.trim());
    if (phone) results.push({ phone, name: rawName.trim() });
  }
  return results;
}

/**
 * Chave de "mesma pessoa" para deduplicar: DDD + últimos 8 dígitos. Assim
 * 48 99123-4567 e 48 9123-4567 (com e sem o nono dígito, que planilhas e o
 * WhatsApp misturam) contam como um número só.
 */
export function chaveContato(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  return local.length >= 10 ? `${local.slice(0, 2)}:${local.slice(-8)}` : local;
}

/**
 * Remove números repetidos mantendo a 1ª ocorrência — e, se ela veio sem nome e
 * uma repetição tem, o nome é aproveitado.
 *
 * ⚠️ Existe por causa de um caso REAL (2026-10-02): relatório de orçamentos da
 * Cost Odonto com UMA LINHA POR ORÇAMENTO — 362 linhas, 198 pacientes. Sem isto
 * 164 pessoas receberiam a mesma mensagem duas ou mais vezes no mesmo disparo.
 */
export function deduplicarContatos<T extends { phone: string; name: string }>(lista: T[]): { unicos: T[]; repetidos: number } {
  const porChave = new Map<string, T>();
  for (const c of lista) {
    const k = chaveContato(c.phone);
    const atual = porChave.get(k);
    if (!atual) { porChave.set(k, { ...c }); continue; }
    if (!atual.name && c.name) atual.name = c.name;
  }
  return { unicos: [...porChave.values()], repetidos: lista.length - porChave.size };
}
