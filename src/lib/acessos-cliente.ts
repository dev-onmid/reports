/**
 * Acessos do CLIENTE ao CRM (crm.onmid.app) — usuários `team='cliente'` presos
 * a UM cliente (2026-10-10, decisão do Matheus: o portal por link morreu; o
 * acesso do cliente é o login no crm.onmid.app, criado pela equipe da Onmid
 * dentro da aba do cliente ou pelo gestor do próprio cliente).
 *
 * Uma regra só para as duas portas (`/api/clients/[id]/acessos` da agência e
 * `/api/crm/equipe-cliente` do gestor): quem difere é o que cada porta DEIXA
 * fazer — a agência cria gestor ou atendente; o gestor só atendente.
 */
import type { Pool } from 'pg';
import { hashPassword } from '@/lib/password';
import { esquecerAcesso } from '@/lib/acesso';

export const URL_CRM_CLIENTE = 'https://crm.onmid.app';
export type PerfilCliente = 'gestor' | 'atendente';

export type AcessoCliente = {
  id: string; name: string; email: string; status: string; perfil: PerfilCliente; created_at: string | null;
};

const SELECT = `id, name, email, status, COALESCE(perfil_cliente, 'atendente') AS perfil, created_at`;

let pronto: Promise<void> | null = null;
export function ensureAcessosCliente(pool: Pool): Promise<void> {
  if (!pronto) {
    pronto = pool.query(`ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT 'onmid',
        ADD COLUMN IF NOT EXISTS client_ids TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS perfil_cliente TEXT NOT NULL DEFAULT 'atendente',
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`)
      .then(() => undefined).catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

export function emailValido(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 160;
}

export function perfilValido(v: unknown): PerfilCliente {
  return v === 'gestor' ? 'gestor' : 'atendente';
}

export async function listarAcessos(pool: Pool, clientId: string): Promise<AcessoCliente[]> {
  await ensureAcessosCliente(pool);
  const { rows } = await pool.query<AcessoCliente>(
    `SELECT ${SELECT} FROM public.users WHERE team = 'cliente' AND $1 = ANY(client_ids)
      ORDER BY (COALESCE(perfil_cliente, 'atendente') = 'gestor') DESC, name`,
    [clientId],
  );
  return rows;
}

export type ErroAcesso = { erro: string; status: number };

export async function criarAcesso(pool: Pool, dados: {
  clientId: string; name: unknown; email: unknown; password: unknown; perfil: PerfilCliente;
}): Promise<AcessoCliente | ErroAcesso> {
  const name = String(dados.name ?? '').trim().slice(0, 120);
  const email = String(dados.email ?? '').trim().toLowerCase();
  const password = String(dados.password ?? '');
  if (!name || !emailValido(email)) return { erro: 'Informe nome e e-mail válidos.', status: 400 };
  if (password.length < 8) return { erro: 'A senha precisa ter pelo menos 8 caracteres.', status: 400 };
  await ensureAcessosCliente(pool);
  const { rowCount } = await pool.query(`SELECT 1 FROM public.users WHERE LOWER(TRIM(email)) = $1`, [email]);
  if (rowCount) return { erro: 'Já existe um usuário com este e-mail.', status: 409 };
  const { rows: [u] } = await pool.query<AcessoCliente>(
    `INSERT INTO public.users (id, name, email, password, role, status, team, client_ids, perfil_cliente)
     VALUES ($1, $2, $3, $4, 'Usuário', 'Ativo', 'cliente', $5::text[], $6)
     RETURNING ${SELECT}`,
    [String(Date.now()), name, email, await hashPassword(password), [dados.clientId], dados.perfil],
  );
  return u;
}

/**
 * Altera status/nome/senha/perfil de um acesso do cliente. `somenteAtendente`
 * é a trava do gestor: ele não mexe em outro gestor. O alvo tem de ter este
 * cliente como ÚNICO cliente — um usuário ligado a duas unidades é da agência.
 */
export async function atualizarAcesso(pool: Pool, dados: {
  clientId: string; userId: string; status?: unknown; name?: unknown; password?: unknown; perfil?: unknown; somenteAtendente: boolean;
}): Promise<AcessoCliente | ErroAcesso> {
  await ensureAcessosCliente(pool);
  const { rows: [alvo] } = await pool.query(
    `SELECT id FROM public.users
      WHERE id = $1 AND team = 'cliente' AND client_ids = $2::text[]
        AND ($3::boolean = FALSE OR COALESCE(perfil_cliente, 'atendente') = 'atendente')`,
    [dados.userId, [dados.clientId], dados.somenteAtendente],
  );
  if (!alvo) return { erro: 'Sem permissão.', status: 403 };
  const sets: string[] = []; const vals: unknown[] = [dados.userId];
  if (dados.status === 'Ativo' || dados.status === 'Inativo') { vals.push(dados.status); sets.push(`status = $${vals.length}`); }
  if (typeof dados.name === 'string' && dados.name.trim()) { vals.push(dados.name.trim().slice(0, 120)); sets.push(`name = $${vals.length}`); }
  if (typeof dados.password === 'string' && dados.password) {
    if (dados.password.length < 8) return { erro: 'A senha precisa ter pelo menos 8 caracteres.', status: 400 };
    vals.push(await hashPassword(dados.password)); sets.push(`password = $${vals.length}`);
  }
  if (!dados.somenteAtendente && (dados.perfil === 'gestor' || dados.perfil === 'atendente')) {
    vals.push(dados.perfil); sets.push(`perfil_cliente = $${vals.length}`);
  }
  if (sets.length === 0) return { erro: 'Nada para alterar.', status: 400 };
  const { rows: [u] } = await pool.query<AcessoCliente>(`UPDATE public.users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${SELECT}`, vals);
  esquecerAcesso(dados.userId);
  return u;
}

export function ehErro(r: AcessoCliente | ErroAcesso): r is ErroAcesso {
  return 'erro' in r;
}
