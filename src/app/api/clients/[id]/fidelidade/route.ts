import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureCardapioWebSchema, getConnection } from '@/lib/cardapioweb';
import { ensureAnotaAiSchema, listarLojas } from '@/lib/anotaai';
import { lerPedidosDelivery } from '@/lib/delivery-orders';
import { agruparPorCliente, normalizarRegua, normalizarTelefoneBR } from '@/lib/cardapioweb-recorrencia';
import { getClientInstance } from '@/lib/followup-send';
import {
  filtrarPublico, resumirSegmento, ORDEM_MODELOS, parseListaManual, validarCampanha,
  limparMensagens, normalizarCupom, type FonteCampanha,
} from '@/lib/fidelidade';
import {
  ensureFidelidadeSchema, listarCampanhas, lerTravas, salvarCampanha, salvarTravas,
  listarListas, salvarLista, excluirLista, excluirCampanha, enviosEntregues,
} from '@/lib/fidelidade-server';
import { atribuirResultados } from '@/lib/fidelidade-atribuicao';

/**
 * Fidelidade — segmentos, listas manuais e configuração das campanhas.
 *
 * ⚠️ Esta rota não envia nada: quem dispara é `/api/fidelidade/worker`. Aqui
 * só se lê público e se grava configuração.
 *
 * Leitura pura do que já foi sincronizado — nada de chamada ao Cardápio Web,
 * porque a tela não pode depender do rate limit de 5 req/min deles.
 */

const AMOSTRA = 25;

