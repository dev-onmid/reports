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
};

/**
 * Ordem das colunas — a mesma que o cenário do Make escrevia, para as fórmulas
 * e filtros que já existem na planilha continuarem valendo.
 *
 * As colunas F, G e J vinham com valor fixo lá ("SEARCH | …" e "GOOGLE"), e
 * ficam fixas aqui também. É herança, não escolha: mudar agora quebraria a
 * leitura de quem usa a planilha. Se um dia for revisado, o lugar é aqui.
 */
function montarLinha(d: LeadParaPlanilha): string[] {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return [
    quando,
    d.nome ?? '',
    d.telefone ?? '',
    d.email ?? '',
    d.utmSource ?? '',
    '',
    `SEARCH | ${d.utmMedium ?? ''}`,
    d.cpf ?? '',
    d.cidade ?? '',
    'GOOGLE',
  ];
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

    // A aba entra entre aspas simples: nomes como "FORMS | GOOGLE" têm espaço e
    // pipe, e sem as aspas o Sheets lê como intervalo inválido.
    const aba = destino.sheetTab ? `'${destino.sheetTab.replace(/'/g, "''")}'!A:J` : 'A:J';

    await sheets.spreadsheets.values.append({
      spreadsheetId: destino.sheetId,
      range: aba,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [montarLinha(dados)] },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}
