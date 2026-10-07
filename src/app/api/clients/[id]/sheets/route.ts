/**
 * Planilha do Google Sheets vinculada a um cliente.
 *
 * GET    — estado da configuração (a tela de "Vincular contas" já consome isto).
 * PUT    — salva a URL e as opções (tipo, faturamento, ligar/desligar).
 * POST   — `{ acao: 'analisar' }` lê as abas e deixa a IA mapear as colunas;
 *          `{ acao: 'importar' }` roda a importação agora, igual ao cron.
 *
 * ⚠️ A importação em si vive em `/api/integrations/spreadsheet` — ver o
 * comentário de `sheets-sync.ts` sobre por que ela não é reimplementada.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { internalHeaders } from '@/lib/session';
import { extrairSheetId } from '@/lib/google-sheets';
import {
  baixarPlanilha, ensureSheetsSchema, lerConfig, registrarErroSheets, sincronizarSheets,
} from '@/lib/sheets-sync';
import { normalizarMapeamento } from '@/lib/sheets-mapeamento';

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureSheetsSchema(pool);
    const { rows } = await pool.query(`SELECT * FROM public.client_sheets WHERE client_id = $1`, [id]);
    if (!rows[0]) return Response.json({ sheetsUrl: null, sheetsResult: null, config: null });
    const cfg = lerConfig(rows[0]);
    // `sheetsUrl`/`sheetsResult` são o shape que a tela antiga já espera.
    return Response.json({ sheetsUrl: cfg.sheetUrl, sheetsResult: cfg.ultimoResultado, config: cfg });
  } catch (e) {
    console.error('[sheets GET]', e);
    return Response.json({ sheetsUrl: null, sheetsResult: null, config: null });
  } finally {
    await pool.end();
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    sheetsUrl?: string; tipoPlanilha?: string; fonteFaturamento?: boolean;
    ativo?: boolean; mapeamento?: Record<string, string | string[] | null>;
    abas?: string[]; seguirMes?: boolean; colunas?: string[];
  };
  // ⚠️ Nunca grava o que a tela mandou cru: campo fora do catálogo viraria um
  // override que a importação ignora, e coluna inexistente derruba a aba inteira
  // na rodada do dia seguinte. `colunas` é o cabeçalho que a tela tem em mãos.
  const mapa = body.mapeamento === undefined
    ? null
    : normalizarMapeamento(body.mapeamento, body.colunas);

  const sheetId = extrairSheetId(body.sheetsUrl);
  if (!sheetId) return Response.json({ error: 'Cole o link de uma planilha do Google Sheets.' }, { status: 400 });

  // ⚠️ Fonte de faturamento e tipo andam juntos: só a planilha de VENDA escreve
  // receita na importação (correção de 2026-09-28, que matou a dupla contagem da
  // Sorrifácil). Marcar "esta planilha traz faturamento" na tela é o que torna
  // essa escolha EXPLÍCITA do gestor, em vez de depender do tipo padrão.
  const fonte = body.fonteFaturamento === true;
  // ⚠️ Faturamento NÃO muda o tipo. O tipo 'venda' força `closed = true` em toda
  // linha (é um ledger: cada linha É uma venda concluída) — foi o que marcou os
  // 104 leads da Odonto First como fechados, inclusive "Desqualificado". Quem
  // manda a receita entrar é `fonte_faturamento`, sozinha.
  // ⚠️ E o padrão é 'hibrido', NUNCA 'lead': `registro_tipo = 'lead'` faz
  // `contarFunil` PULAR a receita da linha (funil-etapas.ts), então a planilha
  // apareceria no funil com faturamento zero. 'hibrido' conta nos dois lados —
  // é o default do sistema e o caso normal de uma planilha de CRM.
  const tipo = body.tipoPlanilha === 'venda' ? 'venda' : 'hibrido';

  const pool = makeServerPool();
  try {
    await ensureSheetsSchema(pool);
    await pool.query(
      `INSERT INTO public.client_sheets
         (client_id, sheet_id, sheet_url, tipo_planilha, fonte_faturamento, ativo, mapeamento, abas, seguir_mes)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, FALSE), $7::jsonb, $8::jsonb, COALESCE($9, TRUE))
       ON CONFLICT (client_id) DO UPDATE SET
         sheet_id = EXCLUDED.sheet_id,
         sheet_url = EXCLUDED.sheet_url,
         tipo_planilha = EXCLUDED.tipo_planilha,
         fonte_faturamento = EXCLUDED.fonte_faturamento,
         ativo = COALESCE($6, public.client_sheets.ativo),
         -- Mapeamento só é sobrescrito quando vem preenchido: salvar a URL de
         -- novo não pode apagar o de-para de colunas que a IA já resolveu.
         mapeamento = COALESCE($7::jsonb, public.client_sheets.mapeamento),
         abas = COALESCE($8::jsonb, public.client_sheets.abas),
         seguir_mes = COALESCE($9, public.client_sheets.seguir_mes),
         atualizado_em = NOW()`,
      [id, sheetId, String(body.sheetsUrl), tipo, fonte,
       body.ativo === undefined ? null : body.ativo,
       mapa ? JSON.stringify(mapa) : null,
       // ⚠️ Lista VAZIA é uma escolha ("nenhuma aba fixa, só o mês") e precisa
       // gravar `[]`; `undefined` é "não mexi nisso" e preserva o que está lá.
       body.abas === undefined ? null : JSON.stringify(body.abas.filter(a => typeof a === 'string').slice(0, 60)),
       body.seguirMes === undefined ? null : body.seguirMes]
    );
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[sheets PUT]', e);
    return Response.json({ error: 'Erro ao salvar a configuração.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { acao?: string; sheetsUrl?: string };
  const pool = makeServerPool();
  try {
    await ensureSheetsSchema(pool);
    const { rows } = await pool.query(`SELECT * FROM public.client_sheets WHERE client_id = $1`, [id]);
    if (!rows[0]) return Response.json({ error: 'Vincule a planilha antes.' }, { status: 400 });
    const cfg = lerConfig(rows[0]);

    if (body.acao === 'importar') {
      const r = await sincronizarSheets(pool, cfg);
      if (!r.ok && r.erro) await registrarErroSheets(pool, id, r.erro);
      return Response.json(r, { status: r.ok ? 200 : 422 });
    }

    // ── analisar: abas + mapeamento sugerido pela IA ──────────────────────────
    const XLSX = await import('xlsx');
    let buf: Buffer;
    try {
      buf = await baixarPlanilha(cfg.sheetId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao baixar a planilha.';
      await registrarErroSheets(pool, id, msg);
      return Response.json({ error: msg }, { status: 422 });
    }
    const wb = XLSX.read(buf, { type: 'buffer' });
    const { resolverAbaDoMes } = await import('@/lib/google-sheets');
    const { aba, motivo } = resolverAbaDoMes(wb.SheetNames, new Date());
    // Sem a aba do mês, analisa a primeira — o objetivo aqui é descobrir as
    // COLUNAS, e o layout é o mesmo em todas as abas de mês.
    const alvo = aba ?? wb.SheetNames[0];

    const so = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(so, wb.Sheets[alvo], alvo.slice(0, 31));
    const bytes = XLSX.write(so, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(bytes)]), `${alvo}.xlsx`);
    const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const res = await fetch(`${base}/api/integrations/spreadsheet?step=analyze`, {
      method: 'POST', body: fd, headers: internalHeaders(),
    });
    const analise = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (analise as { error?: string }).error ?? 'A IA não conseguiu ler as colunas.';
      await registrarErroSheets(pool, id, msg);
      return Response.json({ error: msg }, { status: 422 });
    }
    // ⚠️ Grava o de-para AQUI, não só na tela. Sem isto, a rotina diária rodava
    // com `mapeamento` nulo e a importação caía na detecção automática de coluna:
    // no teste com a planilha real entraram 108 leads sem nome e sem telefone.
    const mapaIa = (analise as { mapping?: Record<string, string | string[] | null> }).mapping ?? null;
    // Cabeçalho da aba analisada: é o que a tela oferece no seletor de coluna.
    const linha0 = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[alvo], { header: 1, defval: '' })[0] ?? [];
    const colunas = (linha0 as unknown[]).map((c) => String(c ?? '')).filter((c) => c.trim().length > 0);
    const mapa = normalizarMapeamento(mapaIa, colunas);
    await pool.query(
      `UPDATE public.client_sheets
          SET aba_exemplo = $2, mapeamento = COALESCE($3::jsonb, mapeamento),
              abas_vistas = $4::jsonb, colunas_vistas = $5::jsonb,
              ultimo_erro = NULL, atualizado_em = NOW()
        WHERE client_id = $1`,
      [id, alvo, mapa ? JSON.stringify(mapa) : null, JSON.stringify(wb.SheetNames), JSON.stringify(colunas)]
    );
    return Response.json({ ok: true, abas: wb.SheetNames, colunas, abaDoMes: aba, motivoAba: motivo, analisada: alvo, analise: { ...analise, mapping: mapa } });
  } catch (e) {
    console.error('[sheets POST]', e);
    return Response.json({ error: 'Erro ao analisar a planilha.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
