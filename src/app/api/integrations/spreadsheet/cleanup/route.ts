import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

/**
 * Limpeza dos leads que vieram de IMPORTAÇÃO de planilha, para reimportar do
 * zero com os tipos certos (Leads / Vendas / Híbrida) sem carregar a duplicidade
 * das importações antigas (feitas quando tudo entrava como 'hibrido').
 *
 * ⚠️ Preserva os leads do WhatsApp/Rastreio. Um lead é considerado "de planilha"
 * (removível) só quando:
 *   • veio de importação  (upload_id NOT NULL), E
 *   • NÃO tem nenhum sinal de WhatsApp: sem LID, sem ctwa_clid, sem click_code
 *     e sem NENHUMA mensagem no CRM.
 * Assim, um lead que entrou pelo WhatsApp (com atribuição/conversa) e que uma
 * planilha depois só ATUALIZOU o status NÃO é apagado — é justamente o combo
 * "de qual anúncio veio + virou venda" que a gente quer manter.
 *
 * GET  ?clientId=  → dry-run: conta o que seria removido × preservado (+ amostra).
 * POST { clientId } → apaga de verdade e devolve quantos foram removidos.
 */

/** Cláusula que identifica lead REMOVÍVEL (de planilha, sem rastro de WhatsApp). */
function buildRemovivelWhere(temMensagens: boolean): string {
  const semConversa = temMensagens
    ? 'AND NOT EXISTS (SELECT 1 FROM public.crm_messages m WHERE m.lead_id = l.id)'
    : '';
  return `
    l.client_id = $1
    AND l.upload_id IS NOT NULL
    AND l.whatsapp_lid IS NULL
    AND NULLIF(TRIM(COALESCE(l.ctwa_clid, '')), '') IS NULL
    AND NULLIF(TRIM(COALESCE(l.click_code, '')), '') IS NULL
    ${semConversa}
  `;
}

async function temTabelaMensagens(pool: ReturnType<typeof makeServerPool>): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass('public.crm_messages') AS t`);
  return rows[0]?.t != null;
}

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const temMsg = await temTabelaMensagens(pool);
    const where = buildRemovivelWhere(temMsg);

    const { rows: [rem] } = await pool.query(
      `SELECT COUNT(*)::int AS leads,
              COALESCE(SUM(COALESCE(NULLIF(l.revenue,0), l.valor_rs, 0)), 0) AS receita
         FROM public.crm_leads l
        WHERE ${where}`,
      [clientId],
    );
    // Preservados = todo o resto do cliente (WhatsApp, merges, manuais).
    const { rows: [tot] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.crm_leads WHERE client_id = $1`,
      [clientId],
    );
    const { rows: amostra } = await pool.query(
      `SELECT COALESCE(NULLIF(l.nome,''), NULLIF(l.lead_name,''), '(sem nome)') AS nome,
              COALESCE(NULLIF(l.revenue,0), l.valor_rs, 0) AS valor
         FROM public.crm_leads l
        WHERE ${where}
        ORDER BY COALESCE(NULLIF(l.revenue,0), l.valor_rs, 0) DESC
        LIMIT 8`,
      [clientId],
    );

    const remover = Number(rem.leads) || 0;
    const total = Number(tot.total) || 0;
    return Response.json({
      clientId,
      total,
      remover,
      preservar: total - remover,
      receita_removida: Number(rem.receita) || 0,
      amostra: amostra.map(a => ({ nome: String(a.nome), valor: Number(a.valor) || 0 })),
    });
  } catch (err) {
    console.error('[spreadsheet-cleanup GET]', err);
    return Response.json({ error: 'Falha ao calcular a limpeza.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  let clientId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    clientId = typeof body?.clientId === 'string' ? body.clientId : null;
  } catch { /* corpo inválido → 400 abaixo */ }
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const temMsg = await temTabelaMensagens(pool);
    const where = buildRemovivelWhere(temMsg);
    // DELETE com o MESMO critério do dry-run (subquery por id — o alias `l` do
    // WHERE precisa existir; DELETE ... USING não expõe o próprio alvo, então
    // filtramos por id via subconsulta).
    const { rowCount } = await pool.query(
      `DELETE FROM public.crm_leads
        WHERE id IN (
          SELECT l.id FROM public.crm_leads l WHERE ${where}
        )`,
      [clientId],
    );
    return Response.json({ ok: true, removidos: rowCount ?? 0 });
  } catch (err) {
    console.error('[spreadsheet-cleanup POST]', err);
    return Response.json({ error: 'Falha ao remover os leads de planilha.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
