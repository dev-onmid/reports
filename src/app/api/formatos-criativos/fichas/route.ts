import type { NextRequest } from 'next/server';
import { fichasDoFormato } from '@/lib/formatos-fichas';

/**
 * Fichas de um formato (tela interna, atrás do login). O link público tem rota
 * própria, presa ao token: /api/formatos-publico/[token]/fichas.
 */
export async function GET(req: NextRequest) {
  const r = fichasDoFormato(Number(req.nextUrl.searchParams.get('numero')));
  if (!r) return Response.json({ error: 'formato não encontrado' }, { status: 404 });
  return Response.json(r);
}
