/**
 * Ponto ÚNICO de saída de e-mail do sistema (alertas e avisos de lead).
 *
 * Existia só um caminho: a API do Gmail, com OAuth. Em 16/09/2026 esse token
 * foi recusado com `invalid_grant` e descobrimos que TODO aviso por e-mail
 * estava mudo havia meses — alerta de saldo, Webshare, instância caída e o
 * aviso de lead novo. A tela seguia dizendo "conectado", então ninguém viu.
 *
 * ⚠️ Por isso o SMTP existe e VEM PRIMEIRO: senha de caixa postal não expira
 * sozinha como um refresh token de OAuth, que é o modo de falha que já nos
 * pegou. O Gmail fica como reserva automática — se o SMTP não estiver
 * configurado, o envio cai nele em vez de simplesmente não acontecer.
 *
 * A senha do SMTP é gravada CIFRADA (`vault-crypto`). Sem `VAULT_KEY` a
 * gravação é RECUSADA: guardar senha de e-mail em texto puro seria repetir de
 * propósito o defeito que o Cofre já tinha.
 */

import type { Pool } from 'pg';
import nodemailer from 'nodemailer';
import { sendGmail, type EmailMessage } from '@/lib/gmail';
import { cifrar, decifrar, vaultKeyConfigurada } from '@/lib/vault-crypto';

export type ConfigSmtp = {
  host: string;
  port: number;
  secure: boolean;       // true = SSL direto (465); false = STARTTLS (587)
  user: string;
  fromNome: string | null;
  fromEmail: string | null;   // vazio = usa o próprio `user`
};

export type ResultadoEnvio = { ok: boolean; via: 'smtp' | 'gmail' | 'nenhum'; erro?: string };

const CHAVES = {
  host: 'email_smtp_host', port: 'email_smtp_port', secure: 'email_smtp_secure',
  user: 'email_smtp_user', senha: 'email_smtp_senha_enc',
  fromNome: 'email_smtp_from_nome', fromEmail: 'email_smtp_from_email',
} as const;

async function ensureSettings(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.system_settings (
       key TEXT PRIMARY KEY, value TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
     )`,
  ).catch(() => {});
}

async function lerChaves(pool: Pool): Promise<Record<string, string>> {
  await ensureSettings(pool);
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM public.system_settings WHERE key = ANY($1)`,
    [Object.values(CHAVES)],
  );
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/** Config visível na tela — NUNCA devolve a senha, só se ela existe. */
export async function lerConfigSmtp(
  pool: Pool,
): Promise<(ConfigSmtp & { temSenha: boolean }) | null> {
  const v = await lerChaves(pool);
  if (!v[CHAVES.host] || !v[CHAVES.user]) return null;
  return {
    host: v[CHAVES.host],
    port: Number(v[CHAVES.port]) || 465,
    secure: v[CHAVES.secure] !== 'false',
    user: v[CHAVES.user],
    fromNome: v[CHAVES.fromNome] ?? null,
    fromEmail: v[CHAVES.fromEmail] ?? null,
    temSenha: Boolean(v[CHAVES.senha]),
  };
}

