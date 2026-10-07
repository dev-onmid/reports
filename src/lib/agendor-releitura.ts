/**
 * Releitura diária do Agendor + conferência de totais.
 *
 * ⚠️ Por que existe: o sincronismo só relê negócio cujo `updatedAt` mudou, e
 * várias mudanças reais NÃO mexem no negócio — origem revisada na ficha da
 * empresa, opção de campo personalizado renomeada (Cinfel), e por vezes ganho
 * reaberto. Cada uma deixava a dashboard divergindo do Agendor em silêncio até
 * alguém comparar prints (Incorpast e Londrigifts, 07/10/2026).
 *
 * Como funciona, por conexão:
 *  - Uma VOLTA relê a listagem inteira de negócios, poucas páginas por rodada
 *    do cron (a conta da Londrigifts/Incorpast é compartilhada e vive no
 *    limite de requisições). Começa uma volta nova no máximo 1×/dia.
 *  - Cada negócio relido passa por `decidirReleitura`: só reingere o que
 *    difere (sempre pelo caminho de backfill — NUNCA dispara conversão), tira a
 *    receita de venda desfeita e remove o que saiu do filtro.
 *  - No fim da volta: negócio que não apareceu foi APAGADO no Agendor e sai
 *    (com trava contra listagem incompleta); depois a CONFERÊNCIA compara o
 *    total ganho no Agendor com o do sistema nos últimos 3 meses e avisa no
 *    sino se divergir. Correções feitas também vão para o sino.
 *
 * Decisão do Matheus: corrige sozinho e avisa. Toda linha alterada é copiada
 * antes para `agendor_leads_removidos`.
 */
import type { Pool } from 'pg';
import { normalizarNegocio, type NegocioAgendor, type PessoaAgendor } from '@/lib/agendor';
import { agendorFetch, AGENDOR_API, type ConexaoAgendor } from '@/lib/agendor-server';
import {
  bloqueioDefinitivo, buscarPessoaAgendor, conferirFiltros, copiarLinhaAgendor,
  ingerirNegocioAgendor, posProcessarIngestao, removerNegocioForaDoFiltro,
} from '@/lib/agendor-ingest';
import {
  compararTotais, decidirReleitura, mesDoGanho, mesesConferidos, sumicoSuspeito,
  type LinhaGravada,
} from '@/lib/agendor-releitura-regras';
import { upsertSinal } from '@/lib/notificacoes';

const PAGINAS_POR_RODADA = 3;
const POR_PAGINA = 100;
/** Intervalo mínimo entre o fim de uma volta e o começo da próxima. */
const INTERVALO_VOLTA_MS = 20 * 3_600_000;

type Correcoes = {
  novos: number; atualizados: number; desfeitas: number; removidos: number; manuais: number;
  exemplos: string[];
};
const zeradas = (): Correcoes => ({ novos: 0, atualizados: 0, desfeitas: 0, removidos: 0, manuais: 0, exemplos: [] });

export type ResumoReleitura = {
  paginas: number;
  correcoes: Correcoes;
  voltaConcluida: boolean;
  divergencias?: number;
  pulou?: string;
};

