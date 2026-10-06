import type { NextRequest } from 'next/server';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeServerPool } from '@/lib/server-db';
import { readSession } from '@/lib/session';
import { ROTINAS, avaliarRotina, lerConexoes, PESO_ESTADO, type RotinaStatus } from '@/lib/rotinas-saude';

// Painel de saúde das rotinas (Configurações → Rotinas). Só Administrador.
//
// ⚠️ Não é só o proxy que protege esta rota: ela devolve o corpo bruto das
// respostas dos crons, que pode conter nome de cliente e mensagem de erro de
// integração. A checagem de papel é feita aqui, no servidor.

export const maxDuration = 30;

/**
 * Diretório com os arquivos de saída dos crons, montado read-only pelo compose.
 * Fora dele a rota degrada para "sem leitura" em vez de quebrar — o painel
 * continua útil pelo rastro no banco.
 */
const DIR_STATUS = process.env.CRON_STATUS_DIR ?? '/app/cron-status';

/** Lê um `.last`: quando terminou e o que a rota respondeu. Nunca lança. */
async function lerArquivo(nome: string): Promise<{ execucaoEm: Date | null; corpo: string | null }> {
  const caminho = join(DIR_STATUS, nome);
  try {
    const st = await stat(caminho);
    // ⚠️ Teto de leitura: um cron que despeje stack trace não pode estourar a
    // memória da rota. O que interessa está nas primeiras linhas.
    const buf = await readFile(caminho);
    return { execucaoEm: st.mtime, corpo: buf.subarray(0, 8192).toString('utf8') };
  } catch {
    return { execucaoEm: null, corpo: null };
  }
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const uid = readSession(req)?.uid ?? req.headers.get('x-onmid-user-id');
    if (!uid) return Response.json({ error: 'Não autenticado.' }, { status: 401 });
    const { rows: [user] } = await pool.query<{ role: string }>(
      `SELECT role FROM public.users WHERE id = $1`, [uid],
    );
    if (user?.role !== 'Administrador') {
      return Response.json({ error: 'Só administradores veem este painel.' }, { status: 403 });
    }

    const agora = new Date();

    // Os três blocos em paralelo: arquivos do cron, rastro no banco, conexões.
    const [arquivos, rastros, conexoes] = await Promise.all([
      Promise.all(ROTINAS.map((r) => lerArquivo(r.arquivo))),
      Promise.all(
        ROTINAS.map(async (r) => {
          if (!r.rastro) return null;
          // Cada rastro falha sozinho: tabela que ainda não existe numa
          // instalação nova não pode derrubar o painel inteiro.
          const res = await pool.query<{ t: Date | null }>(r.rastro.sql).catch(() => null);
          return res?.rows[0]?.t ?? null;
        }),
      ),
      lerConexoes(pool),
    ]);

    const rotinas: RotinaStatus[] = ROTINAS.map((def, i) =>
      avaliarRotina(def, { ...arquivos[i], rastroEm: rastros[i] }, agora),
    ).sort((a, b) => PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] || a.nome.localeCompare(b.nome, 'pt-BR'));

    const problemas = rotinas.filter((r) => r.estado === 'parado' || r.estado === 'erro').length;
    const atencao = rotinas.filter((r) => r.estado === 'atencao').length;
    // "Sem leitura" em TODAS as rotinas significa que o diretório não está
    // montado — a tela precisa dizer isso, senão parece que tudo parou.
    const semLeitura = rotinas.every((r) => r.ultimaExecucao === null);

    return Response.json({
      agora: agora.toISOString(),
      rotinas,
      conexoes,
      resumo: {
        total: rotinas.length,
        problemas,
        atencao,
        conexoesComProblema: conexoes.filter((c) => c.estado !== 'ok').length,
      },
      leituraIndisponivel: semLeitura,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Falha ao ler as rotinas.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
