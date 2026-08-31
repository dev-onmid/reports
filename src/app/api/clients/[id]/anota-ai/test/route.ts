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

    // ⚠️ Há DOIS tokens no painel do Anota AI e só um funciona.
    //
    // O do topo ("Chave de integração com a Anota AI") é emitido pela
    // `session-api` com 15 min de validade — medido em 31/08 na PicoLocos, a
    // api-parceiros o recusa com 401 mesmo DENTRO da validade. Foi o que
    // estava cadastrado desde junho, e é o que qualquer um copia primeiro,
    // porque é o campo em destaque na tela.
    //
    // O que vale é o token da LINHA da integração, em "Minhas integrações" →
    // aba **Outras** → "Onmid Reports" — uma aba que nem é a aberta por padrão
    // (a padrão é iFood), então a linha passa despercebida com facilidade.
    // ⚠️ O sinal exato é `idpartner`, não a validade nem o emissor.
    //
    // Comparado em 31/08 nas DUAS lojas da PicoLocos: o token que funciona
    // (Guanabara) traz `idpartner + idpage` e não expira; o que falha (Prochet)
    // traz `_id + tokenid + exp + iss:session-api` e NÃO traz `idpartner`.
    // Os dois carregam o `idpage` correto da própria loja — conferir a loja não
    // distingue nada. Quem separa é a presença do parceiro dentro do token.
    const claims = claimsDoJwt(loja.integration_token);
    const semParceiro = claims !== null && !claims.idpartner;

    if (semParceiro) {
      status = 'erro';
      mensagem = `Token errado: este é o de SESSÃO do topo da tela (validade de ${expirado?.minutosDeVida ?? '~15'} min`
        + `${expirado?.expirado ? `, expirado em ${expirado.emTexto}` : ', ainda válido'}), que a API recusa com 401 `
        + 'mesmo dentro da validade — recopiá-lo não resolve. No painel DESTA loja, vá em Configurações › '
        + 'Integrações › Minhas integrações › aba "Outras" e copie o token da LINHA "Onmid Reports". '
        + 'É um token por loja, e não expira. Se a linha não existir para esta loja, habilite a integração '
        + 'pelo botão "Integrar" antes.';
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

/** Claims do JWT, sem validar assinatura — diagnóstico, não autenticação. */
function claimsDoJwt(token: string): { idpartner?: string; idpage?: string } | null {
  const partes = String(token).split('.');
  if (partes.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString()) as { idpartner?: string };
  } catch { return null; }
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