async function fidelidadeAtiva(
  pool: ReturnType<typeof makeServerPool>, clientId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ fidelidade_ativa: boolean | null }>(
    `SELECT fidelidade_ativa FROM public.clients WHERE id = $1`, [clientId],
  ).catch(() => ({ rows: [] as { fidelidade_ativa: boolean | null }[] }));
  return rows[0]?.fidelidade_ativa === true;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;

  const pool = makeServerPool();
  try {
    await Promise.all([
      ensureCardapioWebSchema(pool), ensureAnotaAiSchema(pool), ensureFidelidadeSchema(pool),
    ]);

    if (!await fidelidadeAtiva(pool, clientId)) {
      return Response.json({ ativo: false, conectado: false });
    }

    const [conn, lojasAnota, campanhas, travas, listas, instancia] = await Promise.all([
      getConnection(pool, clientId),
      listarLojas(pool, clientId),
      listarCampanhas(pool, clientId),
      lerTravas(pool, clientId),
      listarListas(pool, clientId),
      getClientInstance(pool, clientId).catch(() => null),
    ]);

    // ⚠️ A aba NÃO exige mais integração de delivery: com lista manual ela serve
    // qualquer cliente. `conectado` deixou de ser porteiro e virou informação —
    // é só ele que decide se os SEGMENTOS têm de onde sair.
    const conectado = !!conn || lojasAnota.length > 0;
    const regua = normalizarRegua({
      janelaDias: conn?.janela_dias, inatividadeDias: conn?.inatividade_dias,
    });

    let ticketMedioLoja = 0;
    let base = { clientes: 0, comTelefone: 0 };
    let segmentos: unknown[] = [];
    // Resultado por campanha: "quanto isso trouxe de volta". Sem delivery
    // conectado não há pedido para cruzar, e a tela mostra travessão em vez de
    // zero — zero afirmaria que a campanha não vendeu, o que não sabemos.
    let resultados: Record<string, unknown> = {};

    const envios = await enviosEntregues(pool, clientId);

    if (conectado) {
      const { pedidos } = await lerPedidosDelivery(pool, clientId);

      const atribuiveis = pedidos.map(o => ({
        chave: normalizarTelefoneBR(o.customer_phone) ?? '',
        criadoEm: o.created_at instanceof Date ? o.created_at.toISOString() : String(o.created_at),
        total: Number(o.total) || 0,
        cancelado: o.status === 'canceled',
        cupom: Array.isArray(o.discounts)
          ? (o.discounts.find(d => d?.coupon_code)?.coupon_code ?? null)
          : null,
      })).filter(o => o.chave);
      resultados = Object.fromEntries(atribuirResultados(envios, atribuiveis, 7));
      const clientes = agruparPorCliente(pedidos, regua, new Date().toISOString());
      const pedidosTotal = clientes.reduce((s, c) => s + c.pedidos, 0);
      const receitaTotal = clientes.reduce((s, c) => s + c.receita, 0);
      ticketMedioLoja = pedidosTotal > 0 ? receitaTotal / pedidosTotal : 0;
      base = { clientes: clientes.length, comTelefone: clientes.filter(c => c.telefone).length };

      const porModelo = new Map(campanhas.filter(c => c.modelo).map(c => [c.modelo!, c]));
      segmentos = ORDEM_MODELOS.map(modelo => {
        const camp = porModelo.get(modelo)!;
        const publico = filtrarPublico(clientes, modelo, camp.params, { regua, ticketMedioLoja });
        return {
          modelo,
          resumo: resumirSegmento(publico),
          amostra: publico.slice(0, AMOSTRA).map(c => ({
            nome: c.nome, telefone: c.telefone, pedidos: c.pedidos,
            receita: c.receita, ticketMedio: c.ticketMedio,
            diasDesdeUltima: c.diasDesdeUltima, ultimaCompra: c.ultimaCompra,
          })),
        };
      });
    }

    if (!conectado) {
      // Sem pedidos, ainda dá para dizer quantas mensagens cada campanha mandou.
      resultados = Object.fromEntries(atribuirResultados(envios, [], 7));
    }

    return Response.json({
      ativo: true,
      conectado,
      resultados,
      loja: conn?.merchant_name ?? lojasAnota[0]?.store_name ?? null,
      regua,
      ticketMedioLoja,
      base,
      instancia: instancia ? { provider: instancia.provider, id: instancia.instanceId } : null,
      travas,
      campanhas,
      listas,
      segmentos,
      execucoes: await ultimasExecucoes(pool, clientId),
    });
  } catch (err) {
    console.error('[fidelidade]', err);
    return Response.json({ error: 'Falha ao carregar a fidelidade' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

async function ultimasExecucoes(pool: ReturnType<typeof makeServerPool>, clientId: string) {
  const { rows } = await pool.query(
    `SELECT e.id, e.campanha_id, e.iniciada_em, e.concluida_em, e.status,
            e.publico, e.enviadas, e.falhas, e.puladas, f.nome AS campanha
       FROM public.fidelidade_execucoes e
       LEFT JOIN public.fidelidade_campanhas f ON f.id = e.campanha_id
      WHERE e.client_id = $1
      ORDER BY e.iniciada_em DESC LIMIT 20`,
    [clientId],
  ).catch(() => ({ rows: [] }));
  return rows;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'Corpo inválido' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureFidelidadeSchema(pool);

    if (!await fidelidadeAtiva(pool, clientId)) {
      return Response.json({ error: 'Fidelidade desativada para este cliente' }, { status: 403 });
    }

    if (body.travas !== undefined) {
      return Response.json({ travas: await salvarTravas(pool, clientId, body.travas) });
    }

    // ── Listas manuais ──────────────────────────────────────────────────
    if (body.lista !== undefined) {
      const lista = body.lista as Record<string, unknown>;
      const nome = typeof lista.nome === 'string' && lista.nome.trim()
        ? lista.nome.trim().slice(0, 120) : 'Lista sem nome';
      const leitura = parseListaManual(String(lista.texto ?? ''), normalizarTelefoneBR);
      const idLista = typeof lista.id === 'string' ? lista.id : null;
      if (leitura.contatos.length === 0 && !idLista) {
        return Response.json(
          { error: 'Nenhum telefone válido na lista', invalidos: leitura.invalidos },
          { status: 400 },
        );
      }
      const r = await salvarLista(pool, clientId, {
        id: idLista, nome, contatos: leitura.contatos,
      });
      return Response.json({
        lista: r, invalidos: leitura.invalidos, duplicados: leitura.duplicados,
        listas: await listarListas(pool, clientId),
      });
    }

    if (body.excluirLista !== undefined) {
      await excluirLista(pool, clientId, String(body.excluirLista));
      return Response.json({ listas: await listarListas(pool, clientId) });
    }

    if (body.excluirCampanha !== undefined) {
      await excluirCampanha(pool, clientId, String(body.excluirCampanha));
      return Response.json({ campanhas: await listarCampanhas(pool, clientId) });
    }

    // ── Campanha ────────────────────────────────────────────────────────
    if (body.fonte !== undefined || body.modelo !== undefined) {
      const fonte: FonteCampanha = body.fonte === 'lista' ? 'lista' : 'segmento';
      // A MESMA validação da tela roda aqui: é o que garante que nenhuma
      // campanha chega ao motor com texto que ele não sabe montar.
      const erros = validarCampanha(
        limparMensagens(body.mensagens, fonte === 'segmento' ? (body.modelo as never) : null),
        fonte,
        normalizarCupom(body.cupom),
      );
      if (erros.length > 0) return Response.json({ error: erros.join(' '), erros }, { status: 400 });

      try {
        const campanha = await salvarCampanha(pool, clientId, body);
        return Response.json({ campanha });
      } catch (err) {
        return Response.json({ error: String((err as Error).message ?? err) }, { status: 400 });
      }
    }

    return Response.json({ error: 'Nada para salvar' }, { status: 400 });
  } catch (err) {
    console.error('[fidelidade PATCH]', err);
    return Response.json({ error: 'Falha ao salvar' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
