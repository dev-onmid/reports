import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  loadSocialAlertConfig, saveSocialAlertConfig, sendSocialMonitorAlert,
} from '@/lib/social-monitor-alert';

export const dynamic = 'force-dynamic';

// GET — config atual + instâncias Z-API disponíveis para o seletor da UI.
export async function GET() {
  const pool = makeServerPool();
  try {
    const config = await loadSocialAlertConfig(pool);
    // provider='evolution' fica de fora: o aviso usa o caminho Z-API (sendText).
    // COALESCE cobre linhas antigas criadas antes da coluna provider existir.
    let instances: Array<{ id: string; name: string }> = [];
    try {
      const { rows } = await pool.query(
        `SELECT id, name FROM public.zapi_clients
          WHERE active = TRUE AND COALESCE(provider, 'zapi') <> 'evolution'
          ORDER BY name`,
      );
      instances = rows as Array<{ id: string; name: string }>;
    } catch {
      const { rows } = await pool.query(
        `SELECT id, name FROM public.zapi_clients WHERE active = TRUE ORDER BY name`,
      );
      instances = rows as Array<{ id: string; name: string }>;
    }
    return Response.json({ config, instances });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro ao carregar config' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

// POST — salva a config; com { action: 'test' } também dispara o aviso na hora
// (force: envia mesmo desativado/sem ofensores, pra validar instância+grupo).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    action?: string;
    ativo?: boolean;
    zapiClientId?: string | null;
    groupId?: string | null;
    groupName?: string | null;
  } | null;
  if (!body) return Response.json({ error: 'Body inválido' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const userId = req.headers.get('x-onmid-user-id') ?? undefined;
    await saveSocialAlertConfig(pool, {
      ativo: body.ativo === true,
      zapiClientId: body.zapiClientId?.trim() || null,
      groupId: body.groupId?.trim() || null,
      groupName: body.groupName?.trim() || null,
    }, userId);

    if (body.action === 'test') {
      const result = await sendSocialMonitorAlert(pool, { force: true });
      return Response.json({ ok: true, test: result });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro ao salvar config' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
