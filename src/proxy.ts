import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE, isValidInternalToken, INTERNAL_HEADER } from '@/lib/session';
import {
  carregarAcesso, clienteDoLead, clienteDoFunil, clienteNoCaminho, clientesCitados, leadsCitados, regraCliente, TEAM_CLIENTE,
  type AcessoUsuario,
} from '@/lib/acesso';
import { hostDaRequisicao, hostSoEquipe, MSG_USAR_CRM } from '@/lib/host-acesso';

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
  // OAuth do Instagram Login (conta SEM Página): mesmo caso — o Instagram
  // redireciona sem cookie; a credencial é o `state` assinado com HMAC.
  '/api/auth/instagram/callback',

  // Portal do cliente — o token na URL é a credencial.
  '/api/portal/',

  // Link público da biblioteca "Formatos de Criativos" (/formatos/[token]).
  // O token de 32 hex é a credencial; as rotas só entregam o que está no escopo
  // dele (um formato ou a biblioteca), somente leitura.
  '/api/formatos-publico/',

  // Imagem de publicação agendada: a Meta faz cURL nesta URL a partir da
  // internet para criar o container de mídia e não manda cookie. O token de
  // 32 hex é a credencial; não há listagem nem token derivável.
  '/api/midia/',

  // Analytics de landing page: rodam em domínio de terceiro (o site do cliente).
  '/api/lp/collect',
  '/api/lp/tag.js',
  // Script universal de captura de lead: carregado pelo <script> do site do
  // cliente, sem sessão. O token vai na query e é validado na ingestão.
  '/api/lp/lead.js',
  '/api/lp/heatmap-data',

  // Webhooks de entrada — quem chama é Meta/Evolution/integrações, sem cookie.
  '/api/webhook/whatsapp',
  '/api/webhook/cardapioweb',
  '/api/webhook/anotaai',
  '/api/meta/webhook',
  '/api/webhooks/',
  '/api/automations/multi/trigger/',
  // Webhook de entrada de lead: token de 48 hex POR WEBHOOK na URL é a
  // credencial (mesma classe de exposição de /api/webhooks/).
  '/api/integrations/webhook/',
  // Endereço original do mesmo receptor, de quando a integração se chamava só
  // "Datalytics". Permanente: há URL desse formato recebendo lead em produção.
  '/api/integrations/datalytics/',
  // Site/LP manda lead direto: quem chama é o navegador do visitante ou a
  // função da própria página, sem sessão. O token de 48 hex é a credencial.
  '/api/integrations/lp/',
  // Webhook do Agendor — token de 48 hex por cliente na URL é a credencial.
  '/api/integrations/agendor/',

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
  '/api/cardapioweb/sync-cron',
  '/api/agendor/sync-cron',
  '/api/sults/worker',
  '/api/sults/sync',
  '/api/otimizacoes/resumo-diario-cron',
  '/api/relatorio-diario/cron',
  '/api/anotaai/sync-cron',
  '/api/sheets/sync-cron',
  '/api/crm/backfill-ctwa',
  '/api/crm/sanear-kanban',
  '/api/crm/disparos/worker',
  '/api/crm/followup/worker',
  '/api/fidelidade/worker',
  '/api/publicacoes/worker',
  '/api/lead-aviso/worker',
  '/api/crm/sync-cron',
  '/api/google/search-terms-cron',
  '/api/disparos/worker',
  '/api/leadlovers/worker',
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
  '/api/integrations/clientes',
  '/api/integrations/identificar',
  '/api/integrations/tldv-sync',
  '/api/integrations/tldv-backfill',
  '/api/integrations/google-conversoes', // lps/bin/gtag: ações de conversão do Google Ads
  '/api/integrations/mapa-calor',        // lps/bin/gtag calor: página do Mapa de Calor por LP
  '/api/integrations/google-destinos',   // lps/bin/gtag: URLs finais das campanhas
];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

