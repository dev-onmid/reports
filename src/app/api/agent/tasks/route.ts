import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLunaTasksTable, getLunaSendInstance } from '@/lib/luna-tools';

// Gestão dos agendamentos da Luna pela UI (/agente → Agendamentos):
// GET lista tarefas + histórico + instância de envio; PATCH cancela/reativa;
// PUT define a instância de envio FIXA; DELETE apaga.

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureLunaTasksTable(pool);
    const [tasks, runs, sendInstance] = await Promise.all([
      pool.query(
        `SELECT id, titulo, instrucao, tipo, hora, dia_semana, dia_mes, whatsapp_phone,
                permitir_acoes, enabled, next_run_at, last_run_at, last_result, created_at
           FROM public.luna_tasks ORDER BY enabled DESC, next_run_at ASC LIMIT 100`
      ),
      pool.query(
        `SELECT task_id, ran_at, ok, LEFT(COALESCE(result,''), 2000) AS result
           FROM public.luna_task_runs ORDER BY ran_at DESC LIMIT 200`
      ).catch(() => ({ rows: [] })),
      getLunaSendInstance(pool),
    ]);
    return Response.json({
      tasks: tasks.rows,
      runs: runs.rows,
      sendInstance: sendInstance ? { id: sendInstance.id, name: sendInstance.name, instance_id: sendInstance.instance_id } : null,
      // ⚠️ Sem lista: o remetente é a instância oficial da ONMID, resolvida no
      // servidor (`instanciaOnmid`). Não há o que escolher.
      instances: [],
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}

// ⚠️ Trocar o remetente NÃO existe mais. Todo WhatsApp em nome da ONMID sai
// pela instância oficial, resolvida no servidor (`instanciaOnmid`). A rota
// continua aqui para responder com o motivo — apagada, um cliente antigo
// receberia 404 e pareceria bug de rota, não regra de negócio.
export async function PUT() {
  return Response.json(
    { error: 'O remetente é fixo: a instância oficial da ONMID. Não é configurável por aqui.' },
    { status: 409 },
  );
}

export async function PATCH(req: NextRequest) {
  const { id, action } = await req.json().catch(() => ({})) as { id?: string; action?: string };
  if (!id || !['cancel', 'reactivate'].includes(action ?? '')) {
    return Response.json({ error: 'id e action (cancel|reactivate) obrigatórios' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await ensureLunaTasksTable(pool);
    const { rows } = await pool.query(
      // Reativar tarefa vencida sem next_run_at futuro seria disparo imediato — empurra pro futuro no scheduler tick seguinte, aceitável.
      `UPDATE public.luna_tasks SET enabled = $1 WHERE id = $2::uuid RETURNING id, titulo, enabled`,
      [action === 'reactivate', id]
    );
    if (rows.length === 0) return Response.json({ error: 'Tarefa não encontrada' }, { status: 404 });
    return Response.json({ ok: true, task: rows[0] });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return Response.json({ error: 'id obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureLunaTasksTable(pool);
    const { rows } = await pool.query('DELETE FROM public.luna_tasks WHERE id = $1::uuid RETURNING titulo', [id]);
    if (rows.length === 0) return Response.json({ error: 'Tarefa não encontrada' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
