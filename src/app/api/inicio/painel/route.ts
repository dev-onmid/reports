import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { listar, contadores, ensureNotificacoesSchema, type NotificacaoRow } from '@/lib/notificacoes';
import { eventosDeHoje, type AgendaEvento } from '@/lib/agenda-intake';
import { ensureOptimizerManualNotesTable } from '@/lib/optimizer';
import {
  normalizarFeed, agruparPorConta, separarCarteira, montarQuadro, avisosCobertura,
  type ClienteRef, type NotaBruta,
} from '@/lib/painel-gestor';

/**
 * Painel do Início: quadro do gestor + feed de notificações.
 *
 * Regra de custo: **nenhuma chamada externa**. Nem ClickUp, nem Meta, nem
 * Google. É a primeira tela do dia e o teto do plano Hobby é 10s — os números
 * caros já vêm apurados pelos crons (`balance_alerts_log`, `optimizer_ai_logs`,
 * `social_monitor_snapshots`), e a agenda vem do Make.
 *
 * Cada fonte é independente: uma que falha vira aviso de cobertura, não 500. Um
 * painel incompleto que diz que está incompleto é útil; um painel que morre
 * inteiro porque o Otimizador tossiu, não.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();
  const uid = session.uid;

  const pool = makeServerPool();
  try {
    const filtro = req.nextUrl.searchParams.get('filtro');
    const filtroFeed = filtro === 'importantes' || filtro === 'lidas' ? filtro : 'todas';

    await Promise.allSettled([ensureNotificacoesSchema(pool), ensureOptimizerManualNotesTable(pool)]);

    const [clientesR, feedR, contadoresR, notasR, agendaR, configsR] = await Promise.allSettled([
      pool.query<ClienteRef>(`SELECT id, name, gestor_id FROM public.clients ORDER BY name ASC`),
      listar(pool, uid, filtroFeed, 60),
      contadores(pool, uid),
      // Quadro é a MINHA mesa de trabalho: o que eu escrevi ou o que é de
      // cliente meu. Diferente do feed, onde nada é escondido de propósito.
      pool.query<NotaBruta>(
        `SELECT n.id::text, n.cliente_id, n.texto, n.categoria, n.status, n.prazo_em,
                n.autor_id, n.autor_nome, n.created_at
           FROM public.optimizer_manual_notes n
           LEFT JOIN public.clients c ON c.id = n.cliente_id
          WHERE n.ativo = true
            AND COALESCE(n.status, 'rapida') <> 'concluida'
            AND (n.autor_id = $1 OR c.gestor_id = $1)
          ORDER BY n.created_at DESC
          LIMIT 100`,
        [uid],
      ),
      eventosDeHoje(pool),
      pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM public.balance_alert_configs`),
    ]);

    const fontesComFalha: string[] = [];
    const clientes: ClienteRef[] = clientesR.status === 'fulfilled' ? clientesR.value.rows : [];
    if (clientesR.status === 'rejected') fontesComFalha.push('lista de clientes');

    const feedRows: NotificacaoRow[] = feedR.status === 'fulfilled' ? feedR.value : [];
    if (feedR.status === 'rejected') fontesComFalha.push('notificações');

    const notas: NotaBruta[] = notasR.status === 'fulfilled' ? notasR.value.rows : [];
    if (notasR.status === 'rejected') fontesComFalha.push('quadro de anotações');

    const agenda: AgendaEvento[] = agendaR.status === 'fulfilled' ? agendaR.value : [];
    if (agendaR.status === 'rejected') fontesComFalha.push('agenda do dia');

    const grupos = agruparPorConta(normalizarFeed(feedRows, clientes, uid));
    const { meus, outros } = separarCarteira(grupos);

    // Só avisamos quando NÃO há destino nenhum configurado. Com destinos
    // existindo, dizer quais contas ficaram de fora exigiria saber a cobertura
    // conta por conta — e um aviso impreciso é pior que nenhum.
    const semDestino = configsR.status === 'fulfilled' && Number(configsR.value.rows[0]?.total ?? 0) === 0;

    const nomesPorCliente = new Map(clientes.map(c => [c.id, c.name]));
    const meusClientes = new Set(clientes.filter(c => c.gestor_id === uid).map(c => c.id));

    return Response.json({
      // Para o seletor de "Nova anotação" — evita um fetch extra a /api/clients
      // só pra montar um dropdown, já que a lista foi carregada aqui.
      clientes: clientes.map(c => ({ id: c.id, name: c.name, meu: c.gestor_id === uid })),
      quadro: montarQuadro(notas, clientes, uid, new Date()),
      feed: { meus, outros },
      contadores: contadoresR.status === 'fulfilled' ? contadoresR.value : { naoLidas: 0, importantes: 0 },
      agenda: agenda.map(e => ({
        ...e,
        clienteNome: e.client_id ? nomesPorCliente.get(e.client_id) ?? null : null,
        meu: Boolean(e.client_id && meusClientes.has(e.client_id)),
      })),
      avisos: avisosCobertura({
        clientesSemAlertaSaldo: semDestino ? clientes.length : 0,
        fontesComFalha,
      }),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao montar o painel.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}
