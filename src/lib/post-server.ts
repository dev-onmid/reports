import { randomBytes } from 'crypto';
import type { Pool } from 'pg';
import type { Alvo, StatusAlvo, TipoPublicacao } from '@/lib/post-agendamento';

/**
 * Planejador de publicações — schema e acesso ao banco (SERVER ONLY).
 *
 * Três tabelas, espelhando o desenho que já se provou na Fidelidade
 * (`fidelidade_execucoes` / `fidelidade_envios`):
 *
 *  - `post_midia`    a imagem, em BYTEA, com um token que é a credencial pública
 *  - `post_agendado` a publicação (o que, quando, com que recorrência)
 *  - `post_alvo`     UMA LINHA POR CONTA POR RODADA — é ela que sustenta retry,
 *                    histórico e a resposta a "saiu em quem?"
 */

let ensured: Promise<void> | null = null;

export function ensurePostSchema(pool: Pool): Promise<void> {
  ensured ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS public.post_midia (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token TEXT NOT NULL UNIQUE,
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      bytes BYTEA NOT NULL,
      largura INT, altura INT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS public.post_agendado (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      midia_id UUID REFERENCES public.post_midia(id) ON DELETE SET NULL,
      tipo TEXT NOT NULL DEFAULT 'feed',
      legenda TEXT NOT NULL DEFAULT '',
      modo TEXT NOT NULL DEFAULT 'unico',
      proxima_execucao TIMESTAMPTZ,
      dias_semana TEXT,
      hora TEXT,
      repetir_ate DATE,
      -- A lista de clientes da série. Guardada porque cada ocorrência RE-resolve
      -- a conta na Graph: o pageToken é temporário e nunca é armazenado, e assim
      -- um cliente que trocou de conta passa a publicar na nova, não na velha.
      client_ids TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'agendado',
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS public.post_alvo (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL REFERENCES public.post_agendado(id) ON DELETE CASCADE,
      ocorrencia TIMESTAMPTZ NOT NULL,
      client_id TEXT NOT NULL,
      client_name TEXT,
      ig_id TEXT NOT NULL,
      ig_username TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      container_id TEXT,
      media_id TEXT,
      permalink TEXT,
      erro TEXT,
      tentativas INT NOT NULL DEFAULT 0,
      -- Backoff: sem isto o cron de 1 em 1 minuto marteleria a Graph com o mesmo
      -- alvo quebrado sessenta vezes por hora.
      tentar_apos TIMESTAMPTZ,
      publicado_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    // ⚠️ A trava estrutural contra publicar duas vezes na mesma conta na mesma
    // rodada. O claim atômico do motor protege contra ticks cruzados; esta
    // unique protege contra a fila ser montada duas vezes (retry de criação,
    // recorrência disparada em duplicidade). Publicação não tem desfazer, então
    // vale ter as duas defesas.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS post_alvo_unico_idx
      ON public.post_alvo (post_id, ocorrencia, ig_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS post_alvo_fila_idx
      ON public.post_alvo (status, ocorrencia)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS post_alvo_conta_idx
      ON public.post_alvo (ig_id, publicado_em DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS post_agendado_prox_idx
      ON public.post_agendado (status, proxima_execucao)`);
  })();
  return ensured;
}

// -------------------------------------------------------------------- Mídia

export type MidiaSalva = { id: string; token: string; kb: number };

const MIME_OK = /^image\/jpeg$/;
const BYTES_MAX = 4 * 1024 * 1024;

/**
 * Grava a imagem já convertida pelo navegador.
 *
 * ⚠️ Aceita SÓ `image/jpeg`: é o único formato que a Meta publica, e a conversão
 * acontece no cliente (`post-imagem.ts`). Deixar PNG entrar aqui só adiaria a
 * falha para o momento da publicação, onde ela é bem mais cara de diagnosticar.
 */
export async function salvarMidia(
  pool: Pool, dataUrl: string, largura?: number, altura?: number, createdBy?: string,
): Promise<MidiaSalva> {
  await ensurePostSchema(pool);
  // [\s\S] em vez da flag `s`: o target de compilação do projeto é anterior a es2018.
  const m = /^data:([\w/+.-]+);base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!m) throw new Error('Imagem inválida — envie o arquivo pela tela.');
  const [, mime, b64] = m;
  if (!MIME_OK.test(mime)) throw new Error('A imagem precisa ser JPEG (a conversão é feita na tela).');

  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < 1024) throw new Error('Imagem vazia ou corrompida.');
  if (bytes.length > BYTES_MAX) throw new Error('Imagem acima de 4 MB.');

  const token = randomBytes(16).toString('hex'); // 32 hex — é a credencial pública
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.post_midia (token, mime, bytes, largura, altura, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [token, mime, bytes, largura ?? null, altura ?? null, createdBy ?? null],
  );
  return { id: rows[0].id, token, kb: Math.round(bytes.length / 1024) };
}

export async function obterMidiaPorToken(
  pool: Pool, token: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  await ensurePostSchema(pool);
  const { rows } = await pool.query<{ mime: string; bytes: Buffer }>(
    `SELECT mime, bytes FROM public.post_midia WHERE token = $1`, [token],
  );
  return rows[0] ?? null;
}

export async function tokenDaMidia(pool: Pool, midiaId: string): Promise<string | null> {
  const { rows } = await pool.query<{ token: string }>(
    `SELECT token FROM public.post_midia WHERE id = $1`, [midiaId],
  );
  return rows[0]?.token ?? null;
}

/**
 * URL que a Meta vai baixar.
 *
 * ⚠️ Origem CANÔNICA obrigatória (`APP_URL`). A Meta faz cURL nesta URL a partir
 * da internet: `localhost` ou um domínio de preview fazem o container falhar com
 * um erro genérico e difícil de ligar à causa. Mesma razão do `webhookOrigin`.
 */
export function urlPublicaDaMidia(token: string, origin: string): string | null {
  const base = origin.trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) return null;
  return `${base}/api/midia/${token}`;
}

// -------------------------------------------------------------- Publicações

export type PublicacaoRow = {
  id: string; midia_id: string | null; tipo: TipoPublicacao; legenda: string;
  modo: string; proxima_execucao: string | null; dias_semana: string | null;
  hora: string | null; repetir_ate: string | null; client_ids: string[]; status: string;
  criado_por: string | null; created_at: string;
};

export type AlvoRow = {
  id: string; post_id: string; ocorrencia: string; client_id: string;
  client_name: string | null; ig_id: string; ig_username: string | null;
  status: StatusAlvo; container_id: string | null; media_id: string | null;
  permalink: string | null; erro: string | null; tentativas: number;
  tentar_apos: string | null; publicado_em: string | null;
};

export async function criarPublicacao(
  pool: Pool,
  dados: {
    midiaId: string; tipo: TipoPublicacao; legenda: string; modo: 'unico' | 'recorrente';
    proxima: Date; dias: number[]; hora: string | null; ate: string | null;
    clientIds: string[]; criadoPor?: string;
  },
  alvos: Alvo[],
): Promise<string> {
  await ensurePostSchema(pool);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.post_agendado
       (midia_id, tipo, legenda, modo, proxima_execucao, dias_semana, hora, repetir_ate, client_ids, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      dados.midiaId, dados.tipo, dados.legenda, dados.modo, dados.proxima.toISOString(),
      dados.dias.length ? dados.dias.join(',') : null, dados.hora, dados.ate,
      dados.clientIds, dados.criadoPor ?? null,
    ],
  );
  const postId = rows[0].id;
  await inserirAlvos(pool, postId, dados.proxima, alvos);
  return postId;
}

/**
 * Cria a fila de uma rodada.
 *
 * ⚠️ `client_name` e `ig_username` são gravados AQUI, congelados. Resolver o @ na
 * hora de exibir faria o histórico mentir se a conta trocasse de nome depois —
 * mesma lição de `fidelidade_envios.texto`.
 */
export async function inserirAlvos(
  pool: Pool, postId: string, ocorrencia: Date, alvos: Alvo[],
): Promise<number> {
  if (alvos.length === 0) return 0;
  const valores: unknown[] = [];
  const linhas = alvos.map((a, i) => {
    const b = i * 6; // 6 colunas por linha — errar o passo aqui embaralha os valores entre alvos
    valores.push(postId, ocorrencia.toISOString(), a.clientId, a.clientName, a.igId, a.username || null);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
  });
  const { rowCount } = await pool.query(
    `INSERT INTO public.post_alvo (post_id, ocorrencia, client_id, client_name, ig_id, ig_username)
     VALUES ${linhas.join(', ')}
     ON CONFLICT (post_id, ocorrencia, ig_id) DO NOTHING`,
    valores,
  );
  return rowCount ?? 0;
}

/** Quantas publicações a conta já recebeu por aqui nas últimas 24h (teto da Meta). */
export async function publicadasNasUltimas24h(pool: Pool, igId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) n FROM public.post_alvo
      WHERE ig_id = $1 AND status = 'publicado' AND publicado_em > NOW() - INTERVAL '24 hours'`,
    [igId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function listarPublicacoes(pool: Pool, limite = 200): Promise<
  (PublicacaoRow & { midia_token: string | null; total: number; publicados: number; erros: number; pendentes: number })[]
> {
  await ensurePostSchema(pool);
  const { rows } = await pool.query(
    `SELECT p.*, m.token AS midia_token,
            COUNT(a.id)::int AS total,
            COUNT(a.id) FILTER (WHERE a.status = 'publicado')::int AS publicados,
            COUNT(a.id) FILTER (WHERE a.status = 'erro')::int AS erros,
            COUNT(a.id) FILTER (WHERE a.status IN ('pendente','publicando'))::int AS pendentes
       FROM public.post_agendado p
       LEFT JOIN public.post_midia m ON m.id = p.midia_id
       LEFT JOIN public.post_alvo a ON a.post_id = p.id
      GROUP BY p.id, m.token
      ORDER BY COALESCE(p.proxima_execucao, p.created_at) DESC
      LIMIT $1`,
    [limite],
  );
  return rows;
}

export async function obterPublicacao(pool: Pool, id: string) {
  await ensurePostSchema(pool);
  const { rows } = await pool.query(
    `SELECT p.*, m.token AS midia_token FROM public.post_agendado p
       LEFT JOIN public.post_midia m ON m.id = p.midia_id WHERE p.id = $1`, [id],
  );
  if (!rows[0]) return null;
  const { rows: alvos } = await pool.query<AlvoRow>(
    `SELECT * FROM public.post_alvo WHERE post_id = $1 ORDER BY ocorrencia DESC, client_name ASC`, [id],
  );
  return { publicacao: rows[0], alvos };
}

/**
 * Cancela a publicação.
 *
 * ⚠️ Só os alvos AINDA PENDENTES são cancelados. O que já foi publicado fica
 * como está — não existe desfazer na API, e apagar a linha faria o histórico
 * esconder um post que está no ar.
 */
export async function cancelarPublicacao(pool: Pool, id: string): Promise<void> {
  await pool.query(`UPDATE public.post_agendado SET status = 'cancelado', proxima_execucao = NULL WHERE id = $1`, [id]);
  await pool.query(`DELETE FROM public.post_alvo WHERE post_id = $1 AND status = 'pendente'`, [id]);
}

/** Devolve um alvo com erro para a fila (retry manual). */
export async function reenfileirarAlvo(pool: Pool, alvoId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE public.post_alvo
        SET status = 'pendente', erro = NULL, tentativas = 0, container_id = NULL
      WHERE id = $1 AND status = 'erro'`,
    [alvoId],
  );
  return (rowCount ?? 0) > 0;
}
