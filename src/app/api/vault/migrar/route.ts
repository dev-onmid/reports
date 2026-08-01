import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { requireAdmin } from '@/lib/api-auth';
import { cifrar, estaCifrado, vaultKeyConfigurada } from '@/lib/vault-crypto';

/**
 * Cifra as entradas do Cofre que ainda estão em texto puro.
 *
 * Só cifrar na próxima edição não bastaria: senha de cofre fica anos sem ser
 * tocada, e essas são as que mais interessam. Esta rota converte tudo de uma
 * vez, de forma idempotente — rodar de novo não recifra o que já está cifrado
 * (o que quebraria a leitura por dupla cifragem).
 *
 * Só administrador: é uma varredura de escrita sobre credenciais de cliente.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Diagnóstico: quantas faltam, sem alterar nada.
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ id: string; password_enc: string | null }>(
      `SELECT id::text, password_enc FROM public.client_vault WHERE password_enc IS NOT NULL AND password_enc <> ''`,
    );
    const puras = rows.filter(r => !estaCifrado(r.password_enc)).length;
    return Response.json({
      chave_configurada: vaultKeyConfigurada(),
      total_com_senha: rows.length,
      em_texto_puro: puras,
      ja_cifradas: rows.length - puras,
    });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  if (!vaultKeyConfigurada()) {
    return Response.json(
      { error: 'VAULT_KEY não configurada no servidor. Configure antes de migrar.' },
      { status: 503 },
    );
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ id: string; password_enc: string | null }>(
      `SELECT id::text, password_enc FROM public.client_vault WHERE password_enc IS NOT NULL AND password_enc <> ''`,
    );

    let cifradas = 0, jaEstavam = 0, falhas = 0;
    for (const r of rows) {
      if (estaCifrado(r.password_enc)) { jaEstavam++; continue; }
      const c = cifrar(r.password_enc as string);
      if (!c) { falhas++; continue; }
      try {
        // O WHERE repete a condição de "ainda em texto puro" para o caso de
        // duas execuções simultâneas — a segunda não recifra o que a primeira
        // acabou de converter.
        await pool.query(
          `UPDATE public.client_vault SET password_enc = $2, updated_at = NOW()
            WHERE id = $1 AND password_enc = $3`,
          [r.id, c, r.password_enc],
        );
        cifradas++;
      } catch {
        falhas++;
      }
    }

    return Response.json({ ok: true, cifradas, ja_estavam: jaEstavam, falhas, total: rows.length });
  } finally {
    await pool.end();
  }
}
