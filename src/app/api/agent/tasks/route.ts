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
    const [tasks, runs, sendInstance, instances] = await Promise.all([
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
      pool.query(
        `SELECT id, name, instance_id FROM public.zapi_clients
          WHERE active = TRUE AND COALESCE(provider,'zapi') <> 'evolution' ORDER BY name ASC`
      ).catch(() => ({ rows: [] })),
    ]);
    return Response.json({
      tasks: tasks.rows,
      runs: runs.rows,
      sendInstance: sendInstance ? { id: sendInstance.id, name: sendInstance.name, instance_id: sendInstance.instance_id } : null,
      instances: instances.rows,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}

// Define a instância Z-API fixa por onde a Luna envia TODO WhatsApp agendado.
export async function PUT(req: NextRequest) {
  const { zapi_client_id } = await req.json().catch(() => ({})) as { zapi_client_id?: string };
  if (!zapi_client_id) return Response.json({ error: 'zapi_client_id obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query('SELECT id, name FROM public.zapi_clients WHERE id = $1 AND active = TRUE', [zapi_client_id]);
    if (rows.length === 0) return Response.json({ error: 'Instância não encontrada ou inativa' }, { status: 404 });
    await pool.query(`CREATE TABLE IF NOT EXISTS public.system_settings (
      key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
    )`).catch(() => {});
    await pool.query(
      `INSERT INTO public.system_settings (key, value, updated_by) VALUES ('luna_zapi_client_id', $1, 'ui')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = 'ui'`,
      [zapi_client_id]
    );
    return Response.json({ ok: true, instance: rows[0] });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
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
