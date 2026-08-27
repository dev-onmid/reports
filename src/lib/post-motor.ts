import type { Pool } from 'pg';
import { getFreshMetaToken } from '@/lib/meta-token';
import { resolverContasIg } from '@/lib/instagram-monitor';
import { proximaOcorrencia, TETO_META_24H, type Agendamento, type Alvo } from '@/lib/post-agendamento';
import {
  ensurePostSchema, inserirAlvos, publicadasNasUltimas24h, tokenDaMidia, urlPublicaDaMidia,
  type AlvoRow, type PublicacaoRow,
} from '@/lib/post-server';

/**
 * Motor de publicação — a lógica, sem a casca HTTP.
 *
 * Mora numa lib porque tem DOIS chamadores: o cron (`/api/publicacoes/worker`) e
 * o botão "publicar agora" da tela. É a mesma razão pela qual `fidelidade-motor`
 * existe: travas que divergem entre o automático e o manual são exatamente o
 * tipo de bug que ninguém encontra até doer.
 *
 * ⚠️ PUBLICAÇÃO É IRREVERSÍVEL. A Meta não tem endpoint de desfazer. Por isso o
 * caminho todo é defensivo: claim atômico antes de qualquer chamada, unique no
 * banco, e nenhum retry cego.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_TENTATIVAS = 3;
/** Quanto tempo esperar o container ficar pronto DENTRO de um tick. */
const POLL_MS = 18_000;
const POLL_INTERVALO = 2_500;

export type ResultadoAlvo = {
  alvo: string; conta: string; ok: boolean;
  mediaId?: string; pulou?: string; erro?: string;
};

// -------------------------------------------------------------- Materialização

/**
 * Garante que a fila da ocorrência devida existe e agenda a próxima.
 *
 * Roda antes de publicar, a cada tick. É idempotente: a unique
 * `(post_id, ocorrencia, ig_id)` absorve qualquer repetição — e é por isso que
 * materializar duas vezes não gera post duplicado.
 */
export async function materializarDevidas(pool: Pool, agora: Date): Promise<number> {
  await ensurePostSchema(pool);
  const { rows: devidas } = await pool.query<PublicacaoRow>(
    `SELECT * FROM public.post_agendado
      WHERE status = 'agendado' AND proxima_execucao IS NOT NULL AND proxima_execucao <= NOW()
      ORDER BY proxima_execucao ASC LIMIT 20`,
  );
  let criados = 0;

  for (const pub of devidas) {
    const ocorrencia = new Date(pub.proxima_execucao!);

    if (pub.client_ids?.length) {
      // RE-resolve a conta a cada rodada: o pageToken é temporário e o cliente
      // pode ter trocado de conta desde que a série foi criada.
      const contas = await resolverContasIg(pool, pub.client_ids, getFreshMetaToken);
      const alvos: Alvo[] = [];
      for (const clientId of pub.client_ids) {
        const c = contas.get(clientId);
        if (c?.igId) {
          alvos.push({ clientId, clientName: '', igId: c.igId, username: c.username ?? '' });
        }
      }
      criados += await inserirAlvos(pool, pub.id, ocorrencia, alvos);
    }

    // Agenda a próxima ocorrência (ou encerra a série).
    const ag: Agendamento = pub.modo === 'recorrente'
      ? {
          modo: 'recorrente',
          dias: (pub.dias_semana ?? '').split(',').map(Number).filter(Number.isInteger),
          hora: pub.hora ?? '09:00',
          ate: pub.repetir_ate ? String(pub.repetir_ate).slice(0, 10) : null,
        }
      : { modo: 'unico', quando: ocorrencia.toISOString() };

    const proxima = pub.modo === 'recorrente'
      // A partir de 1 min depois da ocorrência atual, senão `proximaOcorrencia`
      // devolveria a MESMA data e a publicação ficaria presa no mesmo dia.
      ? proximaOcorrencia(ag, new Date(ocorrencia.getTime() + 60_000))
      : null;

    await pool.query(
      proxima
        ? `UPDATE public.post_agendado SET proxima_execucao = $2 WHERE id = $1`
        : `UPDATE public.post_agendado SET proxima_execucao = NULL, status = 'concluido' WHERE id = $1`,
      proxima ? [pub.id, proxima.toISOString()] : [pub.id],
    );
  }
  return criados;
}

