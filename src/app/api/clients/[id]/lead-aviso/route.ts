import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureLeadAvisoSchema, parseFontes, montarMensagem, FONTES_AVISO, type FonteAviso,
} from '@/lib/lead-aviso';
import { instanciaOnmid, sendTextOnmid } from '@/lib/whatsapp-send';

// Config POR CLIENTE do aviso de lead no grupo. Auth = deny-by-default do
// proxy (padrão das demais subrotas de cliente).

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureLeadAvisoSchema(pool);
    const [cfg, envios, oficial, resumo] = await Promise.all([
      pool.query(
        `SELECT ativo, group_id, fontes, desde
           FROM public.lead_aviso_config WHERE client_id = $1`, [id]),
      pool.query(
        `SELECT id, evento_id, fonte, status, erro, texto, tentativas,
                proxima_tentativa, created_at
           FROM public.lead_aviso_envios WHERE client_id = $1
          ORDER BY created_at DESC LIMIT 30`, [id]),
      // ⚠️ NÃO é um menu: o remetente é sempre a instância oficial da ONMID.
      // Vai para a tela só para dizer POR ONDE o aviso sai.
      instanciaOnmid(pool),
      // Contagem da fila separada do histórico: a lista é só das 30 últimas, e
      // a pendência precisa ser verdadeira mesmo com 200 esperando.
      pool.query(
        `SELECT status, COUNT(*)::int n,
                MIN(proxima_tentativa) FILTER (WHERE status = 'pendente') AS proxima
           FROM public.lead_aviso_envios WHERE client_id = $1 GROUP BY status`, [id]),
    ]);
    const c = cfg.rows[0];
    return Response.json({
      ativo: c?.ativo === true,
      groupId: c?.group_id ?? null,
      fontes: parseFontes(c?.fontes),
      desde: c?.desde ?? null,
      envios: envios.rows,
      remetente: oficial ? { id: oficial.id, nome: oficial.name } : null,
      fila: {
        pendentes: resumo.rows.find(r => r.status === 'pendente')?.n ?? 0,
        enviando: resumo.rows.find(r => r.status === 'enviando')?.n ?? 0,
        falhas: resumo.rows.find(r => r.status === 'falha')?.n ?? 0,
        enviados: resumo.rows.find(r => r.status === 'enviado')?.n ?? 0,
        proxima: resumo.rows.find(r => r.status === 'pendente')?.proxima ?? null,
      },
    });
  } catch (err) {
    console.error('[lead-aviso GET]', err);
    // Degrada em vez de derrubar a aba inteira do cliente.
    return Response.json({ ativo: false, groupId: null, fontes: FONTES_AVISO, envios: [], remetente: null,
      fila: { pendentes: 0, enviando: 0, falhas: 0, enviados: 0, proxima: null } });
  } finally { await pool.end(); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    ativo?: boolean; groupId?: string | null;
    fontes?: string[]; testar?: boolean; reenviar?: string;
  };

  const pool = makeServerPool();
  try {
    await ensureLeadAvisoSchema(pool);

    // Devolve uma linha da fila para o worker. Não cria outra: manter a MESMA
    // linha preserva o texto que seria entregue e a contagem de tentativas.
    if (body.reenviar) {
      const { rowCount } = await pool.query(
        `UPDATE public.lead_aviso_envios
            SET status = 'pendente', proxima_tentativa = NOW(), erro = NULL,
                tentativas = 0, atualizado_em = NOW()
          WHERE id = $1 AND client_id = $2 AND status IN ('falha', 'pendente', 'enviando')`,
        [body.reenviar, id],
      );
      return Response.json(rowCount
        ? { ok: true }
        : { ok: false, error: 'Esse aviso já foi entregue — não dá para reenviar.' });
    }

    if (body.testar) {
      const { rows: [c] } = await pool.query(
        `SELECT group_id FROM public.lead_aviso_config WHERE client_id = $1`, [id]);
      if (!c?.group_id) {
        return Response.json({ ok: false, error: 'Escolha o grupo e salve antes de testar.' });
      }
      // ⚠️ O exemplo mostra TUDO que um lead real carrega — conjunto, criativo e
      // respostas. A versão anterior mandava `anuncio: null` e sem respostas, e
      // o teste passou a impressão de que o aviso não trazia essas partes.
      const exemplo = montarMensagem({
        nome: 'Maria de Teste', numero: '5543999998888', fonte: 'meta_forms',
        canal: 'Formulário Meta', campanha: '[EXEMPLO] Campanha de teste',
        conjunto: '[EXEMPLO] Conjunto amplo', anuncio: '[EXEMPLO] Criativo 01',
        cidade: 'Londrina', uf: 'PR', email: 'maria@exemplo.com.br',
        respostas: [
          { pergunta: 'Qual procedimento você está interessado', resposta: 'Implante' },
          { pergunta: 'Qual o melhor horário para você', resposta: 'Manhã' },
        ],
      });
      const r = await sendTextOnmid(pool, c.group_id,
        `${exemplo}\n\n_(mensagem de teste enviada pelo painel)_`);
      return Response.json({ ok: r.ok, error: r.ok ? undefined : r.error });
    }

    const fontes = Array.isArray(body.fontes)
      ? parseFontes(body.fontes.filter((f): f is FonteAviso => typeof f === 'string').join(','))
      : null;

    // ⚠️ `desde` é reposicionado sempre que o aviso é LIGADO. Sem isso, religar
    // num cliente antigo despejaria todo o histórico de formulários no grupo —
    // e mensagem enviada não volta.
    await pool.query(
      // ⚠️ Nasce LIGADO quando o grupo é escolhido (pedido do Matheus em 29/09:
      // "assim que configurar a integração, deixar como ativo"). Configurar e
      // não ligar era um passo invisível — 16 clientes ficaram com grupo
      // definido e nenhum aviso saindo, sem nada na tela explicando.
      //
      // Só vale na TRANSIÇÃO sem grupo → com grupo. Quem desligou de propósito
      // e depois mexe nas fontes não é religado pelas costas.
      `INSERT INTO public.lead_aviso_config (client_id, ativo, group_id, fontes, desde)
       VALUES ($1, COALESCE($2, NULLIF($3, '') IS NOT NULL), $3, COALESCE($4, 'meta_forms,landing_page'), NOW())
       ON CONFLICT (client_id) DO UPDATE SET
         ativo         = COALESCE(
                           $2,
                           CASE WHEN NULLIF(public.lead_aviso_config.group_id, '') IS NULL
                                 AND NULLIF($3, '') IS NOT NULL
                                THEN TRUE ELSE public.lead_aviso_config.ativo END),
         group_id      = COALESCE($3, public.lead_aviso_config.group_id),
         fontes        = COALESCE($4, public.lead_aviso_config.fontes),
         -- Reposiciona o marco zero em QUALQUER transição desligado → ligado,
         -- inclusive a automática acima. Senão, ligar por tabela despejaria o
         -- histórico que o marco existe para conter.
         desde         = CASE WHEN public.lead_aviso_config.ativo IS NOT TRUE
                               AND ($2 IS TRUE
                                    OR (NULLIF(public.lead_aviso_config.group_id, '') IS NULL
                                        AND NULLIF($3, '') IS NOT NULL))
                              THEN NOW() ELSE public.lead_aviso_config.desde END,
         atualizado_em = NOW()`,
      [id, body.ativo ?? null, body.groupId ?? null, fontes?.join(',') ?? null],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[lead-aviso PATCH]', err);
    return Response.json({ ok: false, error: 'Não foi possível salvar.' }, { status: 500 });
  } finally { await pool.end(); }
}