let schemaPronto = false;
async function ensureReleitura(pool: Pool) {
  if (schemaPronto) return;
  await pool.query(`
    ALTER TABLE public.agendor_connections
      ADD COLUMN IF NOT EXISTS releitura_pagina INT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS releitura_iniciada_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS releitura_concluida_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS releitura_correcoes JSONB`);
  await pool.query(`ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS agendor_visto_em TIMESTAMPTZ`);
  // Total ganho no Agendor por mês, acumulado durante a volta.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.agendor_releitura_soma (
      client_id TEXT NOT NULL,
      mes TEXT NOT NULL,
      valor NUMERIC NOT NULL DEFAULT 0,
      negocios INT NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, mes)
    )`);
  schemaPronto = true;
}

function anotar(c: Correcoes, chave: keyof Omit<Correcoes, 'exemplos'>, exemplo: string | null) {
  c[chave]++;
  if (exemplo && c.exemplos.length < 8) c.exemplos.push(exemplo);
}

/** Tira a receita de uma linha cujo negócio não está ganho no Agendor. */
async function desfazerVenda(pool: Pool, clientId: string, externalId: string, motivo: string) {
  await copiarLinhaAgendor(pool, clientId, externalId, `venda desfeita: ${motivo}`);
  await pool.query(
    `UPDATE public.crm_leads
        SET valor_rs = NULL, revenue = 0, fechado_em = NULL, fechou = FALSE, updated_at = NOW()
      WHERE client_id = $1 AND external_id = $2`,
    [clientId, externalId],
  );
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function passoReleituraAgendor(
  pool: Pool, conn: ConexaoAgendor, prazo: number,
): Promise<ResumoReleitura> {
  const r: ResumoReleitura = { paginas: 0, correcoes: zeradas(), voltaConcluida: false };
  if (!conn.api_token) return { ...r, pulou: 'sem_token' };
  await ensureReleitura(pool);

  const { rows: [estado] } = await pool.query<{
    releitura_pagina: number; releitura_iniciada_em: string | null;
    releitura_concluida_em: string | null; releitura_correcoes: Correcoes | null;
  }>(
    `SELECT releitura_pagina, releitura_iniciada_em, releitura_concluida_em, releitura_correcoes
       FROM public.agendor_connections WHERE client_id = $1`,
    [conn.client_id],
  );
  let pagina = estado?.releitura_pagina ?? 1;
  const correcoes: Correcoes = { ...zeradas(), ...(estado?.releitura_correcoes ?? {}) };

  if (pagina === 1) {
    const ultima = estado?.releitura_concluida_em ? new Date(estado.releitura_concluida_em).getTime() : 0;
    if (Date.now() - ultima < INTERVALO_VOLTA_MS) return { ...r, pulou: 'volta_do_dia_ja_feita' };
    // Volta nova: zera o acumulado e marca o início (base do "não apareceu").
    await pool.query(`DELETE FROM public.agendor_releitura_soma WHERE client_id = $1`, [conn.client_id]);
    await pool.query(
      `UPDATE public.agendor_connections
          SET releitura_iniciada_em = NOW(), releitura_correcoes = '{}'::jsonb WHERE client_id = $1`,
      [conn.client_id],
    );
    Object.assign(correcoes, zeradas());
  }

  const cachePessoas = new Map<string, PessoaAgendor | null>();
  let fimDaListagem = false;
  for (let i = 0; i < PAGINAS_POR_RODADA && Date.now() < prazo; i++) {
    const resp = await agendorFetch<{ data?: Record<string, unknown>[] }>(
      conn.api_token, `${AGENDOR_API}/deals?page=${pagina}&per_page=${POR_PAGINA}`);
    const brutos = resp?.data ?? [];
    const lote = brutos
      .map(b => ({ bruto: b, n: normalizarNegocio(b) }))
      .filter((x): x is { bruto: Record<string, unknown>; n: NegocioAgendor } => x.n !== null);

    const ids = lote.map(x => `agendor:${x.n.idExterno}`);
    if (ids.length > 0) {
      await pool.query(
        `UPDATE public.crm_leads SET agendor_visto_em = NOW()
          WHERE client_id = $1 AND external_id = ANY($2::text[])`,
        [conn.client_id, ids],
      );
    }
    const { rows: gravadas } = await pool.query<{
      external_id: string; valor: number; fechado_em: string | null;
      agendor_origem_pers: string | null; tem_ids: boolean;
    }>(
      `SELECT external_id, COALESCE(NULLIF(revenue, 0), valor_rs, 0)::float AS valor,
              fechado_em::text, agendor_origem_pers,
              (agendor_org_id IS NOT NULL OR agendor_pessoa_id IS NOT NULL) AS tem_ids
         FROM public.crm_leads WHERE client_id = $1 AND external_id = ANY($2::text[])`,
      [conn.client_id, ids],
    );
    const porId = new Map(gravadas.map(g => [g.external_id, g]));

    for (const { bruto, n } of lote) {
      const externalId = `agendor:${n.idExterno}`;
      const g = porId.get(externalId);
      const linha: LinhaGravada | null = g
        ? { valor: Number(g.valor), fechadoEm: g.fechado_em, origemPers: g.agendor_origem_pers, temIdsDeOrigem: g.tem_ids }
        : null;

      let pessoa: PessoaAgendor | null = null;
      if (n.pessoa.id) {
        if (!cachePessoas.has(n.pessoa.id)) {
          cachePessoas.set(n.pessoa.id, await buscarPessoaAgendor(conn.api_token, n.pessoa.id));
        }
        pessoa = cachePessoas.get(n.pessoa.id) ?? null;
      }
      const { negocio, bloqueado, pessoa: pessoaEfetiva } = await conferirFiltros(conn, n, pessoa);
      if (bloqueado) {
        if (g && bloqueioDefinitivo(bloqueado)) {
          const res = await removerNegocioForaDoFiltro(pool, conn.client_id, externalId, bloqueado);
          if (res === 'removido') anotar(correcoes, 'removidos', `${n.titulo ?? n.idExterno} (${bloqueado})`);
          else if (res === 'manual') anotar(correcoes, 'manuais', null);
        }
        continue;
      }

      // Total do Agendor para a conferência — só o que o filtro deixa entrar.
      if (negocio.status === 'ganho') {
        const mes = mesDoGanho(negocio.ganhoEm);
        if (mes) {
          await pool.query(
            `INSERT INTO public.agendor_releitura_soma (client_id, mes, valor, negocios)
             VALUES ($1, $2, $3, 1)
             ON CONFLICT (client_id, mes) DO UPDATE
               SET valor = agendor_releitura_soma.valor + EXCLUDED.valor,
                   negocios = agendor_releitura_soma.negocios + 1`,
            [conn.client_id, mes, negocio.valor ?? 0],
          );
        }
      }

      const statusExplicito = Boolean(
        (bruto.dealStatus as { name?: unknown } | undefined)?.name || bruto.wonAt || bruto.lostAt);
      const acao = decidirReleitura(negocio, linha, statusExplicito);
      if (acao.reingerir) {
        const res = await ingerirNegocioAgendor(pool, conn.client_id, negocio, pessoaEfetiva ?? pessoa,
          { apiToken: conn.api_token });
        await posProcessarIngestao(pool, conn, negocio, pessoa, res,
          { releitura: true, dealId: n.idExterno, motivo: acao.motivo }, 'backfill');
        // Só conta como correção o que MUDA número ou rótulo; preencher os ids
        // de origem de uma linha antiga é manutenção silenciosa.
        if (acao.motivo) {
          anotar(correcoes, res.criado ? 'novos' : 'atualizados',
            `${n.titulo ?? n.idExterno}: ${acao.motivo}`);
        }
      } else if (acao.desfazerVenda) {
        await desfazerVenda(pool, conn.client_id, externalId, acao.motivo ?? 'venda desfeita');
        anotar(correcoes, 'desfeitas', `${n.titulo ?? n.idExterno} (${brl(linha?.valor ?? 0)})`);
      }
    }

    r.paginas++;
    pagina++;
    if (brutos.length < POR_PAGINA) { fimDaListagem = true; break; }
  }

  // Progresso salvo a cada rodada: deploy ou timeout no meio não perde a volta.
  await pool.query(
    `UPDATE public.agendor_connections SET releitura_pagina = $2, releitura_correcoes = $3::jsonb
      WHERE client_id = $1`,
    [conn.client_id, fimDaListagem ? 1 : pagina, JSON.stringify(correcoes)],
  );
  r.correcoes = correcoes;
  if (!fimDaListagem) return r;

  // ── Fim da volta ───────────────────────────────────────────────────────
  r.voltaConcluida = true;
  const inicio = estado?.releitura_iniciada_em ?? new Date(0).toISOString();
  const { rows: sumidos } = await pool.query<{ external_id: string; nome: string | null; valor: number }>(
    `SELECT external_id, nome, COALESCE(NULLIF(revenue, 0), valor_rs, 0)::float AS valor
       FROM public.crm_leads
      WHERE client_id = $1 AND external_id LIKE 'agendor:%'
        AND (agendor_visto_em IS NULL OR agendor_visto_em < $2::timestamptz)`,
    [conn.client_id, inicio],
  );
  const { rows: [{ total }] } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM public.crm_leads WHERE client_id = $1 AND external_id LIKE 'agendor:%'`,
    [conn.client_id],
  );
  if (sumicoSuspeito(sumidos.length, total)) {
    await upsertSinal(pool, {
      tipo: 'sistema', severidade: 'atencao', clientId: conn.client_id,
      signalKey: `agendor-sumico:${conn.client_id}:${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Agendor: releitura viu menos negócios que o esperado',
      descricao: `${sumidos.length} de ${total} negócios não apareceram na listagem. Nada foi apagado — provável falha da API do Agendor; a próxima volta confere de novo.`,
      href: `/clientes/${conn.client_id}?tab=rastreio`,
    });
  } else {
    for (const s of sumidos) {
      const motivo = 'negócio apagado no Agendor';
      const res = await removerNegocioForaDoFiltro(pool, conn.client_id, s.external_id, motivo);
      if (res === 'removido') anotar(correcoes, 'removidos', `${s.nome ?? s.external_id} (${motivo})`);
      else if (res === 'manual' && s.valor > 0) {
        await desfazerVenda(pool, conn.client_id, s.external_id, motivo);
        anotar(correcoes, 'desfeitas', `${s.nome ?? s.external_id} (${motivo})`);
      }
    }
  }

  // Conferência dos últimos 3 meses: total ganho no Agendor × total no sistema.
  const meses = mesesConferidos(new Date());
  const { rows: somaAgendor } = await pool.query<{ mes: string; valor: number }>(
    `SELECT mes, valor::float FROM public.agendor_releitura_soma WHERE client_id = $1 AND mes = ANY($2::text[])`,
    [conn.client_id, meses],
  );
  const { rows: somaSistema } = await pool.query<{ mes: string; valor: number }>(
    `SELECT to_char(fechado_em, 'YYYY-MM') AS mes,
            SUM(COALESCE(NULLIF(revenue, 0), valor_rs, 0))::float AS valor
       FROM public.crm_leads
      WHERE client_id = $1 AND external_id LIKE 'agendor:%' AND fechado_em IS NOT NULL
        AND to_char(fechado_em, 'YYYY-MM') = ANY($2::text[])
      GROUP BY 1`,
    [conn.client_id, meses],
  );
  const divergencias = compararTotais(meses,
    new Map(somaAgendor.map(x => [x.mes, Number(x.valor)])),
    new Map(somaSistema.map(x => [x.mes, Number(x.valor)])));
  r.divergencias = divergencias.length;
  const hoje = new Date().toISOString().slice(0, 10);
  const prefixoConf = `agendor-conferencia:${conn.client_id}:`;
  if (divergencias.length > 0) {
    await upsertSinal(pool, {
      tipo: 'sistema', severidade: 'atencao', clientId: conn.client_id,
      signalKey: `${prefixoConf}${hoje}`,
      titulo: 'Faturamento diferente do Agendor',
      descricao: divergencias
        .map(d => `${d.mes}: Agendor ${brl(d.agendor)} · sistema ${brl(d.sistema)} (${d.diferenca > 0 ? '+' : ''}${brl(d.diferenca)})`)
        .join(' | '),
      href: `/clientes/${conn.client_id}?tab=rastreio`,
    });
  } else {
    await pool.query(
      `UPDATE public.notificacoes SET resolvido_em = NOW()
        WHERE signal_key LIKE $1 AND resolvido_em IS NULL`,
      [`${prefixoConf}%`],
    ).catch(() => {});
  }

  const mudou = correcoes.novos + correcoes.atualizados + correcoes.desfeitas + correcoes.removidos;
  if (mudou > 0) {
    const partes = [
      correcoes.novos && `${correcoes.novos} negócio(s) que faltavam`,
      correcoes.atualizados && `${correcoes.atualizados} atualizado(s)`,
      correcoes.desfeitas && `${correcoes.desfeitas} venda(s) desfeita(s)`,
      correcoes.removidos && `${correcoes.removidos} removido(s)`,
    ].filter(Boolean).join(', ');
    await upsertSinal(pool, {
      tipo: 'sistema', severidade: 'info', clientId: conn.client_id,
      signalKey: `agendor-correcoes:${conn.client_id}:${hoje}`,
      titulo: 'Agendor: dashboard corrigida automaticamente',
      descricao: `${partes}. Ex.: ${correcoes.exemplos.slice(0, 4).join('; ')}`,
      href: `/clientes/${conn.client_id}?tab=rastreio`,
    });
  }

  await pool.query(
    `UPDATE public.agendor_connections
        SET releitura_concluida_em = NOW(), releitura_pagina = 1, releitura_correcoes = $2::jsonb
      WHERE client_id = $1`,
    [conn.client_id, JSON.stringify(correcoes)],
  );
  r.correcoes = correcoes;
  return r;
}