const proibido = (msg = 'Sem permissão.') => Response.json({ error: msg }, { status: 403 });

/**
 * Usuário de CLIENTE: só a lista fechada de `ROTAS_CLIENTE`, e só com ids de
 * cliente/lead/funil que pertençam a ele. Devolve a resposta de recusa ou null.
 */
async function barrarForaDoCliente(req: NextRequest, acesso: AcessoUsuario): Promise<Response | null> {
  const { pathname, searchParams } = req.nextUrl;
  const regra = regraCliente(pathname, req.method, acesso.perfilCliente === 'gestor');
  if (!regra) return proibido();

  // ⚠️ Lê o corpo SEMPRE que houver um, seja qual for o Content-Type. A versão
  // anterior só lia com `application/json`, e as rotas fazem `req.json()` de
  // qualquer jeito: mandar `Content-Type: text/plain` com `{"clientId":OUTRO}`
  // e `?clientId=MEU` na query passava pelo proxy e agia no OUTRO cliente
  // (achado da auditoria de 10/10). Corpo que não é JSON válido é recusado:
  // nenhuma rota do cliente aceita outro formato (upload é multipart e não
  // cita cliente — tratado abaixo).
  let corpo: unknown = null;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const ct = (req.headers.get('content-type') ?? '').toLowerCase();
    const texto = await req.clone().text().catch(() => '');
    if (texto.trim()) {
      if (ct.includes('multipart/form-data')) {
        if (!regra.multipart) return proibido('Formato não aceito.');
      } else {
        try { corpo = JSON.parse(texto); } catch { return proibido('Corpo inválido.'); }
      }
    }
  }

  const meus = new Set(acesso.clientIds);
  const citados = clientesCitados(searchParams, corpo);
  const noCaminho = clienteNoCaminho(pathname);
  if (noCaminho) citados.push(noCaminho);
  for (const leadId of leadsCitados(pathname, corpo)) {
    const dono = await clienteDoLead(leadId);
    if (!dono) return Response.json({ error: 'Lead não encontrado.' }, { status: 404 });
    citados.push(dono);
  }
  const funil = pathname.match(/^\/api\/crm\/funnels\/([0-9a-f-]{36})\//);
  if (funil) {
    const dono = await clienteDoFunil(funil[1]);
    if (!dono) return Response.json({ error: 'Funil não encontrado.' }, { status: 404 });
    citados.push(dono);
  }

  if (regra.exigeCliente && citados.length === 0) return proibido('Informe o cliente.');
  if (citados.some(id => !meus.has(id))) return proibido();
  return null;
}

/**
 * Cabeçalhos de identidade que SÓ o proxy pode escrever. Em todo caminho que
 * passa sem sessão (público, cron, integração, token interno) eles são
 * apagados: uma rota que caísse no fallback "sem cookie, leio o header" podia
 * ser enganada por um `x-onmid-user-id` forjado (auditoria 2026-10-10).
 */
const CABECALHOS_IDENTIDADE = ['x-onmid-user-id', 'x-onmid-role', 'x-onmid-team', 'x-onmid-user-name', 'x-onmid-clientes', 'x-onmid-perfil'];
function semIdentidadeForjada(req: NextRequest) {
  const headers = new Headers(req.headers);
  for (const h of CABECALHOS_IDENTIDADE) headers.delete(h);
  return NextResponse.next({ request: { headers } });
}

/**
 * Requisição que ALTERA algo (POST/PUT/PATCH/DELETE) com sessão tem de vir do
 * próprio site. O cookie é SameSite=Lax, mas um subdomínio irmão (*.onmid.app
 * das landing pages) conta como "mesmo site" para o navegador — um XSS lá
 * viraria CSRF aqui. Sem Origin (curl, app nativo) passa: o cookie HttpOnly
 * já é a credencial nesses casos.
 */
