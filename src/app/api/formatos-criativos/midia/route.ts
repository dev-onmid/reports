import type { NextRequest } from 'next/server';
import { servirMidiaFormato } from '@/lib/formatos-midia';

/**
 * Vídeo/imagem de exemplo da página "Formatos de Criativos" (tela interna).
 * Fica atrás do login (deny-by-default do proxy) — o material é de um curso
 * pago. O link público tem rota própria, presa ao token:
 * /api/formatos-publico/[token]/midia.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return servirMidiaFormato(req, req.nextUrl.searchParams.get('f') ?? '');
}
