import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query('SELECT * FROM public.user_permissions');
    const map: Record<string, Record<string, boolean>> = {};
    for (const r of rows) {
      map[r.user_id] = {
        dashboard: r.dashboard, clientes: r.clientes,
        relatorios: r.relatorios, configuracoes: r.configuracoes, integracoes: r.integracoes,
      };
    }
    return Response.json(map);
  } catch {
    return Response.json({}, { status: 200 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { userId: string; dashboard: boolean; clientes: boolean; relatorios: boolean; configuracoes: boolean; integracoes: boolean };
  const pool = makeServerPool();
  try {
    await pool.query(
      `INSERT INTO public.user_permissions (user_id, dashboard, clientes, relatorios, configuracoes, integracoes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET dashboard=$2, clientes=$3, relatorios=$4, configuracoes=$5, integracoes=$6`,
      [body.userId, body.dashboard, body.clientes, body.relatorios, body.configuracoes, body.integracoes]
    );
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