// ------------------------------------------------------------------ Publicação

async function graph(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  return await res.json() as Record<string, unknown>;
}

function erroDaGraph(j: Record<string, unknown>): string | null {
  const e = j?.error as { message?: string; error_user_msg?: string } | undefined;
  if (!e) return null;
  return e.error_user_msg ?? e.message ?? 'erro desconhecido da Meta';
}

async function falhar(pool: Pool, alvo: AlvoRow, msg: string): Promise<ResultadoAlvo> {
  const tentativas = alvo.tentativas + 1;
  const desiste = tentativas >= MAX_TENTATIVAS;
  await pool.query(
    `UPDATE public.post_alvo
        SET status = $2, erro = $3, tentativas = $4,
            tentar_apos = CASE WHEN $2 = 'pendente' THEN NOW() + ($5 || ' minutes')::interval END
      WHERE id = $1`,
    [alvo.id, desiste ? 'erro' : 'pendente', msg.slice(0, 500), tentativas, String(tentativas * 5)],
  );
  return { alvo: alvo.id, conta: alvo.ig_username ?? alvo.ig_id, ok: false, erro: msg };
}

/**
 * Publica UM alvo. O claim atômico acontece aqui dentro, antes de qualquer
 * chamada à Meta — se outro tick já pegou este alvo, esta chamada não faz nada.
 */
