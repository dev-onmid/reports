import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { testarToken } from '@/lib/anotaai';

/**
 * Testa a credencial da loja contra a API do Anota AI e grava o resultado.
 *
 * ⚠️ Existe porque colar token sem retorno é colar no escuro: a loja da
 * PicoLocos estava cadastrada com um token de SESSÃO de 15 minutos, expirado
 * desde 18/06, e a tela não tinha como dizer isso — só o silêncio de zero
 * pedidos importados, que parece "a loja não vendeu".
 *
 * O token NUNCA sai daqui: só o veredito volta ao browser.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return unauthorized();
  const { id: clientId } = await params;

  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return Response.json({ error: 'storeId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [loja] } = await pool.query<{ integration_token: string }>(
      `SELECT integration_token FROM public.client_anota_ai_stores
        WHERE id = $1::uuid AND client_id = $2`,
      [storeId, clientId],
    );
    if (!loja) return Response.json({ error: 'Loja não encontrada.' }, { status: 404 });

    // Antes de gastar a chamada: se o token declara validade e ela já passou,
    // o diagnóstico é preciso e não depende da resposta da API deles.
    // Lida SEMPRE: os metadados explicam tanto o token vencido quanto o vivo
    // que a API recusa.
    const expirado = expiracaoDoJwt(loja.integration_token);
    let status: 'ok' | 'erro';
    let mensagem: string;

    // ⚠️ Token de sessão: copiar de novo NÃO resolve, e mandar copiar de novo era
    // o que esta mensagem fazia. Medido em 31/08 na PicoLocos: a chave que o
    // painel da loja oferece é emitida pela `session-api` com 15 min e a
    // api-parceiros a recusa com 401 mesmo DENTRO da validade. O que falta não
    // é uma cópia nova — é a ONMID existir como parceira do lado deles.
    const ehSessao = expirado != null
      && (expirado.emissor === 'session-api'
          || (expirado.minutosDeVida != null && expirado.minutosDeVida <= 60));

    if (ehSessao) {
      status = 'erro';
      mensagem = `Este é um token de SESSÃO do painel do Anota AI (validade de ${expirado?.minutosDeVida ?? '~15'} min`
        + `${expirado?.expirado ? `, expirado em ${expirado.emTexto}` : ', ainda válido'}) — não é credencial de parceiro. `
        + 'A API de parceiros o recusa com 401 mesmo dentro da validade, então copiar a chave de novo não resolve. '
        + 'Falta a ONMID estar cadastrada como parceira no Anota AI e a integração habilitada para esta loja '
        + '(em "Minhas integrações", no painel da loja, hoje só aparece o iFood).';
    } else if (expirado && expirado.expirado) {
      status = 'erro';
      mensagem = `Token expirado em ${expirado.emTexto}. Gere uma chave nova no Anota AI.`;
    } else {
      const r = await testarToken(loja.integration_token);
      status = r.ok ? 'ok' : 'erro';
      mensagem = r.ok
        ? `Conectado. ${r.pedidosHoje} pedido(s) na listagem de hoje.`
        : `${r.status || ''} ${r.erro}`.trim();
    }

    await pool.query(
      `UPDATE public.client_anota_ai_stores
          SET last_test_status = $2, last_test_message = $3, last_test_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid`,
      [storeId, status, mensagem.slice(0, 400)],
    );

    return Response.json({ status, mensagem });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Falha no teste.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/** Lê exp/iat do JWT sem validar assinatura — é diagnóstico, não autenticação. */
function expiracaoDoJwt(token: string): {
  expirado: boolean; emTexto: string; minutosDeVida: number | null; emissor: string | null;
} | null {
  const partes = String(token).split('.');
  if (partes.length !== 3) return null;
  try {
    const c = JSON.parse(Buffer.from(partes[1], 'base64url').toString()) as
      { exp?: number; iat?: number; iss?: string };
    if (!c.exp) return null;
    return {
      expirado: Date.now() > c.exp * 1000,
      emTexto: new Date(c.exp * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      minutosDeVida: c.iat ? Math.round((c.exp - c.iat) / 60) : null,
      emissor: c.iss ?? null,
    };
  } catch { return null; }
}
