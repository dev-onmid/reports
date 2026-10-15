/**
 * Persistência do funil da planilha (regras em `funil-planilha.ts`).
 *
 * A sincronização diária do Google Sheets já baixa a pasta inteira; aqui cada
 * aba de MÊS vira contagens por dia em `funil_planilha_dia`, e a dashboard soma
 * o período pedido. Aba que sumiu da planilha some daqui também.
 */
import type { Pool } from 'pg';
import type { WorkBook } from 'xlsx';
import { memoizarSchema } from '@/lib/schema-memo';
import { periodoDaAba } from '@/lib/google-sheets';
import {
  configFunilPlanilha, contarAbaPlanilha, montarFunilPlanilha, type FunilPlanilha,
} from '@/lib/funil-planilha';

const ensureFunilPlanilha = memoizarSchema(async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.funil_planilha_dia (
      client_id TEXT NOT NULL,
      aba TEXT NOT NULL,
      dia DATE NOT NULL,
      etapas INT[] NOT NULL,
      desvios INT[] NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, aba, dia)
    )`);
});

type Utils = { sheet_to_json: <T>(ws: unknown, o: { header: 1; defval: string }) => T[] };

export async function gravarFunilPlanilha(
  pool: Pool, clientId: string, wb: WorkBook, utils: Utils,
): Promise<{ abas: number; linhas: number; avisos: string[] } | null> {
  const cfg = configFunilPlanilha(clientId);
  if (!cfg) return null;
  await ensureFunilPlanilha(pool);
  const avisos: string[] = [];
  const vistas: string[] = [];
  let linhas = 0;

  for (const aba of wb.SheetNames) {
    const periodo = periodoDaAba(aba);
    // Só aba de mês COM ano: aba-resumo ("FUNIL ATUAL"), "CADASTROS" e lista
    // corrida ("LEADS 26 Á 25") repetiriam os mesmos leads.
    if (!periodo || periodo.ano < 2000) continue;
    const c = contarAbaPlanilha(utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, defval: '' }), cfg, periodo);
    if (!c) continue;
    // ⚠️ Aba sem as colunas de algum degrau NÃO entra: o degrau sairia zerado e
    // o funil diria "nenhum contato feito" num mês em que só não havia a coluna
    // (Romanza: jan–jul/2024 sem as colunas de contato, ago/2025 com o STATUS
    // sem cabeçalho). Sem dado do mês, a dashboard volta ao funil do CRM.
    if (c.colunasAusentes.length) {
      avisos.push(`${aba} fora do funil: sem ${c.colunasAusentes.join('/')}`);
      continue;
    }
    vistas.push(aba);
    linhas += c.linhas;

    await pool.query('BEGIN');
    try {
      await pool.query(`DELETE FROM public.funil_planilha_dia WHERE client_id = $1 AND aba = $2`, [clientId, aba]);
      for (const [dia, etapas] of c.porDia) {
        await pool.query(
          `INSERT INTO public.funil_planilha_dia (client_id, aba, dia, etapas, desvios)
           VALUES ($1, $2, $3::date, $4::int[], $5::int[])`,
          [clientId, aba, dia, etapas, c.desviosPorDia.get(dia) ?? cfg.desvios.map(() => 0)],
        );
      }
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      avisos.push(`${aba}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
    }
  }
  // Aba apagada ou renomeada na planilha não pode continuar somando.
  await pool.query(
    `DELETE FROM public.funil_planilha_dia WHERE client_id = $1 AND NOT (aba = ANY($2::text[]))`,
    [clientId, vistas],
  );
  return { abas: vistas.length, linhas, avisos };
}

/**
 * Funil da planilha no período, por cliente. Só devolve quem tem regra E dado
 * no período — os demais seguem no funil do CRM.
 */
export async function lerFunilPlanilha(
  pool: Pool, clientIds: string[], from: string | null, to: string | null,
): Promise<Map<string, FunilPlanilha>> {
  const out = new Map<string, FunilPlanilha>();
  const comRegra = clientIds.filter(id => configFunilPlanilha(id));
  if (comRegra.length === 0) return out;
  await ensureFunilPlanilha(pool);
  const { rows } = await pool.query<{ client_id: string; etapas: number[]; desvios: number[] }>(
    `SELECT client_id, etapas, desvios FROM public.funil_planilha_dia
      WHERE client_id = ANY($1::text[])
        AND ($2::date IS NULL OR dia >= $2::date)
        AND ($3::date IS NULL OR dia <= $3::date)`,
    [comRegra, from, to],
  );
  const somas = new Map<string, { e: number[]; d: number[] }>();
  for (const r of rows) {
    const s = somas.get(r.client_id) ?? { e: [], d: [] };
    r.etapas.forEach((v, i) => { s.e[i] = (s.e[i] ?? 0) + Number(v); });
    r.desvios.forEach((v, i) => { s.d[i] = (s.d[i] ?? 0) + Number(v); });
    somas.set(r.client_id, s);
  }
  for (const [id, s] of somas) {
    const cfg = configFunilPlanilha(id)!;
    if ((s.e[0] ?? 0) > 0) out.set(id, montarFunilPlanilha(cfg, s.e, s.d));
  }
  return out;
}
