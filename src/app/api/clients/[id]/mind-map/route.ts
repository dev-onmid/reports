import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

type MindMapNode = {
  id: string;
  title: string;
  note: string;
  color: string;
  x: number;
  y: number;
  parentId: string | null;
};

type MindMapData = {
  nodes: MindMapNode[];
};

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_planning (
      client_id   TEXT PRIMARY KEY,
      tkm         NUMERIC NOT NULL DEFAULT 9000,
      cpl_meta    NUMERIC NOT NULL DEFAULT 30,
      stages      JSONB NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS simple_mode BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS inv_pla_simple NUMERIC NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS mind_map JSONB`);
}

function sanitizeMindMap(body: unknown): MindMapData {
  const nodes = body && typeof body === 'object' ? (body as Partial<MindMapData>).nodes : null;
  if (!Array.isArray(nodes)) return { nodes: [] };

  return {
    nodes: nodes.slice(0, 48).map((node, index) => {
      const item = node && typeof node === 'object' ? node as Partial<MindMapNode> : {};
      const x = Number(item.x);
      const y = Number(item.y);
      return {
        id: String(item.id || `mind-${index + 1}`).slice(0, 80),
        title: String(item.title || 'Novo tópico').slice(0, 80),
        note: String(item.note || '').slice(0, 220),
        color: String(item.color || '#55F52F').slice(0, 20),
        x: Number.isFinite(x) ? x : 120,
        y: Number.isFinite(y) ? y : 120,
        parentId: item.parentId ? String(item.parentId).slice(0, 80) : null,
      };
    }),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `SELECT mind_map AS "mindMap" FROM public.client_planning WHERE client_id = $1`,
      [id],
    );
    return Response.json(row?.mindMap ?? null);
  } finally {
    await pool.end();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = sanitizeMindMap(await req.json());
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.client_planning (client_id, mind_map, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (client_id) DO UPDATE
         SET mind_map = $2, updated_at = NOW()
       RETURNING mind_map AS "mindMap"`,
      [id, JSON.stringify(body)],
    );
    return Response.json(row.mindMap);
  } finally {
    await pool.end();
  }
}
