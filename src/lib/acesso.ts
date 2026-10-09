/**
 * Acesso por usuário, conferido no SERVIDOR a cada requisição.
 *
 * ⚠️ Por que existe (2026-10-09): o CRM vai ser usado pelos funcionários dos
 * CLIENTES (recepção da clínica, vendedor da franquia). Até aqui só a equipe da
 * Onmid tinha login, e nenhuma rota conferia SE a pessoa podia ver aquele
 * cliente — o proxy só sabia QUEM ela era. Um usuário de cliente logado poderia
 * trocar o `clientId` na URL e ler o CRM de outro cliente.
 *
 * Desenho: o usuário de cliente (`team = 'cliente'`) carrega a lista de
 * clientes dele em `users.client_ids`. O proxy relê isso do BANCO (com cache
 * curto), então desativar a pessoa ou tirar um cliente dela vale na hora — o
 * cookie de 7 dias deixa de mandar. Equipe da Onmid continua vendo tudo, como
 * sempre: a trava só morde quem é `cliente`.
 */
import { Pool } from 'pg';

export type AcessoUsuario = {
  uid: string;
  nome: string;
  role: string;
  team: string;
  status: string;
  clientIds: string[];
};

let pool: Pool | null = null;
function getPool(): Pool {
  if (pool) return pool;
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  const interno = /@(onmid-reports-db|localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(connectionString ?? '');
  // Pool PRÓPRIO e longo: roda em toda requisição autenticada. `makeServerPool`
  // abre e fecha conexão por chamada — aqui isso custaria um handshake por clique.
  pool = new Pool({
    connectionString,
    ssl: interno ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 60_000,
  });
  pool.on('error', () => { /* conexão ociosa caída: a próxima consulta reconecta */ });
  return pool;
}

let schemaPronto: Promise<void> | null = null;
export function garantirSchemaAcesso(): Promise<void> {
  if (!schemaPronto) {
    schemaPronto = getPool()
      .query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS client_ids TEXT[] NOT NULL DEFAULT '{}'`)
      .then(() => undefined)
      .catch((e) => { schemaPronto = null; throw e; });
  }
  return schemaPronto;
}

const TTL_MS = 30_000;
const cache = new Map<string, { em: number; valor: AcessoUsuario | null }>();

/** Zera o cache de um usuário (ao salvar o cadastro dele). */
export function esquecerAcesso(uid?: string) {
  if (uid) cache.delete(uid); else cache.clear();
}

/**
 * Lê o usuário do banco. `null` = não existe. Lança em erro de banco — quem
 * chama decide (o proxy falha FECHADO só para usuário de cliente).
 */
export async function carregarAcesso(uid: string): Promise<AcessoUsuario | null> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.em < TTL_MS) return hit.valor;
  await garantirSchemaAcesso();
  const { rows } = await getPool().query(
    `SELECT id, name, role, status, COALESCE(team, 'onmid') AS team, COALESCE(client_ids, '{}') AS client_ids
       FROM public.users WHERE id = $1 LIMIT 1`,
    [uid],
  );
  const r = rows[0];
  const valor: AcessoUsuario | null = r
    ? { uid: String(r.id), nome: r.name ?? '', role: r.role, team: r.team, status: r.status, clientIds: r.client_ids ?? [] }
    : null;
  cache.set(uid, { em: Date.now(), valor });
  return valor;
}

/** Dono do lead (para rotas /api/crm/<leadId>). */
export async function clienteDoLead(leadId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT client_id FROM public.crm_leads WHERE id::text = $1 LIMIT 1`, [leadId]);
  return rows[0]?.client_id ?? null;
}

export const TEAM_CLIENTE = 'cliente';

// ── O que um usuário de cliente pode chamar ─────────────────────────────────
//
// Lista FECHADA: o que não está aqui devolve 403 para ele. Rota nova do CRM não
// fica disponível ao cliente por acidente — precisa ser acrescentada aqui, com a
// decisão de se exige cliente.

const UUID = '[0-9a-f-]{36}';

type Regra = { padrao: RegExp; metodos: string[]; exigeCliente: boolean };

export const ROTAS_CLIENTE: Regra[] = [
  // sessão e menu
  { padrao: /^\/api\/auth\/(me|logout)$/, metodos: ['GET', 'POST'], exigeCliente: false },
  { padrao: /^\/api\/permissions$/, metodos: ['GET'], exigeCliente: false },
  { padrao: /^\/api\/clients$/, metodos: ['GET'], exigeCliente: false }, // a rota filtra pelos clientes dele
  // leads
  { padrao: /^\/api\/crm$/, metodos: ['GET', 'POST'], exigeCliente: true },
  { padrao: new RegExp(`^/api/crm/${UUID}$`), metodos: ['GET', 'PUT', 'DELETE'], exigeCliente: true },
  { padrao: new RegExp(`^/api/crm/${UUID}/messages$`), metodos: ['GET', 'POST'], exigeCliente: true },
  { padrao: new RegExp(`^/api/crm/${UUID}/formulario$`), metodos: ['GET'], exigeCliente: true },
  { padrao: new RegExp(`^/api/crm/${UUID}/eventos$`), metodos: ['GET'], exigeCliente: true },
  { padrao: /^\/api\/crm\/equipe$/, metodos: ['GET'], exigeCliente: true },
  { padrao: /^\/api\/crm\/respostas-rapidas$/, metodos: ['GET', 'POST', 'DELETE'], exigeCliente: true },
  // funil (só leitura — editar funil é da agência)
  { padrao: /^\/api\/crm\/funnels$/, metodos: ['GET'], exigeCliente: true },
  { padrao: new RegExp(`^/api/crm/funnels/${UUID}/stages$`), metodos: ['GET'], exigeCliente: false },
  // conversas
  { padrao: /^\/api\/crm\/inbox$/, metodos: ['GET', 'POST'], exigeCliente: true },
  { padrao: /^\/api\/crm\/sync-history$/, metodos: ['POST'], exigeCliente: true },
  { padrao: /^\/api\/crm\/instance-status$/, metodos: ['GET'], exigeCliente: true },
  { padrao: /^\/api\/crm\/avatars$/, metodos: ['POST'], exigeCliente: true },
  { padrao: /^\/api\/crm\/webhook-heal$/, metodos: ['POST'], exigeCliente: true },
  { padrao: /^\/api\/upload$/, metodos: ['POST'], exigeCliente: false },
];

export function regraCliente(pathname: string, metodo: string): Regra | null {
  const m = metodo.toUpperCase() === 'HEAD' ? 'GET' : metodo.toUpperCase();
  return ROTAS_CLIENTE.find(r => r.padrao.test(pathname) && r.metodos.includes(m)) ?? null;
}

/** Dono do funil (para /api/crm/funnels/<id>/stages). */
export async function clienteDoFunil(funnelId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT client_id FROM public.crm_funnels WHERE id::text = $1 LIMIT 1`, [funnelId]);
  return rows[0]?.client_id ?? null;
}

/** Ids de cliente que a requisição cita (query e corpo JSON). */
export function clientesCitados(query: URLSearchParams, corpo: unknown): string[] {
  const out: string[] = [];
  for (const k of ['clientId', 'client_id']) {
    const v = query.get(k);
    if (v) out.push(v);
  }
  const lista = query.get('clientIds');
  if (lista) out.push(...lista.split(',').map(s => s.trim()).filter(Boolean));
  if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
    const c = corpo as Record<string, unknown>;
    for (const k of ['clientId', 'client_id']) if (typeof c[k] === 'string' && c[k]) out.push(c[k] as string);
    if (Array.isArray(c.clientIds)) out.push(...c.clientIds.filter((x): x is string => typeof x === 'string'));
  }
  return out;
}

/** Ids de lead que a requisição cita (caminho e corpo). */
export function leadsCitados(pathname: string, corpo: unknown): string[] {
  const out: string[] = [];
  const m = pathname.match(new RegExp(`^/api/crm/(${UUID})(/|$)`));
  if (m) out.push(m[1]);
  if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
    const c = corpo as Record<string, unknown>;
    for (const k of ['leadId', 'lead_id']) if (typeof c[k] === 'string' && c[k]) out.push(c[k] as string);
  }
  return out;
}
