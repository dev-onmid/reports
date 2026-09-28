/**
 * Importa 1× por dia a planilha do Google Sheets de cada cliente configurado.
 *
 * GET ?secret=… (&clientId=… para forçar um só, &dry=1 para não gravar)
 *
 * ⚠️ Cron novo = lembrar do proxy. `/api/sheets/sync-cron` precisa entrar em
 * CRON_PREFIXES, senão a chamada toma "Não autenticado" do PROXY e o motor fica
 * morto em silêncio — foi exatamente o que aconteceu com o worker de publicações.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureSheetsSchema, lerConfig, registrarErroSheets, sincronizarSheets } from '@/lib/sheets-sync';

export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const alvo = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter((s): s is string => !!s && s.length > 8);
  if (alvo.length === 0) return false;
  const q = req.nextUrl.searchParams.get('secret');
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return alvo.some(s => s === q || s === bearer);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'não autorizado' }, { status: 401 });
  const soCliente = req.nextUrl.searchParams.get('clientId');
  const dry = req.nextUrl.searchParams.get('dry') === '1';

  const pool = makeServerPool();
  // Orçamento: a rota tem 300s e cada cliente faz download + importação.
  const limite = Date.now() + 260_000;
  const feitos: unknown[] = [];
  try {
    await ensureSheetsSchema(pool);
    const { rows } = await pool.query(
      `SELECT s.* FROM public.client_sheets s
         JOIN public.clients c ON c.id = s.client_id
        WHERE s.ativo = TRUE
          AND COALESCE(c.status, 'Ativo') NOT IN ('Arquivado', 'Inativo')
          ${soCliente ? 'AND s.client_id = $1' : ''}
        ORDER BY s.ultima_sync ASC NULLS FIRST`,
      soCliente ? [soCliente] : []
    );

    for (const row of rows) {
      if (Date.now() > limite) { feitos.push({ parcial: true, motivo: 'sem tempo nesta rodada' }); break; }
      const cfg = lerConfig(row);
      if (dry) { feitos.push({ clientId: cfg.clientId, dry: true, sheetId: cfg.sheetId }); continue; }
      try {
        const r = await sincronizarSheets(pool, cfg);
        if (!r.ok && r.erro) await registrarErroSheets(pool, cfg.clientId, r.erro);
        feitos.push({ clientId: cfg.clientId, ...r });
      } catch (e) {
        // ⚠️ Um cliente que falha não pode derrubar os outros — o erro fica
        // gravado na linha dele e aparece na tela daquele cliente.
        const msg = e instanceof Error ? e.message : String(e);
        await registrarErroSheets(pool, cfg.clientId, msg).catch(() => {});
        feitos.push({ clientId: cfg.clientId, ok: false, erro: msg });
      }
    }
    return Response.json({ ok: true, clientes: rows.length, resultados: feitos });
  } catch (e) {
    console.error('[sheets sync-cron]', e);
    return Response.json({ error: 'falha no cron de planilhas' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