function origemConfere(req: NextRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin).host.toLowerCase();
    const h = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host).split(',')[0].trim().toLowerCase();
    return !!h && o === h;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ⚠️ O portal do cliente é SOMENTE LEITURA, e isso é garantido AQUI — na
  // borda —, não só pelo fato de as rotas terem apenas GET hoje. Sem esta
  // trava, bastaria alguém acrescentar um POST em /api/portal/* um dia para
  // abrir um caminho de escrita sem sessão, sem que nada no código gritasse.
  // Quem precisar de escrita para o cliente tem de tirar o prefixo do público
  // e pensar na autenticação — que é exatamente a conversa que deve acontecer.
  if (pathname.startsWith('/api/portal/') && req.method !== 'GET' && req.method !== 'HEAD') {
    return Response.json({ error: 'O portal é somente leitura.' }, { status: 405 });
  }

  if (matches(pathname, PUBLIC_PREFIXES)) return semIdentidadeForjada(req);

  // Chamada servidor→servidor (Luna, cron do CRM, disparo de relatório). Elas
  // saem do próprio app por HTTP e não carregam cookie de usuário.
  if (isValidInternalToken(req.headers.get(INTERNAL_HEADER))) return semIdentidadeForjada(req);

  if (matches(pathname, INTEGRATION_PREFIXES) && req.headers.get('x-onmid-secret')) {
    return semIdentidadeForjada(req);
  }

  // Cron só passa se apresentar alguma credencial; o valor é conferido na rota.
  if (matches(pathname, CRON_PREFIXES)) {
    const hasSecret = req.nextUrl.searchParams.has('secret') || req.headers.get('authorization');
    if (hasSecret) return semIdentidadeForjada(req);
    // Sem secret, cai na checagem de sessão abaixo (a UI também dispara essas
    // rotas — ex: "Analisar esta conta" no Otimizador).
  }

  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  if (!origemConfere(req)) return proibido('Origem não permitida.');

  // Papel, time, status e clientes vêm do BANCO (cache de 30s), não do cookie:
  // o cookie vale 7 dias, e desativar alguém ou tirar um cliente dele tem de
  // valer já. Erro de banco mantém o comportamento antigo (cookie) para a
  // equipe da Onmid — senão uma piscada do Postgres derrubaria o sistema
  // inteiro —, mas FECHA para usuário de cliente, que nunca passa sem a lista.
  let acesso: AcessoUsuario | null | undefined;
  try { acesso = await carregarAcesso(session.uid); } catch { acesso = undefined; }
  if (acesso === null || (acesso && acesso.status !== 'Ativo')) {
    return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  const role = acesso?.role ?? session.role;
  const team = acesso?.team ?? session.team;
  if (team === TEAM_CLIENTE) {
    if (!acesso) return Response.json({ error: 'indisponivel' }, { status: 503 });
    if (hostSoEquipe(hostDaRequisicao(req))) return proibido(MSG_USAR_CRM);
    const recusa = await barrarForaDoCliente(req, acesso).catch(() => proibido());
    if (recusa) return recusa;
  }

  // Identidade passa a vir do cookie ASSINADO, não do que o cliente declarou.
  // Sobrescrever (em vez de só ler) neutraliza o x-onmid-user-id forjado, que
  // era o que tornava getCallerScope decorativo.
  const headers = new Headers(req.headers);
  headers.set('x-onmid-user-id', session.uid);
  headers.set('x-onmid-role', role);
  headers.set('x-onmid-team', team);
  // Autoria de quem mexeu no lead (histórico do CRM). Codificado: nome tem acento.
  if (acesso?.nome) headers.set('x-onmid-user-name', encodeURIComponent(acesso.nome));
  else headers.delete('x-onmid-user-name');
  if (team === TEAM_CLIENTE && acesso) {
    headers.set('x-onmid-clientes', acesso.clientIds.join(','));
    headers.set('x-onmid-perfil', acesso.perfilCliente);
  } else {
    headers.delete('x-onmid-clientes');
    headers.delete('x-onmid-perfil');
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
