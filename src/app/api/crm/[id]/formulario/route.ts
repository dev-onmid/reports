// Respostas de formulário de um lead — o que a pessoa efetivamente respondeu.
//
// ⚠️ Rota separada de propósito: as respostas moram em `lead_tracking_events.raw`
// (snapshot imutável do toque), não em coluna de `crm_leads`. Carregá-las junto
// da LISTA de leads seria um JSONB por linha em telas de centenas de leads; aqui
// o modal busca só do lead aberto, como já faz com a análise da IA.
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { extrairRespostas, type RespostaFormulario } from '@/lib/lead-formulario';

export const dynamic = 'force-dynamic';

export type EnvioDeFormulario = {
  canal: string | null;
  recebidoEm: string | null;
  respostas: RespostaFormulario[];
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ canal: string | null; created_at: string; raw: unknown }>(
      `SELECT canal, created_at, raw
         FROM public.lead_tracking_events
        WHERE lead_id = $1::uuid AND raw IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 10`,
      [id],
    );

    // Só entra o toque que REALMENTE trouxe resposta: evento de WhatsApp/clique
    // também guarda raw, e devolvê-lo vazio faria a tela abrir um bloco sem nada.
    const envios: EnvioDeFormulario[] = [];
    for (const r of rows) {
      const respostas = extrairRespostas(r.raw);
      if (respostas.length === 0) continue;
      envios.push({ canal: r.canal, recebidoEm: r.created_at, respostas });
    }
    return Response.json({ envios });
  } catch {
    // Lead sem histórico, id inválido, tabela ausente: a tela só não mostra o
    // bloco. Nunca derruba o modal de edição por causa de um extra.
    return Response.json({ envios: [] });
  } finally {
    await pool.end();
  }
}
