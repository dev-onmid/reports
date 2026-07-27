import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as {
    whatsappGroup?: string; zapiClientId?: string; active?: boolean;
    diasAntecedencia?: number; emailTo?: string | null;
  };
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.whatsappGroup !== undefined) { sets.push(`whatsapp_group = $${idx++}`); vals.push(body.whatsappGroup); }
    if (body.zapiClientId !== undefined)  { sets.push(`zapi_client_id = $${idx++}`); vals.push(body.zapiClientId); }
    if (body.active !== undefined)        { sets.push(`active = $${idx++}`);         vals.push(body.active); }
    if (body.emailTo !== undefined)       { sets.push(`email_to = $${idx++}`);       vals.push(body.emailTo?.trim() || null); }
    if (body.diasAntecedencia !== undefined) {
      sets.push(`dias_antecedencia = $${idx++}`);
      vals.push(Math.min(30, Math.max(1, Math.round(Number(body.diasAntecedencia) || 3))));
    }
    if (sets.length === 0) return Response.json({ error: 'nothing to update' }, { status: 400 });
    vals.push(id);
    await pool.query(`UPDATE public.balance_alert_configs SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    await pool.query('DELETE FROM public.balance_alert_configs WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
