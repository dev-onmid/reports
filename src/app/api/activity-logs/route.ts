import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.activity_logs ORDER BY created_at DESC LIMIT 200'
    );
    return Response.json(rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: r.actor,
      description: r.description,
      timestamp: r.created_at,
    })));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { id: string; type: string; actor: string; description: string };
  const pool = makeServerPool();
  try {
    await pool.query(
      'INSERT INTO public.activity_logs (id, type, actor, description, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING',
      [body.id, body.type, body.actor, body.description]
    );
    return new Response(null, { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE() {
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.activity_logs');
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
