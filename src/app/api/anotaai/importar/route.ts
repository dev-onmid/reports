import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureAnotaAiSchema } from '@/lib/anotaai';
import { normalizarTelefoneBR } from '@/lib/cardapioweb-recorrencia';
import {
  parseDataPlanilha, parseValorBR, statusDaPlanilha, chaveImportacao,
  type LinhaImportada,
} from '@/lib/anotaai-import';

/**
 * Importa pedidos retroativos de planilha.
 *
 * Existe porque a API do Anota AI não tem consulta histórica: `/ping/list` só
 * devolve o dia corrente. Sem esta porta, o funil de recorrência de um cliente
 * novo levaria meses para ficar útil.
 *
 * O arquivo é lido no BROWSER (xlsx/csv) e chega aqui como linhas já mapeadas —
 * mesmo padrão do Leadlovers. O mapeamento é feito pelo usuário na tela, e não
 * adivinhado aqui: o formato do export do Anota AI não está documentado, e
 * chutar nomes de coluna produziria importação silenciosamente errada.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    clientId?: string; storeId?: string; linhas?: LinhaImportada[];
  };
  const clientId = body.clientId?.trim();
  const linhas = Array.isArray(body.linhas) ? body.linhas : [];
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });
  if (linhas.length === 0) return Response.json({ error: 'Nenhuma linha para importar.' }, { status: 400 });
  if (linhas.length > 20_000) {
    return Response.json({ error: 'Máximo de 20.000 linhas por importação.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureAnotaAiSchema(pool);

    let importadas = 0, ignoradas = 0, semData = 0, semTelefone = 0;

    for (const l of linhas) {
      const dataIso = parseDataPlanilha(l.data);
      if (!dataIso) { semData++; ignoradas++; continue; }

      const fone = normalizarTelefoneBR(l.telefone);
      // Sem telefone o pedido não é atribuível a ninguém e não entra no funil
      // de recorrência — mas ainda conta como receita, então é importado.
      if (!fone) semTelefone++;

      try {
        await pool.query(
          `INSERT INTO public.anotaai_orders
             (client_id, order_id, store_id, customer_name, customer_phone, total,
              check_code, status, sales_channel, discounts, created_at, final, origem)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,'[]'::jsonb,$9,true,'planilha')
           ON CONFLICT (client_id, order_id) DO NOTHING`,
          [
            clientId,
            chaveImportacao(l, dataIso),
            body.storeId ?? null,
            String(l.nome ?? '').trim() || null,
            fone,
            parseValorBR(l.total),
            statusDaPlanilha(l.status),
            String(l.canal ?? '').trim() || 'planilha',
            dataIso,
          ],
        );
        importadas++;
      } catch {
        ignoradas++;
      }
    }

    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.anotaai_orders WHERE client_id = $1`,
      [clientId],
    );

    return Response.json({
      ok: true,
      recebidas: linhas.length,
      importadas,
      ignoradas,
      // Reportado para o usuário saber a QUALIDADE do que importou — uma
      // planilha sem telefone importa receita mas não alimenta o funil.
      sem_data: semData,
      sem_telefone: semTelefone,
      total_no_banco: Number(rows[0]?.n ?? 0),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha na importação.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}
