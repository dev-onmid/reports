import fichas from '@/lib/formatos-criativos-fichas.json';
import dados from '@/lib/formatos-criativos.json';
import type { Arquetipo, FichaExemplo } from '@/lib/formatos-criativos-briefing';

// Fichas da biblioteca "Formatos de Criativos": o arquétipo do formato e a ficha
// de cada exemplo. Geradas uma vez a partir dos vídeos (quadros + transcrição) e
// guardadas em src/lib/formatos-criativos-fichas.json. Ficam no servidor para não
// pesar o bundle da tela; quem chama decide se o pedido pode ver (sessão ou token).

const F = fichas as unknown as { formatos: Record<string, Arquetipo>; exemplos: Record<string, FichaExemplo> };
const FORMATOS = (dados as { formatos: { numero: number; exemplos: { arquivo: string }[] }[] }).formatos;

export function fichasDoFormato(numero: number) {
  const fmt = FORMATOS.find((f) => f.numero === numero);
  if (!fmt) return null;
  return {
    arquetipo: F.formatos[String(numero)] ?? null,
    exemplos: Object.fromEntries(fmt.exemplos.map((e) => [e.arquivo, F.exemplos[e.arquivo] ?? null])),
  };
}
