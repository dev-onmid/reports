import type { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureDefaultFunnel, getFirstFunnelStageLabel } from '@/lib/crm-conversation-sync';
import {
  ensureDiscadorSchema, contadoresDaLista, proximoContato, pendentesDaLista,
  RESULTADOS, INTERESSES, ROTULO_INTERESSE, formatarTelefone,
  type Resultado, type Interesse, type Contato,
} from '@/lib/discador';

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

type Pool = ReturnType<typeof makeServerPool>;
type Cliente = PoolClient;

/**
 * Leva para o CRM quem atendeu. Sem duplicar: se o número já é lead desse
 * cliente, a conversa entra na observação do lead que existe — o CRM já
 * agrupa por número, e um segundo card do mesmo telefone só confundiria.
 */
async function levarAoCrm(
  pool: Cliente,
  args: { clientId: string; contato: Contato; listaNome: string; interesse: Interesse | null; nomeContato: string | null; observacao: string | null; retornarEm: string | null },
): Promise<string> {
  const { clientId, contato, listaNome, interesse, nomeContato, observacao, retornarEm } = args;
  const linhas = [
    `Prospecção por telefone · lista "${listaNome}"`,
    contato.empresa ? `Empresa: ${contato.empresa}` : null,
    contato.segmento ? `Segmento: ${contato.segmento}` : null,
    contato.cidade ? `Cidade: ${contato.cidade}` : null,
    contato.cnpj ? `CNPJ: ${contato.cnpj}` : null,
    contato.email ? `E-mail: ${contato.email}` : null,
    interesse ? `Interesse: ${ROTULO_INTERESSE[interesse]}` : null,
    retornarEm ? `Retornar em: ${new Date(retornarEm).toLocaleString('pt-BR')}` : null,
    observacao ? `Obs.: ${observacao}` : null,
  ].filter(Boolean).join('\n');

  const nome = nomeContato && contato.empresa ? `${nomeContato} · ${contato.empresa}` : (nomeContato ?? contato.empresa ?? formatarTelefone(contato.telefone));
  const dataAgendada = retornarEm ? retornarEm.slice(0, 10) : null;

  // Garante tabela + funil ANTES de consultar: num banco novo (ou cliente sem
  // CRM aberto ainda) a tabela/funil nascem aqui. Em produção é no-op memoizado.
  // `ensureDefaultFunnel` só usa `.query`, e o client da transação tem a mesma
  // assinatura — o cast é para o tipo, não muda comportamento.
  const funnelId = await ensureDefaultFunnel(pool as unknown as Pool, clientId);

  // Lead vinculado numa ligação anterior, ou mesmo número já no CRM do cliente.
  const { rows: [existente] } = await pool.query<{ id: string; observacao: string | null }>(
    `SELECT id, observacao FROM public.crm_leads
      WHERE client_id = $1 AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR regexp_replace(COALESCE(numero,''), '\\D', '', 'g') = $3)
      ORDER BY CASE WHEN id = $2::uuid THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
    [clientId, contato.lead_id, contato.telefone],
  );
  if (existente) {
    await pool.query(
      `UPDATE public.crm_leads
          SET observacao = CASE WHEN COALESCE(observacao,'') = '' THEN $2 ELSE observacao || E'\n\n' || $2 END,
              data_agendada = COALESCE($3::date, data_agendada),
              updated_at = NOW()
        WHERE id = $1`,
      [existente.id, `[${new Date().toLocaleDateString('pt-BR')}] ${linhas}`, dataAgendada],
    );
    return existente.id;
  }

  const status = await getFirstFunnelStageLabel(pool as unknown as Pool, funnelId);
  const { rows: [lead] } = await pool.query<{ id: string }>(
    `INSERT INTO public.crm_leads
       (client_id, data, nome, numero, canal, origin, status, observacao, data_agendada, funnel_id, time_interno)
     VALUES ($1, CURRENT_DATE, $2, $3, 'Telefone', 'discador', $4, $5, $6, $7, false)
     RETURNING id`,
    [clientId, nome, contato.telefone, status, linhas, dataAgendada, funnelId],
  );
  return lead.id;
}

/**
 * Registra o resultado de UMA tentativa e devolve o próximo da fila — é a
 * chamada que a tela faz a cada botão. Tudo na mesma transação: a chamada no
 * histórico, o contato atualizado e, se atendeu e for para o CRM, o lead.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const session = getSession(req);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    resultado?: unknown; interesse?: unknown; nome_contato?: unknown; observacao?: unknown;
    retornar_em?: unknown; criar_lead?: unknown; iniciada_at?: unknown;
  };
  const resultado = body.resultado as Resultado;
  if (!RESULTADOS.includes(resultado)) return Response.json({ error: 'Resultado inválido.' }, { status: 400 });
  const interesse = resultado === 'atendeu' && INTERESSES.includes(body.interesse as Interesse) ? (body.interesse as Interesse) : null;
  const nomeContato = typeof body.nome_contato === 'string' ? body.nome_contato.trim().slice(0, 120) || null : null;
  const observacao = typeof body.observacao === 'string' ? body.observacao.trim().slice(0, 2000) || null : null;
  const retornarEm = interesse === 'retornar' && typeof body.retornar_em === 'string' && !Number.isNaN(Date.parse(body.retornar_em))
    ? new Date(body.retornar_em).toISOString() : null;
  const iniciadaAt = typeof body.iniciada_at === 'string' && !Number.isNaN(Date.parse(body.iniciada_at)) ? body.iniciada_at : null;
  const criarLead = resultado === 'atendeu' && body.criar_lead !== false;

  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    const { rows: [contato] } = await pool.query<Contato>(`SELECT * FROM public.discador_contatos WHERE id = $1`, [id]);
    if (!contato) return Response.json({ error: 'Contato não encontrado.' }, { status: 404 });
    const { rows: [lista] } = await pool.query<{ id: string; nome: string; client_id: string | null }>(
      `SELECT id, nome, client_id FROM public.discador_listas WHERE id = $1`, [contato.lista_id],
    );
    if (!lista) return Response.json({ error: 'Lista não encontrada.' }, { status: 404 });

    // ⚠️ Transação num client DEDICADO. `pool.query` descarta a conexão quando
    // uma query falha, então BEGIN numa conexão e UPDATE em outra: foi assim que
    // o teste local perdeu o INSERT da chamada e manteve o UPDATE do contato.
    let leadId: string | null = contato.lead_id;
    let crmErro: string | null = null;
    let atualizado: Contato | undefined;
    const tx = await pool.connect();
    let aberta = false;
    try {
      await tx.query('BEGIN');
      aberta = true;

      await tx.query(
        `INSERT INTO public.discador_chamadas (contato_id, lista_id, user_id, resultado, interesse, observacao, iniciada_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [contato.id, lista.id, session.uid, resultado, interesse, observacao, iniciadaAt],
      );

      // Status novo. "Retornar depois" com data vira agendamento e volta à fila na hora marcada.
      const statusNovo = resultado === 'atendeu' ? (interesse === 'retornar' && retornarEm ? 'retornar' : 'atendeu') : resultado;

      if (criarLead) {
        if (!lista.client_id) {
          crmErro = 'A lista não tem cliente do CRM definido — o lead não foi criado.';
        } else {
          // SAVEPOINT: erro no CRM desfaz só o pedaço do CRM. Sem ele, o Postgres
          // aborta a transação inteira e o UPDATE do contato logo abaixo falharia —
          // a ligação sumiria junto com o lead.
          await tx.query('SAVEPOINT crm');
          try {
            leadId = await levarAoCrm(tx, {
              clientId: lista.client_id, contato, listaNome: lista.nome, interesse, nomeContato, observacao, retornarEm,
            });
            await tx.query('RELEASE SAVEPOINT crm');
          } catch (err) {
            await tx.query('ROLLBACK TO SAVEPOINT crm');
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[discador → CRM]', msg);
            crmErro = `A ligação foi registrada, mas o lead não entrou no CRM (${msg.slice(0, 120)}).`;
          }
        }
      }

      const obsAcumulada = observacao
        ? `[${new Date().toLocaleDateString('pt-BR')}] ${observacao}`
        : null;
      ({ rows: [atualizado] } = await tx.query<Contato>(
        `UPDATE public.discador_contatos
            SET status = $2,
                tentativas = tentativas + 1,
                ultima_tentativa_at = NOW(),
                proxima_tentativa_at = $3,
                pulado_at = NULL,
                interesse = COALESCE($4, interesse),
                nome_contato = COALESCE($5, nome_contato),
                observacao = CASE WHEN $6::text IS NULL THEN observacao
                                  WHEN COALESCE(observacao,'') = '' THEN $6
                                  ELSE observacao || E'\n' || $6 END,
                lead_id = COALESCE($7::uuid, lead_id),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [contato.id, statusNovo, retornarEm, interesse, nomeContato, obsAcumulada, leadId],
      ));
      await tx.query(`UPDATE public.discador_listas SET updated_at = NOW() WHERE id = $1`, [lista.id]);
      await tx.query('COMMIT');
      aberta = false;
    } catch (err) {
      if (aberta) await tx.query('ROLLBACK').catch(() => null);
      throw err;
    } finally {
      tx.release();
    }

    const [contadores, proximo, pendentes] = await Promise.all([
      contadoresDaLista(pool, lista.id),
      proximoContato(pool, lista.id, contato.id),
      pendentesDaLista(pool, lista.id),
    ]);
    return Response.json({
      contato: atualizado, lead_id: leadId, crm_erro: crmErro,
      contadores, proximo: proximo.contato, motivo: proximo.motivo, pendentes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[discador resultado]', msg);
    return Response.json({ error: 'Não foi possível registrar a ligação.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
