import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmAiSchema } from '@/lib/crm-ai-analysis';
import {
  analisarBloco,
  estimarCusto,
  separarCandidatos,
  LEADS_POR_BLOCO,
} from '@/lib/crm-ai-lote';

/**
 * Análise de IA sob demanda, em lote — o botão "Analisar com IA" do CRM.
 *
 * Duas ações, porque o gestor decide ANTES de gastar:
 *   prever   → quantos leads valem analisar e quanto deve custar
 *   analisar → processa UM bloco e devolve o que mudou
 *
 * A tela manda os ids que estão na tela dela (o recorte de período do CRM é
 * client-side) e chama `analisar` bloco a bloco, desenhando o progresso.
 */

// Um bloco de 25 conversas leva ~30s; o teto largo cobre conversa longa e
// lentidão da Anthropic sem derrubar a rodada no meio.
export const maxDuration = 300;

/** Teto da prévia: um cliente com "Todo período" pode ter milhares de leads. */
const MAX_IDS_PREVER = 20000;

export async function POST(req: NextRequest) {
  let body: {
    clientId?: unknown;
    leadIds?: unknown;
    acao?: unknown;
    incluirJaAnalisados?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
  }

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  const acao = body.acao === 'analisar' ? 'analisar' : 'prever';
  const incluirJaAnalisados = body.incluirJaAnalisados === true;
  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  if (!clientId) return Response.json({ ok: false, error: 'Escolha um cliente.' }, { status: 400 });
  if (leadIds.length === 0) {
    return Response.json({ ok: false, error: 'Nenhum lead no recorte atual.' }, { status: 400 });
  }
  if (leadIds.length > MAX_IDS_PREVER) {
    return Response.json(
      { ok: false, error: `Recorte muito grande (${leadIds.length} leads). Filtre um período menor.` },
      { status: 400 },
    );
  }
  // ⚠️ No modo analisar o bloco vem fatiado pela tela. O teto aqui é o que
  // impede uma chamada solta de pedir mil leads e morrer no meio, deixando
  // metade analisada sem ninguém saber quanto foi.
  if (acao === 'analisar' && leadIds.length > LEADS_POR_BLOCO * 2) {
    return Response.json(
      { ok: false, error: `Bloco grande demais (máximo ${LEADS_POR_BLOCO * 2}).` },
      { status: 400 },
    );
  }

  const pool = makeServerPool();
  try {
    await ensureCrmAiSchema(pool);

    if (acao === 'prever') {
      const sep = await separarCandidatos(pool, clientId, leadIds, incluirJaAnalisados);
      return Response.json({
        ok: true,
        ...sep,
        total: sep.candidatos.length,
        blocos: Math.ceil(sep.candidatos.length / LEADS_POR_BLOCO),
        leadsPorBloco: LEADS_POR_BLOCO,
        custo: estimarCusto(sep.candidatos.length),
      });
    }

    // ⚠️ Reconfere os candidatos mesmo no modo analisar: entre a prévia e a
    // execução a conversa pode ter andado (ou outra aba já ter analisado), e
    // isto também é o que garante que todo id pertence a este cliente.
    const sep = await separarCandidatos(pool, clientId, leadIds, incluirJaAnalisados);
    const resumo = await analisarBloco(pool, sep.candidatos);
    return Response.json({ ok: true, ...resumo, recebidos: leadIds.length, elegiveis: sep.candidatos.length });
  } catch (err) {
    console.error('[crm/ai/analisar-lote]', err);
    return Response.json({ ok: false, error: 'Falha ao analisar. Tente de novo.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
