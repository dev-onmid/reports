import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import {
  ensureFunilModelosSchema,
  buscarModelo,
  planejarAplicacaoModelo,
  type StageAtual,
  type EtapaModelo,
} from '@/lib/crm-funil-modelos';
import { ETAPAS_PADRAO, MODELO_PADRAO } from '@/lib/funil-etapas';

// Aplica um modelo num funil que JÁ EXISTE (o CRM do cliente antigo).
//
// ⚠️ `previa: true` devolve o plano SEM escrever nada. A tela sempre pede a
// prévia antes — o gestor precisa ver quantos leads mudam de coluna e para
// onde, porque isso não tem desfazer: o status antigo é sobrescrito.

async function carregarAtuais(
  pool: ReturnType<typeof makeServerPool>,
  funnelId: string,
): Promise<StageAtual[]> {
  // ⚠️ A contagem é por (funil, rótulo) — é exatamente o conjunto que o UPDATE
  // vai mexer. Contar por cliente inflaria o número com leads de outro funil
  // que usam o mesmo texto de status e não serão tocados.
  const { rows } = await pool.query(
    `SELECT s.id, s.label, s.position, s.etapa_funil,
            (SELECT COUNT(*) FROM public.crm_leads l
              WHERE l.funnel_id = s.funnel_id AND l.status = s.label)::int AS leads
       FROM public.crm_stages s
      WHERE s.funnel_id = $1
      ORDER BY s.position ASC`,
    [funnelId],
  );
  return rows as StageAtual[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: funnelId } = await params;

  const body = await req.json().catch(() => ({})) as {
    clientId?: string; modeloId?: string; destinos?: Record<string, string>; previa?: boolean;
  };
  if (!body.clientId) {
    return Response.json({ error: 'clientId é obrigatório' }, { status: 400 });
  }
  // ⚠️ O padrão do sistema NÃO é um registro em crm_funil_modelos — é o seed do
  // código. Sem este ramo ele era o único "modelo" impossível de aplicar num
  // funil existente, porque a rota exigia um id de modelo salvo.
  const usarPadrao = !body.modeloId || body.modeloId === MODELO_PADRAO;

  const pool = makeServerPool();
  try {
    await ensureFunilModelosSchema(pool);

    const modelo = usarPadrao ? null : await buscarModelo(pool, body.modeloId!);
    if (!usarPadrao && (!modelo || modelo.etapas.length === 0)) {
      return Response.json({ error: 'Modelo não encontrado.' }, { status: 404 });
    }
    const etapas: EtapaModelo[] = usarPadrao
      ? ETAPAS_PADRAO.map(e => ({ label: e.label, color: e.color, etapa_funil: e.etapa }))
      : modelo!.etapas;
    const nomeModelo = usarPadrao ? 'Padrão do sistema' : modelo!.nome;

    const atuais = await carregarAtuais(pool, funnelId);
    const plano = planejarAplicacaoModelo(atuais, etapas, body.destinos ?? {});

    if (body.previa !== false) {
      return Response.json({ plano, modelo: { id: body.modeloId ?? MODELO_PADRAO, nome: nomeModelo } });
    }

    // ── Aplicação ────────────────────────────────────────────────────────────
    // ⚠️ Transação: metade aplicado é o pior desfecho — colunas do modelo já
    // criadas e leads ainda apontando para rótulos apagados.
    await pool.query('BEGIN');
    try {
      let leadsMigrados = 0;
      for (const r of plano.remover) {
        if (!r.destino) continue;
        const { rowCount } = await pool.query(
          `UPDATE public.crm_leads SET status = $1, updated_at = NOW()
            WHERE funnel_id = $2 AND status = $3`,
          [r.destino, funnelId, r.label],
        );
        leadsMigrados += rowCount ?? 0;

        // Gatilho por status segue o lead — senão vira gatilho morto apontando
        // para uma coluna que não existe mais. Best-effort e só quando o
        // destino ainda não tem gatilho igual (mesma regra do saneamento).
        await pool.query(
          `UPDATE public.client_conversion_eventos_custom c
              SET status_gatilho = $1
            WHERE c.client_id = $2 AND LOWER(c.status_gatilho) = LOWER($3)
              AND NOT EXISTS (
                SELECT 1 FROM public.client_conversion_eventos_custom d
                 WHERE d.client_id = $2 AND LOWER(d.status_gatilho) = LOWER($1))`,
          [r.destino, body.clientId, r.label],
        ).catch(() => {});
        await pool.query(
          `UPDATE public.crm_followup_regras SET status_gatilho = $1
            WHERE client_id = $2 AND status_gatilho = $3`,
          [r.destino, body.clientId, r.label],
        ).catch(() => {});
        await pool.query(
          `UPDATE public.crm_followup_mensagens m SET status_destino = $1
             FROM public.crm_followup_regras rg
            WHERE m.regra_id = rg.id AND rg.client_id = $2 AND m.status_destino = $3`,
          [r.destino, body.clientId, r.label],
        ).catch(() => {});
      }

      if (plano.remover.length > 0) {
        await pool.query(
          `DELETE FROM public.crm_stages WHERE id = ANY($1::uuid[])`,
          [plano.remover.map(r => r.id)],
        );
      }

      for (const m of plano.manter) {
        await pool.query(
          `UPDATE public.crm_stages SET position = $1, etapa_funil = $2, color = $3 WHERE id = $4`,
          [m.posicao, m.etapa, m.color, m.id],
        );
      }
      for (const c of plano.criar) {
        await pool.query(
          `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [funnelId, body.clientId, c.label, c.color, c.posicao, c.etapa],
        );
      }
      for (const c of plano.conservar) {
        await pool.query(`UPDATE public.crm_stages SET position = $1 WHERE id = $2`, [c.posicao, c.id]);
      }

      await pool.query('COMMIT');
      return Response.json({ ok: true, leadsMigrados, plano });
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('[aplicar-modelo]', err);
    return Response.json({ error: 'Não foi possível aplicar o modelo.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
