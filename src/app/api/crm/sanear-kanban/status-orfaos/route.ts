import type { NextRequest } from 'next/server';
import { ensureDefaultFunnel } from '@/lib/crm-conversation-sync';
import { makeServerPool } from '@/lib/server-db';
import { planejarStatusOrfaos, type ColunaExistente } from '@/lib/crm-status-orfao';

export const maxDuration = 300;

/**
 * Faz aparecer no Kanban os leads cujo `status` não tem coluna — medido em 16/09/2026:
 * 10.148 leads em 10 clientes, invisíveis para o gestor. Ver src/lib/crm-status-orfao.ts.
 *
 * `?dry=1` mostra o plano inteiro sem tocar em nada, e `?clientId=` limita a um cliente
 * (usado para aplicar num só antes de soltar na carteira toda).
 */

const SEGREDOS = ['CRON_SECRET', 'REPORTS_CRON_SECRET', 'CRM_CRON_SECRET'] as const;
function autorizado(req: NextRequest): boolean {
  const dado = new URL(req.url).searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return !!dado && SEGREDOS.some(k => { const v = process.env[k]; return !!v && v === dado; });
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'não autorizado' }, { status: 401 });
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const soCliente = url.searchParams.get('clientId');

  const pool = makeServerPool();
  const relatorio: Record<string, unknown>[] = [];
  const falhas: string[] = [];
  try {
    const { rows: alvos } = await pool.query<{ client_id: string; nome: string }>(
      `SELECT DISTINCT l.client_id, COALESCE(c.name, l.client_id) AS nome
         FROM public.crm_leads l LEFT JOIN public.clients c ON c.id = l.client_id
        WHERE COALESCE(l.status,'') <> ''
          AND ($1::text IS NULL OR l.client_id = $1)
          AND NOT EXISTS (
            SELECT 1 FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id
             WHERE f.client_id = l.client_id AND lower(trim(s.label)) = lower(trim(l.status)))
        ORDER BY nome`,
      [soCliente],
    );

    for (const alvo of alvos) {
      const { rows: orfaos } = await pool.query<{ status: string; leads: number }>(
        `SELECT l.status, COUNT(*)::int AS leads FROM public.crm_leads l
          WHERE l.client_id = $1 AND COALESCE(l.status,'') <> ''
            AND NOT EXISTS (
              SELECT 1 FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id
               WHERE f.client_id = l.client_id AND lower(trim(s.label)) = lower(trim(l.status)))
          GROUP BY l.status`,
        [alvo.client_id],
      );

      // leads por coluna: é o que decide se uma coluna pode ser excluída
      const { rows: colunas } = await pool.query<ColunaExistente & { funnel_id: string }>(
        `SELECT s.id, s.funnel_id, s.label,
                (SELECT COUNT(*)::int FROM public.crm_leads l
                  WHERE l.client_id = $1 AND lower(trim(l.status)) = lower(trim(s.label))) AS leads
           FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id
          WHERE f.client_id = $1 ORDER BY s.position`,
        [alvo.client_id],
      );
      if (!colunas.length) {
        // ⚠️ Sorrifácil Valinhos: 278 leads e NENHUM funil — board totalmente vazio, não
        // é caso de status órfão. Sem o funil padrão, nada aqui teria onde encaixar.
        if (!dry) {
          await ensureDefaultFunnel(pool, alvo.client_id)
            .catch(e => falhas.push(`${alvo.nome} criar funil: ${(e as Error).message}`));
        }
        relatorio.push({ cliente: alvo.nome, criou_funil_padrao: true });
        continue;
      }

      // ⚠️ A coluna de perdido é a do cliente, não um nome fixo: uns chamam
      // "Desqualificado", outros "Sem Interesse". Pega pelo GRAU, com o rótulo como
      // desempate — e se não houver nenhuma, o descarte vira coluna normal (o plano
      // trata `null`), em vez de o lead continuar invisível.
      const { rows: [perdido] } = await pool.query<{ label: string }>(
        `SELECT s.label FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id
          WHERE f.client_id = $1
            AND (s.etapa_funil = 'perdido' OR lower(trim(s.label)) IN ('desqualificado','sem interesse','perdido'))
          ORDER BY (s.etapa_funil = 'perdido') DESC, s.position ASC LIMIT 1`,
        [alvo.client_id],
      ).catch(() => ({ rows: [] as Array<{ label: string }> }));

      const plano = planejarStatusOrfaos(orfaos, colunas, perdido?.label ?? null);
      relatorio.push({
        cliente: alvo.nome,
        corrigir_grafia: plano.corrigirGrafia.map(g => `${g.leads}× "${g.statusAtual}" → "${g.paraRotulo}"`),
        criar_colunas: plano.criarColunas.map(c => `${c.label} (${c.etapa}, ${c.leads} leads)`),
        canal_vira_entrada: plano.viraEntrada.map(v => `${v.leads}× "${v.statusAtual}"`),
        descarte_agrupado: plano.viraDescarte.map(v => `${v.leads}× "${v.statusAtual}" → "${v.paraRotulo}"`),
        excluir_vazias: plano.excluirVazias.map(e => e.label),
      });
      if (dry) continue;

      const funnelId = colunas[0].funnel_id;
      let pos = colunas.length;

      for (const g of plano.corrigirGrafia) {
        await pool.query(
          `UPDATE public.crm_leads SET status = $3, updated_at = NOW()
            WHERE client_id = $1 AND status = $2`,
          [alvo.client_id, g.statusAtual, g.paraRotulo],
        ).catch(e => falhas.push(`${alvo.nome} grafia "${g.statusAtual}": ${(e as Error).message}`));
      }
      // ⚠️ Status que é CANAL: o lead vai para a ENTRADA (primeira coluna) e o canal é
      // preservado. Medido: os 385 já têm o canal completo no campo certo — o status era
      // duplicata da origem. `acrescentarCanal` só age se o campo estiver vazio, e mesmo
      // aí ACRESCENTA: o sistema é multicanal ("Facebook - WhatsApp" em 13.448 leads) e
      // sobrescrever apagaria um canal legítimo.
      for (const v of plano.viraDescarte) {
        await pool.query(
          `UPDATE public.crm_leads SET status = $3, updated_at = NOW()
            WHERE client_id = $1 AND status = $2`,
          [alvo.client_id, v.statusAtual, v.paraRotulo],
        ).catch(e => falhas.push(`${alvo.nome} descarte "${v.statusAtual}": ${(e as Error).message}`));
      }

      const entrada = colunas[0].label;
      for (const v of plano.viraEntrada) {
        await pool.query(
          `UPDATE public.crm_leads
              SET canal = CASE WHEN COALESCE(canal,'') = '' THEN $3 ELSE canal END,
                  status = $4, updated_at = NOW()
            WHERE client_id = $1 AND status = $2`,
          [alvo.client_id, v.statusAtual, v.statusAtual, entrada],
        ).catch(e => falhas.push(`${alvo.nome} canal "${v.statusAtual}": ${(e as Error).message}`));
      }

      for (const c of plano.criarColunas) {
        await pool.query(
          // ⚠️ client_id é NOT NULL aqui — foi o que derrubou a migração do Engajado hoje.
          `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [funnelId, alvo.client_id, c.label, c.cor, pos++, c.etapa],
        ).catch(e => falhas.push(`${alvo.nome} coluna "${c.label}": ${(e as Error).message}`));
      }
      for (const e of plano.excluirVazias) {
        await pool.query(`DELETE FROM public.crm_stages WHERE id = $1`, [e.id])
          .catch(err => falhas.push(`${alvo.nome} excluir "${e.label}": ${(err as Error).message}`));
      }
    }

    return Response.json(
      { ok: falhas.length === 0, dry, clientes: relatorio.length, relatorio, falhas: falhas.length ? falhas : undefined },
      { status: falhas.length ? 500 : 200 },
    );
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error)?.message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
