import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureCardapioWebSchema, getConnection } from '@/lib/cardapioweb';
import { ensureAnotaAiSchema, listarLojas } from '@/lib/anotaai';
import { lerPedidosDelivery } from '@/lib/delivery-orders';
import { agruparPorCliente, normalizarRegua } from '@/lib/cardapioweb-recorrencia';
import { getClientInstance } from '@/lib/followup-send';
import {
  filtrarPublico, resumirSegmento, MODELOS, ORDEM_MODELOS, type ModeloId,
} from '@/lib/fidelidade';
import {
  ensureFidelidadeSchema, listarCampanhas, lerTravas, salvarCampanha, salvarTravas,
} from '@/lib/fidelidade-server';

/**
 * Fidelidade — leitura dos segmentos e da configuração das campanhas.
 *
 * ⚠️ Esta rota NÃO envia nada e não conhece o motor de disparo. Ela responde
 * "quem se encaixa em cada modelo hoje" e devolve a configuração salva.
 *
 * Como o funil de recorrência, é leitura pura do que já foi sincronizado: nada
 * de chamada ao Cardápio Web aqui — a tela não pode depender do rate limit de
 * 5 req/min deles para renderizar.
 */

const AMOSTRA = 25;

function ehModelo(v: unknown): v is ModeloId {
  return typeof v === 'string' && (MODELOS as readonly string[]).includes(v);
}

/**
 * A Fidelidade é OPT-IN por cliente (`clients.fidelidade_ativa`, DEFAULT false).
 *
 * ⚠️ Este é o portão de verdade — esconder a aba é só apresentação, e link
 * direto, aba antiga aberta ou chamada por fora passariam por cima dela. Todo
 * caminho novo (inclusive o worker da Fase 2) tem de perguntar aqui antes de
 * ler público ou, principalmente, de enviar qualquer coisa: o remetente é o
 * WhatsApp do próprio cliente.
 *
 * Coluna ausente (instalação que ainda não rodou o ALTER) é tratada como
 * DESLIGADA — falha fechada, nunca aberta.
 */
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

    // Antes de qualquer leitura: desligada não calcula segmento nenhum.
    if (!await fidelidadeAtiva(pool, clientId)) {
      return Response.json({ ativo: false, conectado: false });
    }

    const [conn, lojasAnota] = await Promise.all([
      getConnection(pool, clientId),
      listarLojas(pool, clientId),
    ]);
    // Sem nenhuma plataforma de delivery não existe base de consumo — e o
    // público destas campanhas é, por decisão, só quem já pediu.
    if (!conn && lojasAnota.length === 0) return Response.json({ ativo: true, conectado: false });

    const regua = normalizarRegua({
      janelaDias: conn?.janela_dias, inatividadeDias: conn?.inatividade_dias,
    });

    const [{ pedidos }, campanhas, travas, instancia] = await Promise.all([
      lerPedidosDelivery(pool, clientId),
      listarCampanhas(pool, clientId),
      lerTravas(pool, clientId),
      getClientInstance(pool, clientId).catch(() => null),
    ]);

    const clientes = agruparPorCliente(pedidos, regua, new Date().toISOString());
    const comFone = clientes.filter(c => c.telefone).length;

    // Ticket médio da LOJA (não do segmento): é a base da régua relativa do VIP.
    const receitaTotal = clientes.reduce((s, c) => s + c.receita, 0);
    const pedidosTotal = clientes.reduce((s, c) => s + c.pedidos, 0);
    const ticketMedioLoja = pedidosTotal > 0 ? receitaTotal / pedidosTotal : 0;

    const porModelo = new Map(campanhas.map(c => [c.modelo, c]));
    const segmentos = ORDEM_MODELOS.map(modelo => {
      const camp = porModelo.get(modelo)!;
      const publico = filtrarPublico(clientes, modelo, camp.params, { regua, ticketMedioLoja });
      return {
        modelo,
        resumo: resumirSegmento(publico),
        // Ordenado por receita (agruparPorCliente já entrega assim): quem vale
        // mais aparece primeiro na amostra.
        amostra: publico.slice(0, AMOSTRA).map(c => ({
          nome: c.nome, telefone: c.telefone, pedidos: c.pedidos,
          receita: c.receita, ticketMedio: c.ticketMedio,
          diasDesdeUltima: c.diasDesdeUltima, ultimaCompra: c.ultimaCompra,
        })),
      };
    });

    return Response.json({
      ativo: true,
      conectado: true,
      loja: conn?.merchant_name ?? lojasAnota[0]?.store_name ?? null,
      regua,
      ticketMedioLoja,
      base: { clientes: clientes.length, comTelefone: comFone },
      // O número é o do próprio cliente (instância do CRM). A tela precisa
      // avisar quando não há nenhuma: sem ela, nada poderá ser enviado.
      instancia: instancia ? { provider: instancia.provider, id: instancia.instanceId } : null,
      travas,
      campanhas,
      segmentos,
    });
  } catch (err) {
    console.error('[fidelidade]', err);
    return Response.json({ error: 'Falha ao carregar a fidelidade' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'Corpo inválido' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureFidelidadeSchema(pool);

    // Desligada não grava nada: aba aberta antes de alguém desativar não pode
    // continuar configurando campanha por trás.
    if (!await fidelidadeAtiva(pool, clientId)) {
      return Response.json({ error: 'Fidelidade desativada para este cliente' }, { status: 403 });
    }

    if (body.travas !== undefined) {
      return Response.json({ travas: await salvarTravas(pool, clientId, body.travas) });
    }
    if (ehModelo(body.modelo)) {
      return Response.json({ campanha: await salvarCampanha(pool, clientId, body.modelo, body) });
    }
    return Response.json({ error: 'Informe `modelo` ou `travas`' }, { status: 400 });
  } catch (err) {
    console.error('[fidelidade PATCH]', err);
    return Response.json({ error: 'Falha ao salvar' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
