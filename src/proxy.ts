import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE, isValidInternalToken, INTERNAL_HEADER } from '@/lib/session';

/**
 * Gate único de /api/*, negando por padrão.
 *
 * No Next.js 16 este arquivo se chama `proxy.ts` — o antigo `middleware.ts` foi
 * renomeado. Um arquivo com o nome antigo é ignorado em silêncio, o que daria a
 * impressão de proteção sem proteger nada.
 *
 * O proxy é a primeira camada, não a única: rotas com dados de um cliente
 * específico ainda precisam checar posse (getCallerScope). O que ele garante é
 * que ninguém sem sessão válida alcança a rota.
 */

/**
 * Rotas que PRECISAM responder sem sessão. Qualquer coisa fora desta lista é
 * negada. Adicionar aqui é uma decisão de segurança — o item precisa ser
 * inerentemente público ou carregar a própria credencial (token na URL).
 */
const PUBLIC_PREFIXES = [
  // Autenticação (senão não há como obter sessão).
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  // OAuth: o Google redireciona o browser pra cá sem cookie nosso garantido.
  '/api/auth/google/callback',

  // Portal do cliente — o token na URL é a credencial.
  '/api/portal/',

  // Analytics de landing page: rodam em domínio de terceiro (o site do cliente).
  '/api/lp/collect',
  '/api/lp/tag.js',
  '/api/lp/heatmap-data',

  // Webhooks de entrada — quem chama é Meta/Evolution/integrações, sem cookie.
  '/api/webhook/whatsapp',
  '/api/meta/webhook',
  '/api/webhooks/',
  '/api/automations/multi/trigger/',

  // Pixel e clique de e-mail: abertos pelo cliente de e-mail do destinatário.
  '/api/email/track/open',
  '/api/email/track/click',

  // Formulário público de onboarding.
  '/api/intake',

  // Carregado pelo viewer público de relatório (/relatorio/[token]).
  '/api/reports/image-proxy',
];

/**
 * Rotas de cron/worker. Elas validam o próprio secret — a checagem
 * authoritative continua sendo a da rota; aqui só deixamos a requisição chegar.
 * Não têm sessão porque quem chama é GitHub Actions / Vercel Cron.
 */
const CRON_PREFIXES = [
  '/api/agent/scheduler',
  '/api/alerts/balance-cron',
  '/api/alerts/evolution-cron',
  '/api/alerts/webshare-cron',
  '/api/automations/multi/worker',
  '/api/crm/backfill-ctwa',
  '/api/crm/disparos/worker',
  '/api/crm/followup/worker',
  '/api/crm/sync-cron',
  '/api/disparos/worker',
  '/api/email/worker',
  '/api/leadlovers/worker',
  '/api/otimizador/daily',
  '/api/otimizador/weekly',
  '/api/reports/cron-monthly',
  '/api/social-monitor/refresh',
];

/**
 * Integrações máquina→máquina (Make etc.). Mesmo contrato dos crons: o proxy
 * só exige que a credencial VENHA na requisição; quem confere o valor é a
 * rota (x-onmid-secret vs MAKE_INTEGRATION_SECRET). Sem o header, cai na
 * checagem de sessão — um curl anônimo continua vendo 401.
 */
const INTEGRATION_PREFIXES = [
  '/api/integrations/reuniao',
  '/api/integrations/agenda',
];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (matches(pathname, PUBLIC_PREFIXES)) return NextResponse.next();

  // Chamada servidor→servidor (Luna, cron do CRM, disparo de relatório). Elas
  // saem do próprio app por HTTP e não carregam cookie de usuário.
  if (isValidInternalToken(req.headers.get(INTERNAL_HEADER))) return NextResponse.next();

  if (matches(pathname, INTEGRATION_PREFIXES) && req.headers.get('x-onmid-secret')) {
    return NextResponse.next();
  }

  // Cron só passa se apresentar alguma credencial; o valor é conferido na rota.
  if (matches(pathname, CRON_PREFIXES)) {
    const hasSecret = req.nextUrl.searchParams.has('secret') || req.headers.get('authorization');
    if (hasSecret) return NextResponse.next();
    // Sem secret, cai na checagem de sessão abaixo (a UI também dispara essas
    // rotas — ex: "Analisar esta conta" no Otimizador).
  }

  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  // Identidade passa a vir do cookie ASSINADO, não do que o cliente declarou.
  // Sobrescrever (em vez de só ler) neutraliza o x-onmid-user-id forjado, que
  // era o que tornava getCallerScope decorativo.
  const headers = new Headers(req.headers);
  headers.set('x-onmid-user-id', session.uid);
  headers.set('x-onmid-role', session.role);
  headers.set('x-onmid-team', session.team);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
