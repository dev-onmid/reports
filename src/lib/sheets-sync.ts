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
import { escolherAbas, assinaturaDaAba, urlExportXlsx, MAX_ABAS_POR_RODADA } from '@/lib/google-sheets';
import { casarColunasDaAba, abaUtilizavel, CAMPOS, type Mapeamento } from '@/lib/sheets-mapeamento';

export type SheetsConfig = {
  clientId: string;
  sheetId: string;
  sheetUrl: string;
  /** Mapeamento de colunas que a IA resolveu na configuração — reusado todo dia. */
  mapeamento: Record<string, string | string[] | null> | null;
  /** Nome da aba escolhida na última configuração (só informativo). */
  abaExemplo: string | null;
  /** Abas escolhidas à mão pelo gestor. Vazio = só o mês, como era antes. */
  abas: string[] | null;
  /** Cache das abas que a planilha tinha na última análise (só para a tela). */
  abasVistas: string[] | null;
  /**
   * Cabeçalho da aba analisada, guardado para a tela poder oferecer o seletor de
   * coluna ao reabrir sem baixar a planilha de novo. A sincronização nunca lê
   * isto — ela sempre olha o cabeçalho real de cada aba.
   */
  colunasVistas: string[] | null;
  /** Campos cujo de-para foi escolhido pelo gestor — a IA não os sobrescreve. */
  camposManuais: string[] | null;
  /** `aba -> assinatura` do que já foi importado, para não repetir trabalho. */
  abasImportadas: Record<string, string> | null;
  /** Ajustes de coluna que o gestor fez para UMA aba específica. */
  mapeamentoPorAba: Record<string, Mapeamento> | null;
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
      ADD COLUMN IF NOT EXISTS abas_vistas JSONB,
      -- Cabeçalho visto na última análise, para o editor de colunas (2026-10-07).
      ADD COLUMN IF NOT EXISTS colunas_vistas JSONB,
      -- Campos que o gestor apontou à mão. A reanálise preserva estes: sem isso,
      -- um clique em "Reanalisar colunas" desfaz o ajuste e ninguém percebe.
      ADD COLUMN IF NOT EXISTS campos_manuais JSONB,
      -- Assinatura do conteúdo de cada aba já importada (2026-10-07). É o que
      -- faz o histórico entrar aos poucos e depois parar de gastar vaga.
      ADD COLUMN IF NOT EXISTS abas_importadas JSONB,
      -- De-para por ABA (2026-10-07): a coluna de data pode se chamar "DATA"
      -- num mês e "Data Entrada" no anterior. Só os ajustes manuais moram aqui;
      -- o automático é recalculado a cada rodada.
      ADD COLUMN IF NOT EXISTS mapeamento_por_aba JSONB
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
  // ⚠️ Assinatura de TODAS as abas antes de escolher: é ela que diz o que mudou
  // desde a última rodada e, portanto, o que ainda precisa de vaga.
  // ⚠️⚠️ O de-para entra na assinatura. Sem isso, ajustar as colunas na tela não
  // teria efeito nenhum sobre o histórico: as abas antigas continuariam
  // "idênticas", seriam puladas para sempre e os meses anteriores ficariam com o
  // mapeamento velho. Com o selo, mudar uma coluna reimporta tudo.
  const selo = JSON.stringify(cfg.mapeamento ?? null);
  const assinaturas: Record<string, string> = {};
  for (const nome of wb.SheetNames) {
    try { assinaturas[nome] = assinaturaDaAba(XLSX.utils.sheet_to_csv(wb.Sheets[nome]) + '\u0000' + selo); } catch { /* aba ilegível entra como pendente */ }
  }
  const escolha = escolherAbas(
    wb.SheetNames,
    { fixas: cfg.abas, seguirMes: cfg.seguirMes, jaImportadas: cfg.abasImportadas, assinaturas },
    hoje,
  );
  if (!escolha.abas.length) {
    return {
      ok: false, motivoAba: escolha.motivoAbaDoMes,
      erro: cfg.seguirMes
        ? `A aba do mês atual ainda não existe nesta planilha (abas: ${wb.SheetNames.slice(0, 6).join(', ')}…). A última importação continua valendo.`
        : 'Nenhuma das abas escolhidas existe mais nesta planilha. A última importação continua valendo.',
    };
  }

  // ⚠️⚠️ CADA ABA RESOLVE AS PRÓPRIAS COLUNAS. O de-para salvo é só o ponto de
  // partida: a coluna de data pode estar em A num mês e em C no outro, chamar-se
  // `DATA` agora e `Data Entrada` em 2024. `casarColunasDaAba` acha, por campo,
  // a coluna daquela aba — e o que ela não entregar simplesmente não é mandado,
  // em vez de reprovar a aba inteira (era assim que a Romanza perdia um ano).
  const cabecalhos: Record<string, string[]> = {};
  const casamentos: Record<string, ReturnType<typeof casarColunasDaAba>> = {};
  for (const aba of escolha.abas) {
    const linha = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, defval: '' })[0] ?? [];
    // Cru, sem trim: o nome EXATO é o que a rota de importação vai procurar.
    cabecalhos[aba] = (linha as unknown[]).map(c => String(c ?? ''));
    casamentos[aba] = casarColunasDaAba(cabecalhos[aba], cfg.mapeamento, cfg.mapeamentoPorAba?.[aba] ?? null);
  }
  const abasOk: string[] = [];
  const incompativeis: { aba: string; faltam: string[] }[] = [];
  const rotuloDe = (k: string) => CAMPOS.find(c => c.chave === k)?.rotulo ?? k;
  for (const aba of escolha.abas) {
    const { ok, faltamEssenciais } = abaUtilizavel(casamentos[aba], cfg.fonteFaturamento);
    if (ok) abasOk.push(aba);
    else incompativeis.push({ aba, faltam: faltamEssenciais.map(rotuloDe) });
  }
  if (!abasOk.length) {
    return {
      ok: false, motivoAba: escolha.motivoAbaDoMes,
      erro: `Nenhuma aba escolhida tem as colunas mínimas (falta ${incompativeis[0]?.faltam.join(', ')} em "${incompativeis[0]?.aba}"). Ajuste as colunas dessa aba na tela.`,
    };
  }

  // ⚠️⚠️ UM POST POR FORMATO DE CABEÇALHO, não um POST com todas as abas.
  // A etapa de importação da rota processa SÓ O PRIMEIRO grupo de cabeçalho
  // ("a tela envia só os arquivos daquele grupo") — mandar tudo junto faz as
  // abas de formato diferente serem descartadas EM SILÊNCIO. Medido na Odonto
  // First: as 6 abas escolhidas formam 3 formatos (26, 25 e 22 colunas, porque
  // a planilha mudou ao longo do ano) e só abril+maio eram importados; agosto e
  // setembro sumiam, com o comparecimento zerado na dashboard.
  const porFormato = new Map<string, string[]>();
  for (const aba of abasOk) {
    const chave = (cabecalhos[aba] ?? []).join('|');
    const lista = porFormato.get(chave);
    if (lista) lista.push(aba);
    else porFormato.set(chave, [aba]);
  }

  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  // ⚠️ Abas incompatíveis são AGRUPADAS pelo que falta. Uma frase por aba vira
  // um parágrafo ilegível quando a planilha tem anos de histórico com layout
  // antigo — a da Romanza gerava 11 frases quase idênticas e o aviso que
  // importava (o corte de abas) sumia no meio.
  const porFalta = new Map<string, string[]>();
  for (const i of incompativeis) {
    const chave = i.faltam.join(', ');
    const lista = porFalta.get(chave) ?? [];
    lista.push(i.aba);
    porFalta.set(chave, lista);
  }
  // Aba que ENTROU mas sem algum campo do padrão: é informação, não bloqueio.
  const parciais = abasOk
    .map(aba => ({ aba, faltam: casamentos[aba].faltam.map(rotuloDe) }))
    .filter(x => x.faltam.length > 0);

  const avisos = [
    ...[...porFalta].map(([faltam, abas]) =>
      abas.length === 1
        ? `A aba "${abas[0]}" ficou de fora: não tem ${faltam}.`
        : `${abas.length} abas ficaram de fora por não terem ${faltam}: ${abas.join(', ')}.`),
    ...(escolha.sumidas.length ? [`Não existem mais na planilha: ${escolha.sumidas.join(', ')}.`] : []),
    ...(escolha.cortadas.length ? [`Entram até ${MAX_ABAS_POR_RODADA} abas por rodada — o mês atual sempre entra. Faltam importar, e entram nas próximas rodadas: ${escolha.cortadas.join(', ')}.`] : []),
    // ⚠️ Separado do corte de propósito: isto NÃO é pendência, e misturar fazia
    // a tela parecer que algo está faltando quando o histórico já está no banco.
    ...(escolha.jaEstavam.length ? [`${escolha.jaEstavam.length} abas já importadas e sem alteração não entraram de novo.`] : []),
    ...(parciais.length ? [`Entraram sem alguns campos (o resto do lead foi importado): ${parciais.map(p => `${p.aba} sem ${p.faltam.join('/')}`).join('; ')}.`] : []),
  ];
  let linhas = 0;
  const corpos: unknown[] = [];
  const importadas: string[] = [];
  // ⚠️ A defesa contra planilha fora da curva é o RELÓGIO, não o teto de abas:
  // o teto baixo impedia o histórico de entrar e não protegia de uma aba única
  // gigante. 240 s deixam folga dentro do `maxDuration = 300` da rota para
  // fechar a resposta e gravar o estado.
  const prazo = Date.now() + 240_000;
  let faltouTempo = false;

  for (const [, abasDoFormato] of porFormato) {
    if (Date.now() > prazo) {
      faltouTempo = true;
      avisos.push(`Faltou tempo nesta rodada; ${abasDoFormato.join(', ')} entram na próxima.`);
      continue;
    }
    const fd = new FormData();
    const mappings: { file: string; clientId: string }[] = [];
    for (const aba of abasDoFormato) {
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
    // O de-para da IA usa `revenue`/`name`/…; a rota lê os overrides como
    // `revenueColumn`/`nameColumn`/…. `clinic` fica de fora: aqui a planilha é
    // de UM cliente só, e mandar a coluna de clínica faria a rota tentar o
    // de-para clínica→cliente que não existe neste caminho.
    // ⚠️ O de-para desta aba, com o nome EXATO das colunas daqui — a rota de
    // importação procura a coluna pelo texto, então mandar o nome de outra aba
    // faria ela não achar nada.
    const mapaDoFormato = casamentos[abasDoFormato[0]]?.mapa ?? {};
    for (const [campo, coluna] of Object.entries(mapaDoFormato)) {
      // ⚠️ `contact` é LISTA (a fileira de tentativas) e vai como CSV num campo
      // próprio; os demais são 1:1.
      if (campo === 'contact') {
        if (Array.isArray(coluna) && coluna.length) fd.append('contactColumns', coluna.join(','));
        continue;
      }
      if (typeof coluna === 'string' && coluna && campo !== 'clinic') fd.append(`${campo}Column`, coluna);
    }

    const res = await fetch(`${base}/api/integrations/spreadsheet?step=import`, {
      method: 'POST', body: fd, headers: internalHeaders(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // ⚠️ Um formato que falha NÃO derruba os outros: o relatório registra e a
      // rodada segue — perder o mês corrente porque uma aba antiga tem um
      // problema seria o pior desfecho.
      avisos.push(`As abas ${abasDoFormato.join(', ')} falharam: ${(body as { error?: string }).error ?? `HTTP ${res.status}`}.`);
      continue;
    }
    corpos.push(body);
    importadas.push(...abasDoFormato);
    const av = (body as { avisos_coluna?: string[] }).avisos_coluna;
    if (av?.length) avisos.push(...av);
  }

  const aba = abasOk.join(', ');
  const motivo = escolha.motivoAbaDoMes;
  if (!corpos.length) {
    return { ok: false, aba, motivoAba: motivo, erro: avisos[0] ?? 'Nenhum formato de aba pôde ser importado.' };
  }
  const body = corpos.length === 1 ? corpos[0] : { formatos: corpos };

  // ⚠️ Guarda o cabeçalho da aba MAIS RECENTE que importou (a lista está em ordem
  // crescente, então é a última). É o que faz o editor de colunas da tela
  // funcionar sem o gestor precisar reanalisar a planilha — a rodada diária já
  // tem o arquivo em mãos, pedir uma análise só para descobrir isso seria
  // gastar IA para responder o que acabamos de ler.
  const cabAtual = cabecalhos[abasOk[abasOk.length - 1]] ?? [];
  // ⚠️ Só as abas que REALMENTE entraram nesta rodada são marcadas — formato que
  // falhou ou ficou sem tempo continua pendente e volta na próxima.
  const memoria = { ...(cfg.abasImportadas ?? {}) };
  for (const nome of importadas) if (assinaturas[nome]) memoria[nome] = assinaturas[nome];
  // Aba que sumiu da planilha sai da memória, senão ela cresce para sempre.
  for (const nome of Object.keys(memoria)) if (!(nome in assinaturas)) delete memoria[nome];

  await pool.query(
    `UPDATE public.client_sheets
        SET ultima_sync = NOW(), ultimo_resultado = $2::jsonb, ultimo_erro = NULL,
            colunas_vistas = COALESCE($3::jsonb, colunas_vistas),
            abas_importadas = $4::jsonb, atualizado_em = NOW()
      WHERE client_id = $1`,
    [cfg.clientId, JSON.stringify({ aba, abas: abasOk, motivo, linhas, avisos, faltouTempo, ...(body as object) }),
     cabAtual.length ? JSON.stringify(cabAtual.filter(c => c.trim().length > 0)) : null,
     JSON.stringify(memoria)]
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
    colunasVistas: Array.isArray(row.colunas_vistas) ? (row.colunas_vistas as string[]) : null,
    camposManuais: Array.isArray(row.campos_manuais) ? (row.campos_manuais as string[]) : null,
    abasImportadas: row.abas_importadas && typeof row.abas_importadas === 'object' && !Array.isArray(row.abas_importadas)
      ? (row.abas_importadas as Record<string, string>) : null,
    mapeamentoPorAba: row.mapeamento_por_aba && typeof row.mapeamento_por_aba === 'object' && !Array.isArray(row.mapeamento_por_aba)
      ? (row.mapeamento_por_aba as Record<string, Mapeamento>) : null,
    seguirMes: row.seguir_mes !== false,
    tipoPlanilha: (row.tipo_planilha as SheetsConfig['tipoPlanilha']) ?? 'lead',
    fonteFaturamento: row.fonte_faturamento === true,
    ativo: row.ativo === true,
    ultimaSync: row.ultima_sync ? String(row.ultima_sync) : null,
    ultimoResultado: row.ultimo_resultado ?? null,
    ultimoErro: (row.ultimo_erro as string | null) ?? null,
  };
}
