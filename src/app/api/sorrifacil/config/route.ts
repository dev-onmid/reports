import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { decifrar } from '@/lib/vault-crypto';
import {
  lerConfig,
  lerUltimaExecucao,
  listarClinicas,
  salvarConfig,
  type MapaClinica,
} from '@/lib/sorrifacil-sync';

/**
 * Configuração da importação diária do CRM Sorrifácil. Integração da agência —
 * leitura e escrita exigem `unrestricted`. A senha NUNCA volta ao navegador.
 */

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });
    const cfg = await lerConfig(pool);
    return Response.json({
      ativo: cfg.ativo,
      usuario: cfg.usuario,
      tem_senha: !!cfg.senhaCifrada,
      mapa: cfg.mapa,
      ultima: await lerUltimaExecucao(pool),
    });
  } catch (err) {
    console.error('[sorrifacil config GET]', err);
    return Response.json({ error: 'Falha ao ler a configuração.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/** Salva usuário/senha/de-para/ativo. Senha vazia = mantém a gravada. */
export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await req.json() as { ativo?: boolean; usuario?: string; senha?: string; mapa?: MapaClinica[] };
    const mapa = Array.isArray(body.mapa)
      ? body.mapa
          .filter(m => m && typeof m.clinica === 'string' && typeof m.clientId === 'string' && m.clientId)
          .map(m => ({ clinica: m.clinica, clientId: m.clientId, clientName: String(m.clientName ?? '') }))
      : undefined;
    const r = await salvarConfig(pool, {
      ativo: typeof body.ativo === 'boolean' ? body.ativo : undefined,
      usuario: typeof body.usuario === 'string' ? body.usuario : undefined,
      senha: typeof body.senha === 'string' ? body.senha : undefined,
      mapa,
    }, scope.userId);
    if (!r.ok) return Response.json({ error: r.erro }, { status: 400 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[sorrifacil config POST]', err);
    return Response.json({ error: 'Falha ao salvar.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/**
 * Testa o login SEM salvar e devolve as clínicas que o CRM tem — é daí que a
 * tela monta o de-para. Sem senha no corpo, usa a gravada.
 */
export async function PUT(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await req.json().catch(() => ({})) as { usuario?: string; senha?: string };
    const cfg = await lerConfig(pool);
    const usuario = body.usuario?.trim() || cfg.usuario;
    const senha = body.senha || decifrar(cfg.senhaCifrada).valor;
    if (!usuario || !senha) return Response.json({ ok: false, error: 'Informe usuário e senha do CRM.' });
    const clinicas = await listarClinicas(usuario, senha);
    return Response.json({ ok: true, clinicas });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Falha ao testar.' });
  } finally {
    await pool.end();
  }
}
