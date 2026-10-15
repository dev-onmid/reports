import { google } from 'googleapis';
import type { Pool } from 'pg';

/**
 * Grava o lead da landing page numa planilha do Google.
 *
 * Existe para tirar o Make do caminho: até aqui quem escrevia na planilha era
 * um cenário do Make que recebia o MESMO lead que esta rota já recebe. Dois
 * sistemas ouvindo o mesmo formulário é uma peça a mais para quebrar — e
 * quebrou: rótulo de campo trocado na LP derrubou o Make em silêncio por um
 * mês, enquanto o Reports seguia gravando certo.
 *
 * Melhor esforço, como o aviso por e-mail: o lead JÁ está salvo quando isto
 * roda. Planilha fora do ar não pode virar erro para a landing page.
 */

const TIPO_CONEXAO = 'sheets';

type Conexao = {
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
};

/** O access token dura 1h; o refresh é o que fica guardado. */
async function tokenFresco(conn: Conexao): Promise<string> {
  if (conn.token_expiry) {
    const expira = new Date(conn.token_expiry).getTime();
    if (expira > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token ?? conn.access_token;
}

export type LeadParaPlanilha = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  cpf: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  campanha?: string | null;
  pageUrl?: string | null;
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "outubro 6, 2026" — o formato que as linhas antigas da planilha já usam. */
export function dataNoFormatoDaPlanilha(agora: Date): string {
  const [a, m, d] = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return `${MESES[m - 1]} ${d}, ${a}`;
}

const sem = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Valor de cada coluna a partir do NOME no cabeçalho da aba.
 *
 * ⚠️ Antes a ordem era fixa no código (10 colunas copiadas de outro cenário do
 * Make) e a aba da Romanza tem 7: Data, Nome, Telefone, Link, CPF, E-mail,
 * Cidade. Resultado: e-mail na coluna Link, "google" no CPF e, da segunda linha
 * em diante, tudo empurrado para a coluna I. Lendo o cabeçalho, a planilha manda
 * na ordem — quem reorganizar as colunas lá não quebra a gravação aqui.
 * Coluna que não reconhecemos fica vazia (nunca recebe valor de outra).
 */
export function montarLinhaPorCabecalho(cabecalho: string[], d: LeadParaPlanilha, agora = new Date()): string[] {
  const valor = (titulo: string): string => {
    const t = sem(titulo);
    if (!t) return '';
    if (/^(data|dia|quando|recebido)/.test(t)) return dataNoFormatoDaPlanilha(agora);
    if (/e-?mail/.test(t)) return d.email ?? '';
    if (/cpf/.test(t)) return d.cpf ?? '';
    if (/telefone|celular|whats|fone/.test(t)) return d.telefone ?? '';
    if (/nome/.test(t)) return d.nome ?? '';
    if (/cidade|municipio/.test(t)) return d.cidade ?? '';
    if (/link|url|pagina/.test(t)) return d.pageUrl ?? '';
    if (/campanha|utm_campaign/.test(t)) return d.campanha ?? '';
    if (/utm_medium|meio/.test(t)) return d.utmMedium ?? '';
    if (/utm_source|fonte|origem/.test(t)) return d.utmSource ?? '';
    return '';
  };
  const linha = cabecalho.map(valor);
  // Sem cabeçalho na aba: a ordem que a planilha da Romanza sempre teve.
  if (!cabecalho.some(c => sem(c))) {
    return montarLinhaPorCabecalho(['Data', 'Nome', 'Telefone', 'Link', 'CPF', 'E-mail', 'Cidade'], d, agora);
  }
  return linha;
}

/**
 * Anexa uma linha. Não lança: devolve o motivo para o chamador registrar.
 */
export async function gravarLeadNaPlanilha(
  pool: Pool,
  destino: { sheetId: string | null; sheetTab: string | null },
  dados: LeadParaPlanilha,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (!destino.sheetId) return { ok: false, motivo: 'origem sem planilha configurada' };

  const { rows } = await pool.query<Conexao>(
    `SELECT access_token, refresh_token, token_expiry
       FROM public.google_connections
      WHERE account_type = $1 AND status = 'connected' AND refresh_token IS NOT NULL
      -- ⚠️ A coluna é connected_at. Não existe created_at nem updated_at aqui,
      -- e as outras 11 consultas a esta tabela sempre usaram connected_at.
      ORDER BY connected_at DESC NULLS LAST
      LIMIT 1`,
    [TIPO_CONEXAO],
  );
  const conn = rows[0];
  if (!conn) return { ok: false, motivo: 'nenhuma conta Google conectada para planilhas' };

  try {
    const accessToken = await tokenFresco(conn);
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth });

    // Aba pelo nome; sem nome configurado, a primeira da planilha.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: destino.sheetId, fields: 'sheets.properties(sheetId,title)' });
    const abas = meta.data.sheets ?? [];
    const aba = destino.sheetTab ? abas.find(a => a.properties?.title === destino.sheetTab) : abas[0];
    if (!aba?.properties || aba.properties.sheetId == null) {
      return { ok: false, motivo: `aba "${destino.sheetTab ?? '(primeira)'}" não encontrada na planilha` };
    }
    const titulo = aba.properties.title ?? '';
    const cab = await sheets.spreadsheets.values.get({
      spreadsheetId: destino.sheetId,
      range: `'${titulo.replace(/'/g, "''")}'!1:1`,
    });
    const linha = montarLinhaPorCabecalho((cab.data.values?.[0] ?? []).map(String), dados);

    // ⚠️ appendCells, NÃO values.append: o append "procura a tabela" e, com uma
    // linha mais larga que o cabeçalho, passou a escrever a partir da coluna I.
    // appendCells grava sempre na primeira linha vazia depois da última com
    // dado, começando na coluna A — e é atômico, dois leads juntos não colidem.
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: destino.sheetId,
      requestBody: { requests: [{ appendCells: {
        sheetId: aba.properties.sheetId,
        fields: 'userEnteredValue',
        rows: [{ values: linha.map(v => ({ userEnteredValue: { stringValue: v } })) }],
      } }] },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}
