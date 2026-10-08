import type { NextRequest } from 'next/server';
import dados from '@/lib/formatos-criativos.json';
import fichas from '@/lib/formatos-criativos-fichas.json';
import type { Arquetipo, FichaExemplo } from '@/lib/formatos-criativos-briefing';

/**
 * Ficha de um formato da página "Formatos de Criativos": o arquétipo do
 * formato e a ficha de cada exemplo (gancho, estrutura com tempos, como foi
 * gravado, roteiro modelo, transcrição). Gerado uma vez por IA a partir dos
 * vídeos (quadros + transcrição Whisper) e guardado em
 * src/lib/formatos-criativos-fichas.json. Fica no servidor e atrás do login
 * para não pesar no bundle da tela (e por ser material de curso pago).
 */
const F = fichas as unknown as { formatos: Record<string, Arquetipo>; exemplos: Record<string, FichaExemplo> };
const FORMATOS = (dados as { formatos: { numero: number; exemplos: { arquivo: string }[] }[] }).formatos;

export async function GET(req: NextRequest) {
  const numero = Number(req.nextUrl.searchParams.get('numero'));
  const fmt = FORMATOS.find((f) => f.numero === numero);
  if (!fmt) return Response.json({ error: 'formato não encontrado' }, { status: 404 });
  return Response.json({
    arquetipo: F.formatos[String(numero)] ?? null,
    exemplos: Object.fromEntries(fmt.exemplos.map((e) => [e.arquivo, F.exemplos[e.arquivo] ?? null])),
  });
}
