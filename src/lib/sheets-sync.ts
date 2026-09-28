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
import { escolherAbas, abasCompativeis, urlExportXlsx, MAX_ABAS_POR_RODADA } from '@/lib/google-sheets';

export type SheetsConfig = {
  clientId: string;
  sheetId: string;
  sheetUrl: string;
  /** Mapeamento de colunas que a IA resolveu na configuração — reusado todo dia. */
  mapeamento: Record<string, string | null> | null;
  /** Nome da aba escolhida na última configuração (só informativo). */
  abaExemplo: string | null;
  /** Abas escolhidas à mão pelo gestor. Vazio = só o mês, como era antes. */
  abas: string[] | null;
  /** Cache das abas que a planilha tinha na última análise (só para a tela). */
  abasVistas: string[] | null;
  /** Somar a aba do mês atual às escolhidas. Padrão true — ver `escolherAbas`. */
  seguirMes: boolean;
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
  // Escolha de abas (2026-09-28). `seguir_mes` nasce TRUE para a configuração
  // que já existia continuar acompanhando a virada do mês sem ninguém mexer.
  await pool.query(`
    ALTER TABLE public.client_sheets
      ADD COLUMN IF NOT EXISTS abas JSONB,
      ADD COLUMN IF NOT EXISTS seguir_mes BOOLEAN NOT NULL DEFAULT TRUE,
      -- Lista de abas vista na última análise. É CACHE para a tela poder
      -- oferecer as caixinhas ao reabrir sem rebaixar 2 MB de planilha; a
      -- rotina diária nunca lê isto, ela sempre olha a planilha de verdade.
      ADD COLUMN IF NOT EXISTS abas_vistas JSONB
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
  /** Abas importadas, separadas por vírgula (compat com a tela antiga). */
  aba?: string;
  abas?: string[];
  avisos?: string[];
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
  const escolha = escolherAbas(wb.SheetNames, { fixas: cfg.abas, seguirMes: cfg.seguirMes }, hoje);
  if (!escolha.abas.length) {
    return {
      ok: false, motivoAba: escolha.motivoAbaDoMes,
      erro: cfg.seguirMes
        ? `A aba do mês atual ainda não existe nesta planilha (abas: ${wb.SheetNames.slice(0, 6).join(', ')}…). A última importação continua valendo.`
        : 'Nenhuma das abas escolhidas existe mais nesta planilha. A última importação continua valendo.',
    };
  }

  // ⚠️ Aba cujo cabeçalho não comporta o de-para fica FORA: a rota de importação
  // recusa o lote inteiro quando uma coluna mapeada não existe, e um mês antigo
  // com layout diferente derrubaria também o mês corrente.
  const cabecalhos: Record<string, string[]> = {};
  for (const aba of escolha.abas) {
    const linha = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, defval: '' })[0] ?? [];
    cabecalhos[aba] = (linha as unknown[]).map(c => String(c ?? '').trim());
  }
  const { ok: abasOk, incompativeis } = abasCompativeis(cabecalhos, escolha.abas, cfg.mapeamento);
  if (!abasOk.length) {
    return {
      ok: false, motivoAba: escolha.motivoAbaDoMes,
      erro: `Nenhuma aba escolhida tem as colunas do mapeamento (falta ${incompativeis[0]?.faltam.join(', ')} em "${incompativeis[0]?.aba}"). Reanalise as colunas.`,
    };
  }

  // Uma aba por arquivo, num POST só: a rota agrupa por assinatura de cabeçalho,
  // então meses diferentes do mesmo relatório entram como um lote e o dedupe
  // enxerga tudo de uma vez. Mandar a pasta inteira faria as 21 abas virarem 21
  // arquivos e reimportar o histórico todo dia.
  const fd = new FormData();
  const mappings: { file: string; clientId: string }[] = [];
  let linhas = 0;
  for (const aba of abasOk) {
    const so = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(so, wb.Sheets[aba], aba.slice(0, 31));
    const bytes = XLSX.write(so, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const nome = `${aba}.xlsx`;
    fd.append('file', new Blob([new Uint8Array(bytes)]), nome);
    mappings.push({ file: nome, clientId: cfg.clientId });
    linhas += XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' }).length;
  }

  fd.append('clientId', cfg.clientId);
  fd.append('tipoPlanilha', cfg.tipoPlanilha);
  // Faturamento é escolha declarada, não consequência do tipo — ver a rota.
  if (cfg.fonteFaturamento) fd.append('escreveReceita', '1');
  fd.append('mappings', JSON.stringify(mappings));
  // O de-para da IA usa `revenue`/`name`/…; a rota de importação lê os overrides
  // como `revenueColumn`/`nameColumn`/…. `clinic` fica de fora: aqui a planilha
  // é de UM cliente só, e mandar a coluna de clínica faria a rota tentar o
  // de-para clínica→cliente que não existe neste caminho.
  for (const [campo, coluna] of Object.entries(cfg.mapeamento ?? {})) {
    if (coluna && campo !== 'clinic') fd.append(`${campo}Column`, coluna);
  }

  const avisos = [
    ...incompativeis.map(i => `A aba "${i.aba}" ficou de fora: não tem ${i.faltam.join(', ')}.`),
    ...(escolha.sumidas.length ? [`Não existem mais na planilha: ${escolha.sumidas.join(', ')}.`] : []),
    ...(escolha.cortadas.length ? [`Só as ${MAX_ABAS_POR_RODADA} primeiras abas entram por rodada; ficaram de fora: ${escolha.cortadas.join(', ')}.`] : []),
  ];

  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const res = await fetch(`${base}/api/integrations/spreadsheet?step=import`, {
    method: 'POST', body: fd, headers: internalHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  const aba = abasOk.join(', ');
  const motivo = escolha.motivoAbaDoMes;
  if (!res.ok) {
    return { ok: false, aba, motivoAba: motivo, erro: (body as { error?: string }).error ?? `Importação falhou (HTTP ${res.status}).` };
  }
  await pool.query(
    `UPDATE public.client_sheets
        SET ultima_sync = NOW(), ultimo_resultado = $2::jsonb, ultimo_erro = NULL, atualizado_em = NOW()
      WHERE client_id = $1`,
    [cfg.clientId, JSON.stringify({ aba, abas: abasOk, motivo, linhas, avisos, ...(body as object) })]
  );
  return { ok: true, aba, abas: abasOk, motivoAba: motivo, linhas, avisos, resultado: body };
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
    abas: Array.isArray(row.abas) ? (row.abas as string[]) : null,
    abasVistas: Array.isArray(row.abas_vistas) ? (row.abas_vistas as string[]) : null,
    seguirMes: row.seguir_mes !== false,
    tipoPlanilha: (row.tipo_planilha as SheetsConfig['tipoPlanilha']) ?? 'lead',
    fonteFaturamento: row.fonte_faturamento === true,
    ativo: row.ativo === true,
    ultimaSync: row.ultima_sync ? String(row.ultima_sync) : null,
    ultimoResultado: row.ultimo_resultado ?? null,
    ultimoErro: (row.ultimo_erro as string | null) ?? null,
  };
}