export async function salvarConfigSmtp(
  pool: Pool,
  dados: Partial<ConfigSmtp> & { senha?: string },
  quem?: string,
): Promise<{ ok: boolean; erro?: string }> {
  await ensureSettings(pool);
  const grava = async (key: string, value: string | null) => {
    await pool.query(
      `INSERT INTO public.system_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
             updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [key, value, quem ?? null],
    );
  };

  if (dados.senha !== undefined && dados.senha !== '') {
    if (!vaultKeyConfigurada()) {
      return { ok: false, erro: 'VAULT_KEY não configurada no servidor — a senha não pode ser guardada com segurança' };
    }
    const cifrada = cifrar(dados.senha);
    if (!cifrada) return { ok: false, erro: 'não foi possível cifrar a senha' };
    await grava(CHAVES.senha, cifrada);
  }

  if (dados.host !== undefined) await grava(CHAVES.host, dados.host.trim() || null);
  if (dados.port !== undefined) await grava(CHAVES.port, String(dados.port));
  if (dados.secure !== undefined) await grava(CHAVES.secure, dados.secure ? 'true' : 'false');
  if (dados.user !== undefined) await grava(CHAVES.user, dados.user.trim() || null);
  if (dados.fromNome !== undefined) await grava(CHAVES.fromNome, dados.fromNome?.trim() || null);
  if (dados.fromEmail !== undefined) await grava(CHAVES.fromEmail, dados.fromEmail?.trim() || null);
  return { ok: true };
}

/** Apaga a configuração inteira — o envio volta a sair pelo Gmail. */
export async function removerConfigSmtp(pool: Pool): Promise<void> {
  await ensureSettings(pool);
  await pool.query(`DELETE FROM public.system_settings WHERE key = ANY($1)`, [Object.values(CHAVES)]);
}

async function enviarPorSmtp(pool: Pool, msg: EmailMessage): Promise<ResultadoEnvio | null> {
  const v = await lerChaves(pool);
  const host = v[CHAVES.host];
  const user = v[CHAVES.user];
  const senhaGuardada = v[CHAVES.senha];
  if (!host || !user || !senhaGuardada) return null;   // não configurado: cai no Gmail

  const senha = decifrar(senhaGuardada);
  if (!senha.valor) {
    return { ok: false, via: 'smtp', erro: 'senha do SMTP não pôde ser lida (VAULT_KEY trocada?)' };
  }

  const secure = v[CHAVES.secure] !== 'false';
  const port = Number(v[CHAVES.port]) || (secure ? 465 : 587);
  const fromEmail = v[CHAVES.fromEmail] || user;
  const fromNome = v[CHAVES.fromNome];

  try {
    const transporte = nodemailer.createTransport({
      host, port, secure, auth: { user, pass: senha.valor },
      // O envio roda dentro de uma requisição: preso sem limite, ele seguraria
      // a resposta da LP junto.
      connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    await transporte.sendMail({
      from: fromNome ? `"${fromNome}" <${fromEmail}>` : fromEmail,
      to: msg.toName ? `"${msg.toName}" <${msg.to}>` : msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: msg.replyTo,
    });
    return { ok: true, via: 'smtp' };
  } catch (err) {
    return { ok: false, via: 'smtp', erro: err instanceof Error ? err.message : String(err) };
  }
}

async function enviarPorGmail(pool: Pool, msg: EmailMessage): Promise<ResultadoEnvio> {
  const { rows } = await pool.query<{ email: string; refresh_token: string }>(
    `SELECT email, refresh_token FROM public.google_connections
      WHERE account_type = 'gmail' AND status = 'connected' AND refresh_token IS NOT NULL
      ORDER BY connected_at DESC LIMIT 1`,
  );
  const conta = rows[0];
  if (!conta) return { ok: false, via: 'nenhum', erro: 'nenhum remetente configurado (sem SMTP e sem Gmail conectado)' };
  const r = await sendGmail({ email: conta.email, refreshToken: conta.refresh_token }, msg);
  return { ok: r.ok, via: 'gmail', erro: r.error };
}

/**
 * Envia uma mensagem pelo remetente configurado.
 *
 * ⚠️ SMTP mal configurado NÃO cai no Gmail: se o host existe e a senha é
 * recusada, cair no Gmail em silêncio esconderia o defeito e a equipe nunca
 * consertaria a configuração. Só a AUSÊNCIA de SMTP usa a reserva.
 */
export async function enviarEmail(pool: Pool, msg: EmailMessage): Promise<ResultadoEnvio> {
  const porSmtp = await enviarPorSmtp(pool, msg);
  if (porSmtp) return porSmtp;
  return enviarPorGmail(pool, msg);
}
