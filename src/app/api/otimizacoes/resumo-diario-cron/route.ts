import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { buscarAtividadesMeta, buscarMudancasGoogle } from '@/lib/atividade-conta';
import { compilarResumoDoDia, diaDoEvento, ehRuidoFinanceiro } from '@/lib/resumo-dia';
import { ensureOtimizacaoHistoricoSchema } from '@/lib/otimizacao-historico';

/**
 * Resumo diário do Histórico: compila as ações feitas na conta do cliente
 * (Meta activities + Google change_event — as MESMAS fontes da aba Histórico
 * do cliente) em UM registro por canal em otimizacao_registros.
 *
 * ⚠️ origem='resumo' de propósito: o overview EXCLUI esse origem da "última
 * ação" — o resumo é observação, não otimização, e se contasse na régua toda
 * conta ficaria eternamente "em dia" e o alerta de atraso morreria.
 *
 * Idempotente por (cliente, canal, dia): rodar duas vezes não duplica.
 * `?dry=1` devolve o que SERIA gravado; `?data=YYYY-MM-DD` reprocessa um dia
 * específico (padrão: ontem em BRT — o Matheus analisa D-1).
 */
export const maxDuration = 300;
const ORCAMENTO_MS = 240_000;

function autorizado(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  return valid.length > 0 && valid.includes(secret);
}

/** Ontem em BRT (UTC-3 fixo, padrão do projeto), como YYYY-MM-DD. */
function ontemBrt(): string {
  return new Date(Date.now() - 3 * 3_600_000 - 24 * 3_600_000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const inicio = Date.now();
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(req.nextUrl.searchParams.get('data') ?? '')
    ? req.nextUrl.searchParams.get('data')!
    : ontemBrt();
  const diaLabel = `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
  // Busca desde a véspera do dia-alvo (as APIs só filtram "desde"); o corte
  // exato do DIA é feito aqui pelo prefixo da data do evento.
  const since = new Date(`${dia}T00:00:00-03:00`);

  const pool = makeServerPool();
  const resultados: Array<Record<string, unknown>> = [];
  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    const soCliente = req.nextUrl.searchParams.get('clientId');
    const { rows: clientes } = await pool.query<{ client_id: string; name: string | null }>(
      `SELECT DISTINCT l.client_id, c.name
         FROM public.client_account_links l
         LEFT JOIN public.clients c ON c.id = l.client_id
        WHERE l.platform IN ('meta_ads', 'google_ads')
          AND COALESCE(c.status, 'ativo') NOT ILIKE '%inativ%'
        ORDER BY c.name ASC NULLS LAST`,
    );
    const alvo = soCliente ? clientes.filter(c => c.client_id === soCliente) : clientes;

    for (const cliente of alvo) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        resultados.push({ client: cliente.name, pulado: 'orçamento de tempo' });
        continue;
      }
      try {
        const [meta, google] = await Promise.all([
          buscarAtividadesMeta(pool, cliente.client_id, since),
          buscarMudancasGoogle(pool, cliente.client_id, since),
        ]);
        // Corte exato pro dia-alvo (a Meta manda data em pt-BR!) e filtro de
        // ruído financeiro — cobrança não é otimização.
        const doDia = [...meta, ...google].filter(ev =>
          diaDoEvento(ev.criadoEm) === dia && !ehRuidoFinanceiro(ev.descricao));
        const resumos = compilarResumoDoDia(doDia, diaLabel);
        if (resumos.length === 0) {
          resultados.push({ client: cliente.name, dia, eventos: 0 });
          continue;
        }

        const gravados: string[] = [];
        for (const r of resumos) {
          // Idempotência: um resumo por (cliente, canal, dia).
          const { rows: [ja] } = await pool.query(
            `SELECT 1 FROM public.otimizacao_registros
              WHERE client_id = $1 AND canal = $2 AND origem = 'resumo'
                AND descricao LIKE $3 LIMIT 1`,
            [cliente.client_id, r.canal, `Resumo do dia ${diaLabel} %`],
          );
          if (ja) { gravados.push(`${r.canal}: já existia`); continue; }
          if (!dry) {
            await pool.query(
              `INSERT INTO public.otimizacao_registros
                 (client_id, user_id, user_name, canal, acoes, descricao, origem)
               VALUES ($1, NULL, $2, $3, $4, $5, 'resumo')`,
              [cliente.client_id, 'Resumo automático da conta', r.canal, r.acoes, r.descricao],
            );
          }
          gravados.push(`${r.canal}: ${r.totalEventos} evento(s)${dry ? ' (dry)' : ''}`);
        }
        resultados.push({
          client: cliente.name, dia, gravados,
          ...(dry ? { previa: resumos.map(r => ({ canal: r.canal, descricao: r.descricao })) } : {}),
        });
      } catch (err) {
        resultados.push({ client: cliente.name, erro: String(err).slice(0, 150) });
      }
    }

    const resumo = { ok: true, dia, dry, clientes: alvo.length, tookMs: Date.now() - inicio, resultados };
    console.log('[resumo-diario]', JSON.stringify({ ...resumo, resultados: resultados.length }));
    return Response.json(resumo);
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
