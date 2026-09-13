// Página do cliente → CRM, automático: o GET já conecta (idempotente) e devolve
// o estado + os formulários com contadores. POST força reconexão; DELETE desliga.
// Ver src/lib/meta-leadgen-forms.ts. Atrás do proxy (cookie obrigatório).
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { conectarPaginaDoCliente, desligarPaginaDoCliente, listarConectados } from '@/lib/meta-leadgen-forms';

export const maxDuration = 60;

async function responder(clientId: string) {
  const pool = makeServerPool();
  try {
    const status = await conectarPaginaDoCliente(pool, clientId);
    const formularios = await listarConectados(pool, clientId).catch(() => []);
    return Response.json({ ...status, formularios });
  } finally { await pool.end(); }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return responder(id);
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return responder(id);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    const ok = await desligarPaginaDoCliente(pool, id);
    return Response.json({ ok });
  } finally { await pool.end(); }
}
