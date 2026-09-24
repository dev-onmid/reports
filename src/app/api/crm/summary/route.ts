import type { NextRequest } from 'next/server';
import { parseRecorte, filtroRegiaoSql, type ContagemRegioes } from '@/lib/regiao-recorte';
import { ENSURE_COLUNAS_CONTAGEM, leadContaSql, rastroPagoSql } from '@/lib/lead-contagem';
import { makeServerPool } from '@/lib/server-db';
import {
  contarFunil,
  contarFunilPorStage,
  type ContagemFunil,
  type EtapaDeStage,
  type EtapaFunil,
  type FunilPorStage,
  type LeadParaFunil,
  type StageKanban,
} from '@/lib/funil-etapas';

/**
 * Funil de Performance por cliente — contagens CUMULATIVAS por etapa semântica.
 *
 * A tradução status→etapa deixou de ser a lista hardcoded de rótulos padrão
 * (que zerava Agendamentos/Comparecimentos pra qualquer cliente com etapas
 * próprias) e passou a vir do mapeamento do PRÓPRIO cliente: cada `crm_stages`
 * carrega `etapa_funil`, com auto-classificação por regex como default.
 * Toda a lógica vive em src/lib/funil-etapas.ts — esta rota é só I/O.
 *
 * Shape: Array<{ clientId, leads, funil: ContagemFunil, total }>.
 * `leads` = base inteira (topo do funil); `total` = receita dos fechados
 * (nome mantido do shape antigo). Consumidores: dashboard e /resultados.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  // Recorte por região ("uf:PR" | "cidade:Curitiba"): filtra o funil pela
  // região do LEAD. As contagens de região (`regioes`) saem SEM o filtro —
  // são as opções da tela, e sumir as outras ao escolher uma travaria o chip.
  const recorte = parseRecorte(url.searchParams.get('regiao'));

  const pool = makeServerPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.crm_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS data DATE,
        ADD COLUMN IF NOT EXISTS lead_date DATE,
        ADD COLUMN IF NOT EXISTS data_agendada DATE,
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS funnel_id UUID,
        ADD COLUMN IF NOT EXISTS agendou BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS compareceu BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
        ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS registro_tipo TEXT DEFAULT 'hibrido',
        ADD COLUMN IF NOT EXISTS data_fechamento DATE,
        ADD COLUMN IF NOT EXISTS fechado_em DATE
    `);
    await pool.query(ENSURE_COLUNAS_CONTAGEM);

    const params: (string | null)[] = [];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      // Data de referência POR REGISTRO: venda janela por data de fechamento
      // (data_fechamento), lead/hibrido por data de cadastro (lead_date/data).
      // Como data_fechamento é NULL em tudo que já existe, o comportamento
      // antigo é preservado — só o ledger de vendas passa a filtrar pelo
      // fechamento, que é o que o Matheus pediu ("venda = período de fechamento").
      // Lead sem data fica DENTRO: planilhas chegam sem a coluna preenchida e
      // sumir com eles esvaziaria o funil de quem mais precisa dele.
      dateFilter = `AND (COALESCE(data_fechamento, lead_date, data) IS NULL OR (COALESCE(data_fechamento, lead_date, data) >= $1 AND COALESCE(data_fechamento, lead_date, data) <= $2))`;
    }

    const regiaoSql = filtroRegiaoSql(recorte, params.length + 1);
    const { rows } = await pool.query(
      `SELECT client_id,
              status,
              funnel_id,
              agendou,
              data_agendada,
              COALESCE(lead_date, data) AS data_lead,
              compareceu,
              COALESCE(registro_tipo, 'hibrido') AS registro_tipo,
              (fechou OR COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0) AS fechou,
              COALESCE(NULLIF(revenue, 0), valor_rs, 0) AS valor_rs,
              ${rastroPagoSql()} AS rastreado
         FROM public.crm_leads
        -- A LEI (lead-contagem.ts): planilha/CRM externo/formulário contam sempre;
        -- chat só com rastro pago; manual não conta.
        WHERE ${leadContaSql()} ${dateFilter}${regiaoSql.sql}`,
      [...params, ...regiaoSql.params]
    );

    // O que a lei DEIXOU DE FORA (conversas do chat sem rastro + manuais) e
    // quantos leads têm porta validada — a tela mostra o primeiro e usa o
    // segundo para decidir o topo do funil (Lei 3: sem porta validada, topo
    // vem das plataformas). Ambos na janela, sem o recorte de região.
    const contagemPorCliente = new Map<string, { fora: number; validados: number }>();
    try {
      const { rows: cont } = await pool.query(
        `SELECT client_id,
                COUNT(*) FILTER (WHERE NOT ${leadContaSql()})::int AS fora,
                -- "validados" = leads que CONTAM (Lei 3): decide se o topo do funil é o CRM.
                -- Cliente só-chat (sem importação) tem contatos > 0 aqui e o topo é o CRM dele.
                COUNT(*) FILTER (WHERE ${leadContaSql()})::int AS validados
           FROM public.crm_leads
          WHERE COALESCE(registro_tipo, 'hibrido') <> 'venda' ${dateFilter}
          GROUP BY client_id`,
        params
      );
      for (const r of cont) contagemPorCliente.set(String(r.client_id), { fora: r.fora, validados: r.validados });
    } catch (e) { console.error('[crm summary] contagem fora/validados', e); }

    // Lei 5: vendas fechadas NA JANELA, separadas por quando o lead COMEÇOU
    // (dentro do período × antes dele). Só entra quem tem data de fechamento;
    // o resto vai em `semData` — não dá pra colocar no tempo.
    const cohortPorCliente = new Map<string, { periodo: number; anteriores: number; semData: number }>();
    if (from && to) {
      try {
        const { rows: coh } = await pool.query(
          `SELECT client_id,
                  COUNT(*) FILTER (WHERE fechou_em IS NOT NULL AND ini >= $1 AND ini <= $2)::int AS periodo,
                  COUNT(*) FILTER (WHERE fechou_em IS NOT NULL AND ini < $1)::int AS anteriores,
                  COUNT(*) FILTER (WHERE fechou_em IS NULL AND ini >= $1 AND ini <= $2)::int AS sem_data
             FROM (SELECT client_id,
                          COALESCE(lead_date, data, created_at::date) AS ini,
                          COALESCE(fechado_em, data_fechamento) AS fechou_em
                     FROM public.crm_leads
                    WHERE COALESCE(registro_tipo, 'hibrido') <> 'venda'
                      AND (fechou = TRUE OR COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0)
                      AND ${leadContaSql()}) x
            WHERE fechou_em IS NULL OR (fechou_em >= $1 AND fechou_em <= $2)
            GROUP BY client_id`,
          [from, to]
        );
        for (const r of coh) cohortPorCliente.set(String(r.client_id), { periodo: r.periodo, anteriores: r.anteriores, semData: r.sem_data });
      } catch (e) { console.error('[crm summary] cohort de vendas', e); }
    }

    // Contagem de região por cliente NA JANELA, sem o recorte: alimenta os
    // chips. Registro de venda (ledger) fica fora — não é pessoa.
    const regioesPorCliente = new Map<string, ContagemRegioes>();
    try {
      const { rows: reg } = await pool.query(
        `SELECT client_id, UPPER(regiao_uf) AS uf, regiao_cidade AS cidade, COUNT(*)::int AS n
           FROM public.crm_leads
          WHERE COALESCE(registro_tipo, 'hibrido') <> 'venda' AND ${leadContaSql()} ${dateFilter}
          GROUP BY 1, 2, 3`,
        params
      );
      for (const r of reg) {
        const cid = String(r.client_id);
        const c = regioesPorCliente.get(cid) ?? { total: 0, uf: {}, cidade: {} };
        c.total += r.n;
        if (r.uf) c.uf[r.uf] = (c.uf[r.uf] ?? 0) + r.n;
        if (r.cidade) c.cidade[r.cidade] = (c.cidade[r.cidade] ?? 0) + r.n;
        regioesPorCliente.set(cid, c);
      }
    } catch {
      // sem as colunas de região → sem chips
    }

    // Mapeamento etapa→semântica de todos os clientes numa query só (tabela
    // pequena). Instalação sem a tabela/coluna degrada pra lista vazia — o
    // contarFunil então classifica pelo texto do status, que já cobre o
    // vocabulário de planilha.
    const stagesPorCliente = new Map<string, EtapaDeStage[]>();
    // Etapas REAIS do Kanban (com posição/cor) para o funil personalizado por
    // cliente — o que a dashboard usa quando há um cliente só selecionado.
    const kanbanPorCliente = new Map<string, StageKanban[]>();
    try {
      const { rows: stageRows } = await pool.query(
        `SELECT client_id, funnel_id, label, etapa_funil, situacao, position FROM public.crm_stages`
      );
      for (const s of stageRows) {
        const cid = String(s.client_id);
        const etapa = (s.etapa_funil ?? null) as EtapaFunil | null;
        const funnelId = String(s.funnel_id);
        const label = String(s.label ?? '');
        if (!stagesPorCliente.has(cid)) stagesPorCliente.set(cid, []);
        stagesPorCliente.get(cid)!.push({ funnelId, label, etapa, situacao: (s.situacao ?? null) as EtapaDeStage['situacao'] });
        if (!kanbanPorCliente.has(cid)) kanbanPorCliente.set(cid, []);
        kanbanPorCliente.get(cid)!.push({ funnelId, label, etapa, position: Number(s.position) || 0 });
      }
    } catch {
      // sem crm_stages (ou sem a coluna etapa_funil ainda) → auto-classificação pura
    }

    // Última vez que o CRM de cada cliente RECEBEU dado (lead novo ou
    // atualizado), fora do filtro de período: é o "atualizado há N" do selo de
    // frescor no topo da dashboard. Best-effort — sem a coluna, fica null.
    const ultimaPorCliente = new Map<string, string>();
    try {
      const { rows: ult } = await pool.query(
        `SELECT client_id, MAX(GREATEST(COALESCE(updated_at, created_at), created_at)) AS ultima
           FROM public.crm_leads GROUP BY client_id`
      );
      for (const r of ult) if (r.ultima) ultimaPorCliente.set(String(r.client_id), new Date(r.ultima).toISOString());
    } catch {
      // sem updated_at/created_at → sem selo de CRM
    }

    const leadsPorCliente = new Map<string, LeadParaFunil[]>();
    for (const row of rows) {
      const cid = String(row.client_id);
      if (!leadsPorCliente.has(cid)) leadsPorCliente.set(cid, []);
      leadsPorCliente.get(cid)!.push({
        status: row.status ?? null,
        funnelId: row.funnel_id ? String(row.funnel_id) : null,
        agendou: row.agendou === true,
        dataAgendada: row.data_agendada ? String(row.data_agendada) : null,
        // Agendamento anterior ao próprio lead é mês digitado errado — a lib
        // descarta. Sem esta coluna a checagem não teria com o que comparar.
        dataLead: row.data_lead ? String(row.data_lead) : null,
        compareceu: row.compareceu === true,
        fechou: row.fechou === true,
        receita: Number(row.valor_rs) || 0,
        rastreado: row.rastreado === true,
        tipo: (row.registro_tipo as 'lead' | 'venda' | 'hibrido') ?? 'hibrido',
      });
    }

    // União: cliente com ZERO leads no recorte continua na resposta (funil
    // zerado + suas `regioes`), senão os chips sumiriam junto e não daria
    // para desfazer o filtro.
    const clientes = new Set<string>([...leadsPorCliente.keys(), ...regioesPorCliente.keys(), ...contagemPorCliente.keys()]);
    return Response.json(
      [...clientes].map((clientId) => {
        const leads = leadsPorCliente.get(clientId) ?? [];
        const funil: ContagemFunil = contarFunil(leads, stagesPorCliente.get(clientId) ?? []);
        // Funil pelas ETAPAS REAIS do Kanban do cliente. `null` quando o cliente
        // não tem etapas cadastradas → a dashboard cai no funil semântico.
        const porStage: FunilPorStage = contarFunilPorStage(kanbanPorCliente.get(clientId) ?? [], leads);
        return {
          clientId,
          /** Base inteira do cliente — topo do funil quando a fonte é CRM. */
          leads: funil.contatos,
          funil,
          /** Etapas reais do Kanban (nome/cor/ordem/contagem) ou null. */
          funilStages: porStage.degraus.length ? porStage : null,
          /** Receita dos fechados (nome herdado do shape antigo). */
          total: funil.receita,
          /** ISO da última entrada/atualização de lead deste cliente (selo de frescor). */
          ultimaAtualizacao: ultimaPorCliente.get(clientId) ?? null,
          /** Leads por UF/cidade na janela (sem o recorte) — opções do filtro de região. */
          regioes: regioesPorCliente.get(clientId) ?? null,
          /** Conversas do chat sem rastro pago (+ manuais) que a lei deixou fora, na janela. */
          conversasFora: contagemPorCliente.get(clientId)?.fora ?? 0,
          /** Leads com porta validada (planilha/CRM externo/formulário) na janela — 0 ⇒ topo vem das plataformas. */
          leadsValidados: contagemPorCliente.get(clientId)?.validados ?? 0,
          /** Lei 5: vendas fechadas na janela por quando o lead começou. */
          vendasCohort: cohortPorCliente.get(clientId) ?? null,
        };
      })
    );
  } catch (err) {
    // [] mantém os consumidores de pé, mas o silêncio total escondia falha de
    // banco como "funil zerado" — agora ao menos fica no log.
    console.error('[crm summary]', err);
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
