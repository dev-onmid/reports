import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { identificarCliente } from '@/lib/reuniao-intake';
import { conferirSegredoIntegracao, respostaSegredo } from '@/lib/integration-secret';

/**
 * Identificação do cliente de uma reunião (Make, Cenário 1).
 *
 * Substitui o módulo de IA do cenário: recebe o nome lido da agenda e devolve
 * o MESMO contrato que a IA devolvia (`cliente_corrigido`, `confianca`,
 * `motivo`, `alternativas`) — só que por regras de texto determinísticas sobre
 * a lista de clientes ativos, com `confianca` garantidamente numérica. Foi a
 * confiança não-numérica ("95%") que deixou o cenário morrendo em silêncio no
 * roteador em 30/07.
 */

export async function POST(req: NextRequest) {
  const auth = conferirSegredoIntegracao(req);
  if (auth !== 'ok') return respostaSegredo(auth);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, erro: 'json_invalido' }, { status: 400 });
  }

  const nome = [body.nome_reuniao, body.nome, body.cliente]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';

  const pool = makeServerPool();
  try {
    // Só ativos: nome de ex-cliente parecido com um ativo era exatamente o
    // risco de mandar a reunião pro morto.
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM public.clients
        WHERE COALESCE(status, 'Ativo') = 'Ativo'
          AND COALESCE(TRIM(name), '') <> ''`,
    );

    const r = identificarCliente(rows.map((c) => c.name), nome);
    return Response.json({ ok: true, nome_recebido: nome, ...r });
  } catch (err) {
    console.error('[integracao identificar]', err);
    // 200 + abstenção: se o banco falhar, o cenário cai na triagem (doc
    // neutro + aviso) em vez de morrer com "Couldn't connect" indecifrável.
    return Response.json({
      ok: false,
      erro: 'falha_interna',
      cliente_corrigido: 'NAO IDENTIFICADO',
      confianca: 0,
      motivo: 'falha interna no reports',
      alternativas: [],
    });
  } finally {
    await pool.end();
  }
}
