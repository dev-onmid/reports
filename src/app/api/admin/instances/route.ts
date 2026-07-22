import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getEvolutionQrCode, getEvolutionState, deleteEvolutionInstance } from '@/lib/evolution-api';

// Central de instâncias (Configurações → Instâncias, só ADM):
// GET lista TODAS as instâncias da VPS Evolution + vínculos do banco;
// POST {instanceName, action: 'connect'|'status'} pro modal de QR;
// PATCH {instanceName, action: 'activate'|'deactivate'} liga/desliga no banco
//   (desativada = app ignora e o alerta de desconexão silencia);
// DELETE ?name= apaga da VPS e desativa os registros no banco.

type EvoInstance = {
  name: string;
  connectionStatus: string;
  profileName?: string | null;
  ownerJid?: string | null;
};

async function fetchAllInstances(): Promise<EvoInstance[]> {
  const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY ?? '';
  const res = await fetch(`${base}/instance/fetchInstances`, {
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Evolution API ${res.status}`);
  return await res.json() as EvoInstance[];
}

export async function GET() {
  const pool = makeServerPool();
  try {
    const [instances, zapiRows, crmRows] = await Promise.all([
      fetchAllInstances(),
      pool.query<{ id: string; name: string; instance_id: string; active: boolean; linked_client_name: string | null }>(
        `SELECT z.id, z.name, z.instance_id, z.active, c.name AS linked_client_name
           FROM public.zapi_clients z
           LEFT JOIN public.clients c ON c.id = z.linked_client_id
          WHERE COALESCE(z.provider, 'zapi') = 'evolution'`
      ).catch(() => ({ rows: [] as never[] })),
      pool.query<{ id: string; nome: string; instance_id: string; ativo: boolean; client_name: string | null }>(
        `SELECT i.id, i.nome, i.instance_id, i.ativo, c.name AS client_name
           FROM public.client_zapi_instances i
           LEFT JOIN public.clients c ON c.id = i.client_id
          WHERE i.provider = 'evolution'`
      ).catch(() => ({ rows: [] as never[] })),
    ]);

    const zapiByInstance = new Map(zapiRows.rows.map(r => [r.instance_id, r]));
    const crmByInstance = new Map<string, typeof crmRows.rows>();
    for (const r of crmRows.rows) {
      const arr = crmByInstance.get(r.instance_id) ?? [];
      arr.push(r);
      crmByInstance.set(r.instance_id, arr);
    }

    const result = instances.map(inst => {
      const zapi = zapiByInstance.get(inst.name);
      const crm = crmByInstance.get(inst.name) ?? [];
      const vinculos: string[] = [];
      if (zapi) vinculos.push(zapi.linked_client_name ? `Disparos · ${zapi.linked_client_name}` : 'Disparos');
      for (const c of crm) vinculos.push(`CRM · ${c.client_name ?? c.nome}`);
      // Ativa = pelo menos um registro ativo; sem registro nenhum = órfã (VPS only)
      const hasRows = Boolean(zapi) || crm.length > 0;
      const active = hasRows ? (zapi?.active === true || crm.some(c => c.ativo)) : null;
      return {
        name: inst.name,
        status: inst.connectionStatus,
        profileName: inst.profileName ?? null,
        phone: inst.ownerJid ? inst.ownerJid.replace('@s.whatsapp.net', '').replace('@c.us', '') : null,
        vinculos,
        active,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({ ok: true, instances: result });
  } catch (err) {
    return Response.json({ ok: false, error: String(err), instances: [] }, { status: 502 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const { instanceName, action } = await req.json().catch(() => ({})) as { instanceName?: string; action?: string };
  if (!instanceName) return Response.json({ error: 'instanceName obrigatório' }, { status: 400 });
  try {
    if (action === 'status') {
      const state = await getEvolutionState(instanceName);
      return Response.json({ ok: true, state: state.state });
    }
    // default: connect (QR)
    const qr = await getEvolutionQrCode(instanceName);
    return Response.json({ ok: true, ...qr });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const { instanceName, action } = await req.json().catch(() => ({})) as { instanceName?: string; action?: string };
  if (!instanceName || !['activate', 'deactivate'].includes(action ?? '')) {
    return Response.json({ error: 'instanceName e action (activate|deactivate) obrigatórios' }, { status: 400 });
  }
  const active = action === 'activate';
  const pool = makeServerPool();
  try {
    const [z, c] = await Promise.all([
      pool.query(`UPDATE public.zapi_clients SET active = $1 WHERE instance_id = $2`, [active, instanceName]).catch(() => ({ rowCount: 0 })),
      pool.query(`UPDATE public.client_zapi_instances SET ativo = $1 WHERE instance_id = $2`, [active, instanceName]).catch(() => ({ rowCount: 0 })),
    ]);
    const touched = (z.rowCount ?? 0) + (c.rowCount ?? 0);
    if (touched === 0) {
      return Response.json({ ok: false, error: 'Instância sem registro no banco (órfã na VPS) — não há o que ativar/desativar. Use Excluir se ela não serve mais.' }, { status: 404 });
    }
    return Response.json({ ok: true, updated: touched, active });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') ?? '';
  if (!name) return Response.json({ error: 'name obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await deleteEvolutionInstance(name);
    // Registros do banco ficam, mas desativados — histórico de conversa preservado.
    await pool.query(`UPDATE public.zapi_clients SET active = FALSE WHERE instance_id = $1`, [name]).catch(() => {});
    await pool.query(`UPDATE public.client_zapi_instances SET ativo = FALSE WHERE instance_id = $1`, [name]).catch(() => {});
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
