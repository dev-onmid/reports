/**
 * Importação diária a partir de uma planilha do Google Sheets.
 *
 * Pedido do Matheus (2026-09-28): *"1 vez por dia pegar as infos do Google Sheets
 * como se fosse importar uma planilha"*, configurável dentro do cliente.
 *
 * ⚠️ A importação NÃO é reimplementada aqui. Este módulo baixa a planilha, escolhe
 * a aba do mês e entrega o arquivo para `/api/integrations/spreadsheet` — a MESMA
 * rota do upload manual. Ela carrega anos de lições (dedupe por telefone, régua de
 * recência, reconciliação do ledger, filtro de origem, nono dígito); uma segunda
 * implementação divergiria dela na primeira mudança e voltaríamos a ter dois
 * números diferentes para o mesmo cliente.
 */

import type { Pool } from 'pg';
import { memoizarSchema } from '@/lib/schema-memo';
import { internalHeaders } from '@/lib/session';
import { resolverAbaDoMes, urlExportXlsx } from '@/lib/google-sheets';

export type SheetsConfig = {
  clientId: string;
  sheetId: string;
  sheetUrl: string;
  /** Mapeamento de colunas que a IA resolveu na configuração — reusado todo dia. */
  mapeamento: Record<string, string | null> | null;
  /** Nome da aba escolhida na última configuração (só informativo). */
  abaExemplo: string | null;
  tipoPlanilha: 'lead' | 'venda' | 'hibrido';
  /** O gestor marcou explicitamente que esta planilha é fonte de faturamento. */
  fonteFaturamento: boolean;
  ativo: boolean;
  ultimaSync: string | null;
  ultimoResultado: unknown;
  ultimoErro: string | null;
};

export const ensureSheetsSchema = memoizarSchema(async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_sheets (
      client_id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      sheet_url TEXT NOT NULL,
      mapeamento JSONB,
      aba_exemplo TEXT,
      tipo_planilha TEXT NOT NULL DEFAULT 'lead',
      fonte_faturamento BOOLEAN NOT NULL DEFAULT FALSE,
      ativo BOOLEAN NOT NULL DEFAULT FALSE,
      ultima_sync TIMESTAMPTZ,
      ultimo_resultado JSONB,
      ultimo_erro TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
});

/** Baixa a pasta inteira em XLSX. Lança com mensagem legível — ela vai para a tela. */
export async function baixarPlanilha(sheetId: string): Promise<Buffer> {
  const res = await fetch(urlExportXlsx(sheetId), { redirect: 'follow' });
  if (!res.ok) {
    // ⚠️ O Google responde 302 para a tela de login quando a planilha NÃO está
    // compartilhada por link — o corpo vira HTML e o erro não fala de permissão.
    // Dizer isso aqui evita o gestor caçar o problema no lugar errado.
    throw new Error(
      res.status === 401 || res.status === 403 || res.status === 404
        ? 'Não consegui abrir a planilha. Ela precisa estar compartilhada como "qualquer pessoa com o link pode ver".'
        : `O Google recusou o download da planilha (HTTP ${res.status}).`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const inicio = buf.subarray(0, 4).toString('binary');
  // XLSX é um zip: começa com "PK". HTML é a tela de login/permissão.
  if (!inicio.startsWith('PK')) {
    throw new Error('A planilha voltou como página de login — confira se está compartilhada por link.');
  }
  return buf;
}

export type ResultadoSync = {
  ok: boolean;
  aba?: string;
  motivoAba?: string;
  linhas?: number;
  erro?: string;
  resultado?: unknown;
};

/**
 * Roda a importação de um cliente: baixa, escolhe a aba do mês e manda para a
 * rota de importação.
 *
 * ⚠️ Aba do mês não encontrada NÃO é erro de sistema e não apaga nada: é a aba
 * do mês novo que a clínica ainda não criou. Volta com `ok:false` e uma frase
 * que a tela mostra, e a importação anterior fica de pé.
 */
export async function sincronizarSheets(
  pool: Pool, cfg: SheetsConfig, hoje = new Date(),
): Promise<ResultadoSync> {
  const XLSX = await import('xlsx');
  let buf: Buffer;
  try {
    buf = await baixarPlanilha(cfg.sheetId);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao baixar a planilha.' };
  }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const { aba, motivo } = resolverAbaDoMes(wb.SheetNames, hoje);
  if (!aba) {
    return {
      ok: false, motivoAba: motivo,
      erro: `A aba do mês atual ainda não existe nesta planilha (abas: ${wb.SheetNames.slice(0, 6).join(', ')}…). A última importação continua valendo.`,
    };
  }

  // Só a aba do mês vai para a importação — mandar a pasta inteira faria a rota
  // tratar 21 abas como 21 arquivos e reimportar o histórico todo dia.
  const somenteAba = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(somenteAba, wb.Sheets[aba], aba.slice(0, 31));
  const bytes = XLSX.write(somenteAba, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' }).length;

  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)]), `${aba}.xlsx`);
  fd.append('clientId', cfg.clientId);
  fd.append('tipoPlanilha', cfg.tipoPlanilha);
  fd.append('mappings', JSON.stringify([{ file: `${aba}.xlsx`, clientId: cfg.clientId }]));
  // O de-para da IA usa `revenue`/`name`/…; a rota de importação lê os overrides
  // como `revenueColumn`/`nameColumn`/…. `clinic` fica de fora: aqui a planilha
  // é de UM cliente só, e mandar a coluna de clínica faria a rota tentar o
  // de-para clínica→cliente que não existe neste caminho.
  for (const [campo, coluna] of Object.entries(cfg.mapeamento ?? {})) {
    if (coluna && campo !== 'clinic') fd.append(`${campo}Column`, coluna);
  }

  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const res = await fetch(`${base}/api/integrations/spreadsheet?step=import`, {
    method: 'POST', body: fd, headers: internalHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, aba, motivoAba: motivo, erro: (body as { error?: string }).error ?? `Importação falhou (HTTP ${res.status}).` };
  }
  await pool.query(
    `UPDATE public.client_sheets
        SET ultima_sync = NOW(), ultimo_resultado = $2::jsonb, ultimo_erro = NULL, atualizado_em = NOW()
      WHERE client_id = $1`,
    [cfg.clientId, JSON.stringify({ aba, motivo, linhas, ...(body as object) })]
  );
  return { ok: true, aba, motivoAba: motivo, linhas, resultado: body };
}

/** Grava a falha para a tela mostrar — silêncio aqui é o que faz cron morto parecer cron saudável. */
export async function registrarErroSheets(pool: Pool, clientId: string, erro: string) {
  await pool.query(
    `UPDATE public.client_sheets SET ultimo_erro = $2, atualizado_em = NOW() WHERE client_id = $1`,
    [clientId, erro.slice(0, 500)]
  );
}

export function lerConfig(row: Record<string, unknown>): SheetsConfig {
  return {
    clientId: String(row.client_id),
    sheetId: String(row.sheet_id),
    sheetUrl: String(row.sheet_url),
    mapeamento: (row.mapeamento as SheetsConfig['mapeamento']) ?? null,
    abaExemplo: (row.aba_exemplo as string | null) ?? null,
    tipoPlanilha: (row.tipo_planilha as SheetsConfig['tipoPlanilha']) ?? 'lead',
    fonteFaturamento: row.fonte_faturamento === true,
    ativo: row.ativo === true,
    ultimaSync: row.ultima_sync ? String(row.ultima_sync) : null,
    ultimoResultado: row.ultimo_resultado ?? null,
    ultimoErro: (row.ultimo_erro as string | null) ?? null,
  };
}