export async function publicarAlvo(
  pool: Pool, alvo: AlvoRow, pub: PublicacaoRow, origin: string,
): Promise<ResultadoAlvo | null> {
  const claim = await pool.query(
    `UPDATE public.post_alvo SET status = 'publicando'
      WHERE id = $1 AND status = 'pendente' RETURNING id`,
    [alvo.id],
  );
  if (claim.rowCount === 0) return null; // outro tick levou — nunca publicar duas vezes

  const conta = alvo.ig_username ?? alvo.ig_id;

  // Teto da Meta. Estourar devolve erro genérico e queima a tentativa à toa.
  const jaHoje = await publicadasNasUltimas24h(pool, alvo.ig_id);
  if (jaHoje >= TETO_META_24H) {
    await pool.query(
      `UPDATE public.post_alvo SET status = 'pendente', tentar_apos = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [alvo.id],
    );
    return { alvo: alvo.id, conta, ok: false, pulou: 'teto_24h', erro: `conta já recebeu ${jaHoje} publicações em 24h` };
  }

  if (!pub.midia_id) return falhar(pool, alvo, 'publicação sem imagem');
  const token = await tokenDaMidia(pool, pub.midia_id);
  if (!token) return falhar(pool, alvo, 'imagem não encontrada');
  const imageUrl = urlPublicaDaMidia(token, origin);
  if (!imageUrl) {
    return falhar(pool, alvo, 'APP_URL não é uma URL pública https — a Meta não conseguiria baixar a imagem');
  }

  // Token da PÁGINA dona da conta — é a credencial que a publicação exige.
  const contas = await resolverContasIg(pool, [alvo.client_id], getFreshMetaToken);
  const resolvida = contas.get(alvo.client_id);
  if (!resolvida?.pageToken) return falhar(pool, alvo, 'não consegui resolver a conta do Instagram deste cliente');
  if (resolvida.igId !== alvo.ig_id) {
    // ⚠️ Recusa de propósito: a conta mudou entre o agendamento e a publicação.
    // Publicar na conta nova sem ninguém saber seria pior que não publicar.
    return falhar(pool, alvo, `a conta mudou desde o agendamento (@${resolvida.username}) — recrie a publicação`);
  }
  const pageToken = resolvida.pageToken;

  // 1) Container (reaproveita o de um tick anterior que não chegou a publicar).
  let containerId = alvo.container_id;
  if (!containerId) {
    const body = new URLSearchParams({ image_url: imageUrl, access_token: pageToken });
    // Story não aceita `caption` — mandar o campo faz a Meta recusar.
    if (pub.tipo === 'story') body.set('media_type', 'STORIES');
    else if (pub.legenda.trim()) body.set('caption', pub.legenda);

    const criado = await graph(`${GRAPH}/${alvo.ig_id}/media`, { method: 'POST', body });
    const erro = erroDaGraph(criado);
    if (erro || !criado.id) return falhar(pool, alvo, erro ?? 'a Meta não devolveu o container');
    containerId = String(criado.id);
    await pool.query(`UPDATE public.post_alvo SET container_id = $2 WHERE id = $1`, [alvo.id, containerId]);
  }

  // 2) Esperar ficar pronto (a Meta baixa a imagem nesta etapa).
  const limite = Date.now() + POLL_MS;
  let pronto = false;
  while (Date.now() < limite) {
    const st = await graph(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${pageToken}`);
    const code = String(st.status_code ?? '');
    if (code === 'FINISHED') { pronto = true; break; }
    if (code === 'ERROR' || code === 'EXPIRED') {
      await pool.query(`UPDATE public.post_alvo SET container_id = NULL WHERE id = $1`, [alvo.id]);
      return falhar(pool, alvo, `a Meta recusou a imagem (${code}): ${String(st.status ?? '')}`.slice(0, 400));
    }
    await new Promise(r => setTimeout(r, POLL_INTERVALO));
  }
  if (!pronto) {
    // Não é falha: devolve à fila COM o container guardado, e o próximo tick
    // continua de onde parou em vez de recriar tudo.
    await pool.query(
      `UPDATE public.post_alvo SET status = 'pendente', tentar_apos = NOW() + INTERVAL '1 minute' WHERE id = $1`,
      [alvo.id],
    );
    return { alvo: alvo.id, conta, ok: false, pulou: 'processando', erro: 'container ainda processando' };
  }

  // 3) Publicar.
  const publicado = await graph(`${GRAPH}/${alvo.ig_id}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: containerId, access_token: pageToken }),
  });
  const erroPub = erroDaGraph(publicado);
  if (erroPub || !publicado.id) return falhar(pool, alvo, erroPub ?? 'a Meta não confirmou a publicação');

  const mediaId = String(publicado.id);
  let permalink: string | null = null;
  try {
    const p = await graph(`${GRAPH}/${mediaId}?fields=permalink&access_token=${pageToken}`);
    permalink = typeof p.permalink === 'string' ? p.permalink : null;
  } catch { /* link é conveniência — não falhar a publicação por causa dele */ }

  await pool.query(
    `UPDATE public.post_alvo
        SET status = 'publicado', media_id = $2, permalink = $3, erro = NULL, publicado_em = NOW()
      WHERE id = $1`,
    [alvo.id, mediaId, permalink],
  );
  return { alvo: alvo.id, conta, ok: true, mediaId };
}

// ------------------------------------------------------------------- Fila

/**
 * Um tick completo: materializa o que venceu e publica o que está na fila.
 *
 * `origin` é a URL canônica do app (APP_URL) — é dela que a Meta baixa a imagem.
 */
export async function processarFila(
  pool: Pool, origin: string, opcoes: { limite?: number; budgetMs?: number; postId?: string } = {},
): Promise<{ materializados: number; resultados: ResultadoAlvo[] }> {
  const inicio = Date.now();
  const budget = opcoes.budgetMs ?? 45_000;
  const materializados = opcoes.postId ? 0 : await materializarDevidas(pool, new Date());

  const { rows: alvos } = await pool.query<AlvoRow & { pub: PublicacaoRow }>(
    `SELECT a.*, to_jsonb(p.*) AS pub
       FROM public.post_alvo a
       JOIN public.post_agendado p ON p.id = a.post_id
      WHERE a.status = 'pendente'
        AND a.ocorrencia <= NOW()
        AND (a.tentar_apos IS NULL OR a.tentar_apos <= NOW())
        AND p.status <> 'cancelado'
        ${opcoes.postId ? 'AND a.post_id = $2' : ''}
      ORDER BY a.ocorrencia ASC
      LIMIT $1`,
    opcoes.postId ? [opcoes.limite ?? 25, opcoes.postId] : [opcoes.limite ?? 25],
  );

  const resultados: ResultadoAlvo[] = [];
  for (const linha of alvos) {
    if (Date.now() - inicio > budget) break;
    try {
      const r = await publicarAlvo(pool, linha, linha.pub, origin);
      if (r) resultados.push(r);
    } catch (err) {
      // Um alvo que explode não pode derrubar os outros da mesma rodada.
      console.error('[publicacoes]', linha.id, err);
      resultados.push(await falhar(pool, linha, String(err).slice(0, 300)));
    }
  }
  return { materializados, resultados };
}
