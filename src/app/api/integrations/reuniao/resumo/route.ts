import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveClientByName } from '@/lib/reuniao-intake';
import { parseChecklist, parseDataReuniao, salvarResumoReuniao } from '@/lib/reuniao-resumos';
import { conferirSegredoIntegracao, respostaSegredo } from '@/lib/integration-secret';

/**
 * Reunião pronta, chamado pelo Make no FINAL do cenário — irmão da rota
 * `/api/integrations/reuniao` (que cria as tarefas no ClickUp). Este endpoint
 * guarda o pacote da reunião pra aba Reuniões do cliente: resumo (obrigatório),
 * link da gravação, doc e checklist de continuidade (opcionais).
 *
 * Payload esperado (header `x-onmid-secret`):
 *   { "cliente": "<nome>", "resumo": "<texto>",
 *     "titulo"?, "meeting_id"? (dedupe!), "doc_url"?, "data"?,
 *     "gravacao_url"? (aceita recording_url/video_url),
 *     "checklist"?: ["item", ...] | [{texto, feito?}, ...] | "um por linha" }
 *
 * Mesma autenticação (`x-onmid-secret`) e mesma filosofia de resposta: erro de
 * negócio sai como 200 + ok:false pra percorrer a rota de erro do Make legível
 * (5xx lá vira "Couldn't connect" sem corpo). O proxy já libera o subcaminho.
 */

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = conferirSegredoIntegracao(req);
  if (auth !== 'ok') return respostaSegredo(auth);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, erro: 'json_invalido' }, { status: 400 });
  }

  const cliente = typeof body.cliente === 'string' ? body.cliente.trim() : '';
  // `resumo` é o nome canônico; `texto` cobre configuração alternativa no Make.
  const resumo = [body.resumo, body.texto]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';

  if (!cliente) return Response.json({ ok: false, erro: 'cliente_obrigatorio' }, { status: 400 });
  if (!resumo) return Response.json({ ok: false, erro: 'resumo_obrigatorio' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { match, sugestoes, ambiguo, motivo } = await resolveClientByName(pool, cliente);
    if (!match) {
      // Mesmo contrato da rota irmã: cliente novo não é falha de requisição.
      return Response.json({ ok: false, erro: 'cliente_nao_encontrado', nome_recebido: cliente, sugestoes, ambiguo, motivo });
    }

    // `gravacao_url` é o nome canônico; os outros cobrem mapeamento alternativo no Make.
    const gravacao = [body.gravacao_url, body.recording_url, body.video_url, body.gravacao]
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? null;

    const r = await salvarResumoReuniao(pool, {
      clientId: match.id,
      resumo,
      titulo: typeof body.titulo === 'string' ? body.titulo : null,
      meetingId: typeof body.meeting_id === 'string' ? body.meeting_id : null,
      docUrl: typeof body.doc_url === 'string' ? body.doc_url : null,
      recordingUrl: gravacao,
      checklist: parseChecklist(body.checklist ?? body.pendencias ?? body.acoes),
      reuniaoEm: parseDataReuniao(body.data ?? body.reuniao_em),
    });
    return Response.json({ ok: true, cliente: { id: match.id, nome: match.name }, resumo_id: r.id, atualizado: r.atualizado });
  } catch (err) {
    console.error('[integracao reuniao resumo]', err);
    return Response.json({
      ok: false,
      erro: 'falha_interna',
      detalhe: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pool.end();
  }
}
