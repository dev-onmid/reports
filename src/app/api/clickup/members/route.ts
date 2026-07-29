import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { ClickupError, getClickupConnection, getClickupMembers, type ClickupMember } from '@/lib/clickup';
import { normalizeClientName, similarity } from '@/lib/reuniao-intake';

/**
 * Ponte usuário do ONMID ↔ membro do ClickUp.
 *
 * O `assignees` de uma tarefa só aceita o ID numérico do ClickUp, que não existe
 * em `public.users`. O casamento é sugerido pelo NOME: o e-mail não serve, porque
 * boa parte da equipe usa Gmail pessoal no ClickUp e e-mail corporativo no ONMID
 * (a Letícia Ribeiro é `onmid.atendimento@gmail.com` lá e outro endereço aqui).
 *
 * A sugestão nunca é aplicada sozinha — o POST só grava o que o humano
 * confirmou. E quando dois membros empatam (ONMID tem "Letícia", o ClickUp tem
 * "Leticia Ribeiro" e "Leticia Batan") a rota devolve os candidatos e NÃO
 * escolhe: é a mesma disciplina que impede o cliente errado de virar tarefa.
 */

type UserRow = { id: string; name: string; email: string | null; setor: string | null; clickup_id: string | null };

/** "de/da/do" não distinguem ninguém e atrapalham a contagem de tokens. */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del']);

function tokensNome(s: string): string[] {
  return normalizeClientName(s).split(' ').filter((t) => t && !PARTICULAS.has(t));
}

/**
 * Peso maior na sobreposição de tokens do que na semelhança bruta da string:
 * "Thiago" precisa casar com "Weverton Thiago Oliveira Filho", e comparar as
 * duas strings inteiras daria quase zero.
 */
function scoreNome(a: string, b: string): number {
  const ta = tokensNome(a), tb = tokensNome(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length / Math.min(ta.length, tb.length);
  return overlap * 0.8 + similarity(normalizeClientName(a), normalizeClientName(b)) * 0.2;
}

/** Só sugere com vencedor claro: bom o bastante E destacado do segundo colocado. */
function sugerir(nome: string, membros: ClickupMember[]) {
  const ranking = membros
    .map((m) => ({ membro: m, score: Number(scoreNome(nome, m.username || m.email).toFixed(3)) }))
    .sort((x, y) => y.score - x.score);
  const [primeiro, segundo] = ranking;
  const claro = primeiro && primeiro.score >= 0.6 && primeiro.score - (segundo?.score ?? 0) >= 0.1;
  return {
    sugestao: claro ? primeiro.membro : null,
    candidatos: claro ? [] : ranking.filter((r) => r.score >= 0.4).slice(0, 3),
  };
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const conn = await getClickupConnection(pool);
    if (!conn) return Response.json({ error: 'ClickUp não conectado' }, { status: 400 });

    await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS setor TEXT').catch(() => {});
    await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS clickup_id TEXT').catch(() => {});

    const [membros, { rows: usuarios }] = await Promise.all([
      getClickupMembers(conn.api_token, conn.workspace_id ?? undefined),
      pool.query<UserRow>(
        `SELECT id, name, email, setor, clickup_id FROM public.users
          WHERE COALESCE(status, 'Ativo') = 'Ativo' ORDER BY name ASC`,
      ),
    ]);

    const vinculados = new Set(usuarios.map((u) => u.clickup_id).filter(Boolean));

    return Response.json({
      membros,
      usuarios: usuarios.map((u) => {
        // Sugestão só faz sentido enquanto não há vínculo; em cima de escolha
        // manual do humano seria ruído.
        const { sugestao, candidatos } = u.clickup_id
          ? { sugestao: null, candidatos: [] }
          : sugerir(u.name, membros);
        return { id: u.id, name: u.name, email: u.email, setor: u.setor, clickup_id: u.clickup_id, sugestao, candidatos };
      }),
      // Membros do ClickUp que ninguém no ONMID reivindicou ainda.
      nao_vinculados: membros.filter((m) => !vinculados.has(String(m.id))),
    });
  } catch (err) {
    const message = err instanceof ClickupError ? err.message : 'Falha ao ler membros do ClickUp';
    console.error('[clickup members GET]', err);
    return Response.json({ error: message }, { status: err instanceof ClickupError ? err.status : 500 });
  } finally {
    await pool.end();
  }
}

/** Grava o vínculo confirmado. Aceita um item ou um lote (o botão "aplicar sugestões"). */
export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as {
      user_id?: string; clickup_id?: string | null; setor?: string | null;
      vinculos?: { user_id: string; clickup_id?: string | null; setor?: string | null }[];
    };
    const itens = Array.isArray(body.vinculos) ? body.vinculos : [body];
    const validos = itens.filter((i): i is { user_id: string; clickup_id?: string | null; setor?: string | null } =>
      typeof i?.user_id === 'string' && i.user_id.trim().length > 0);
    if (!validos.length) return Response.json({ error: 'user_id obrigatório' }, { status: 400 });

    await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS setor TEXT').catch(() => {});
    await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS clickup_id TEXT').catch(() => {});

    for (const item of validos) {
      const clickupId = typeof item.clickup_id === 'string' && item.clickup_id.trim() ? item.clickup_id.trim() : null;
      const setor = item.setor === 'trafego' || item.setor === 'social' ? item.setor : null;
      // Chave ausente = não mexer; presente com null = limpar.
      await pool.query(
        `UPDATE public.users SET
           clickup_id = CASE WHEN $2::boolean THEN $3 ELSE clickup_id END,
           setor      = CASE WHEN $4::boolean THEN $5 ELSE setor END
         WHERE id = $1`,
        [item.user_id, 'clickup_id' in item, clickupId, 'setor' in item, setor],
      );
    }
    return Response.json({ ok: true, atualizados: validos.length });
  } catch (err) {
    console.error('[clickup members POST]', err);
    return Response.json({ error: 'Falha ao salvar vínculo' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
