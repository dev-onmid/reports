/**
 * Qual endereço atende quem (2026-10-09, decisão do Matheus):
 * - reports.onmid.app → só a EQUIPE da Onmid;
 * - crm.onmid.app     → porta dos funcionários dos clientes (a equipe também entra).
 *
 * É o mesmo sistema; o endereço só decide a porta. Quem limita O QUE cada um
 * vê continua sendo a trava por cliente do proxy (src/lib/acesso.ts).
 * localhost e afins não travam nada (desenvolvimento).
 */
export const URL_CRM = 'https://crm.onmid.app';

/** Host da requisição, sem porta. Traefik repassa o Host original. */
export function hostDaRequisicao(req: Request): string {
  let h = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  if (!h) { try { h = new URL(req.url).host; } catch { h = ''; } }
  return h.split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
}

/** Endereço reservado à equipe: usuário de cliente não entra por aqui. */
export function hostSoEquipe(host: string): boolean {
  return host.startsWith('reports.');
}

export const MSG_USAR_CRM = 'Seu acesso é pelo crm.onmid.app.';
