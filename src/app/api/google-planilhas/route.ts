import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';

/**
 * Lista as planilhas do Google da conta conectada, e as abas de uma delas.
 *
 * Existe para o gestor não ter de abrir o Drive, achar a planilha, copiar o
 * link e voltar — ele digita o nome e escolhe. O campo de texto continua
 * aceitando link colado de propósito: planilha compartilhada de fora do Drive
 * da conta pode não aparecer na busca, e menu que não tem a opção vira parede
 * (mesma lição do seletor do SULTS — é conveniência, não gaiola).
 *
 *   GET /api/google-planilhas?q=romanza     → { planilhas: [{ id, nome, dono }] }
 *   GET /api/google-planilhas?sheetId=XYZ   → { abas: ['Página1', 'FORMS | GOOGLE'] }
 *
 * ⚠️ Listar arquivos exige escopo de DRIVE; escrever exige o de PLANILHAS. Quem
 * conectou antes desta rota existir só tem o segundo — daí o 409 com `reconectar`,
 * que a tela traduz em "reconecte a conta", em vez de um "nada encontrado" que
 * faria o gestor procurar defeito na busca.
 */

export const dynamic = 'force-dynamic';

const ESCOPO_DRIVE = 'https://www.googleapis.com/auth/drive.metadata.readonly';

type Conexao = { access_token: string; refresh_token: string; token_expiry: string | null; scope: string | null };

async function tokenFresco(c: Conexao): Promise<string> {
  if (c.token_expiry && new Date(c.token_expiry).getTime() > Date.now() + 5 * 60 * 1000) {
    return c.access_token;
  }
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: c.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token ?? c.access_token;
}

export async function GET(req: NextRequest) {
  const busca = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const sheetId = (req.nextUrl.searchParams.get('sheetId') ?? '').trim();

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<Conexao>(
      `SELECT access_token, refresh_token, token_expiry, scope
         FROM public.google_connections
        WHERE account_type = 'sheets' AND status = 'connected' AND refresh_token IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
    );
    const conn = rows[0];
    if (!conn) {
      return Response.json({ erro: 'Nenhuma conta Google de planilhas conectada.', conectar: true }, { status: 409 });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: await tokenFresco(conn) });

    // As abas saem do próprio Sheets — não precisam do escopo de Drive, então
    // funcionam mesmo para quem conectou antes desta rota existir.
    if (sheetId) {
      const sheets = google.sheets({ version: 'v4', auth });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title,sheets.properties.title' });
      return Response.json({
        titulo: meta.data.properties?.title ?? null,
        abas: (meta.data.sheets ?? []).map(s => s.properties?.title).filter((t): t is string => !!t),
      });
    }

    if (!(conn.scope ?? '').includes(ESCOPO_DRIVE)) {
      return Response.json(
        { erro: 'A conta foi conectada sem permissão para listar arquivos.', reconectar: true },
        { status: 409 },
      );
    }

    // `name contains` do Drive ignora maiúscula/minúscula; a aspa simples é
    // escapada porque o q é uma linguagem de consulta, não um parâmetro.
    const termo = busca.replace(/'/g, "\\'");
    const drive = google.drive({ version: 'v3', auth });
    const r = await drive.files.list({
      q: [
        "mimeType = 'application/vnd.google-apps.spreadsheet'",
        'trashed = false',
        termo ? `name contains '${termo}'` : '',
      ].filter(Boolean).join(' and '),
      fields: 'files(id,name,owners(emailAddress),modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 25,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return Response.json({
      planilhas: (r.data.files ?? []).map(f => ({
        id: f.id, nome: f.name, dono: f.owners?.[0]?.emailAddress ?? null,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ erro: msg }, { status: 502 });
  } finally {
    await pool.end();
  }
}
