import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { fetchLatestAudit } from '@/lib/crm-attendance-audit';

// Relatório de atendimento: as notas 0–5 que a rotina diária dá por lead,
// separadas em piores / intermediários / melhores, cada uma com o trecho da
// conversa (o "print"), o porquê e o ajuste — mais os pontos de atenção da
// última auditoria do cliente.
//
// ⚠️ O período é pela data do ATENDIMENTO avaliado (última mensagem do trecho),
// não pela data em que a rotina deu a nota: a nota é refeita quando a conversa
// anda, e a data da avaliação diria "hoje" para tudo.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function periodo(sp: URLSearchParams) {
  const month = sp.get('month');
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  }
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const from = sp.get('from'); const to = sp.get('to');
  return {
    from: from && ISO.test(from) ? from : new Date(Date.now() - 3 * 3600e3 - 29 * 86400e3).toISOString().slice(0, 10),
    to: to && ISO.test(to) ? to : hoje,
  };
}

export type ItemRelatorioAtendimento = {
  id: string; nome: string | null; canal: string | null; status: string | null;
  nota: number; motivo: string | null; ajuste: string | null;
  trecho: { d: 'in' | 'out'; em: string; t: string | null; autor?: string | null }[];
  quando: string | null;
};

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const clientId = sp.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const { from, to } = periodo(sp);
  const pool = makeServerPool();
  try {
    const { rows: [cli] } = await pool.query(`SELECT name FROM public.clients WHERE id = $1`, [clientId]);
    if (!cli) return Response.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    const temColuna = (await pool.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'crm_leads' AND column_name = 'nota_atendimento_trecho'`)).rowCount;
    const itens: ItemRelatorioAtendimento[] = temColuna ? (await pool.query(
      `SELECT id::text, nome, canal, status, nota_atendimento AS nota, nota_atendimento_motivo AS motivo,
              nota_atendimento_ajuste AS ajuste, nota_atendimento_trecho AS trecho,
              nota_atendimento_trecho->-1->>'em' AS quando
         FROM public.crm_leads
        WHERE client_id = $1 AND nota_atendimento IS NOT NULL AND jsonb_typeof(nota_atendimento_trecho) = 'array'
          AND COALESCE(time_interno, false) = false
          AND (nota_atendimento_trecho->-1->>'em')::timestamptz >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND (nota_atendimento_trecho->-1->>'em')::timestamptz <  (($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        ORDER BY nota_atendimento, (nota_atendimento_trecho->-1->>'em') DESC`,
      [clientId, from, to])).rows : [];

    const distribuicao = [0, 1, 2, 3, 4, 5].map(n => itens.filter(i => i.nota === n).length);
    const media = itens.length ? Math.round((itens.reduce((s, i) => s + i.nota, 0) / itens.length) * 10) / 10 : null;
    const piores = itens.filter(i => i.nota <= 1).slice(0, 8);
    // Intermediários: os 2 primeiro (são os que mais ensinam), depois os 3.
    const intermediarios = itens.filter(i => i.nota === 2 || i.nota === 3).slice(0, 6);
    const melhores = itens.filter(i => i.nota >= 4).sort((a, b) => b.nota - a.nota).slice(0, 6);

    const audit = await fetchLatestAudit(pool, clientId).catch(() => null);
    return Response.json({
      cliente: cli.name, from, to, total: itens.length, media, distribuicao,
      piores, intermediarios, melhores,
      auditoria: audit ? {
        nota_geral: audit.result.nota_geral, classificacao: audit.result.classificacao,
        resumo: audit.result.resumo_semana, problemas: audit.result.principais_problemas ?? [],
        plano: audit.result.plano_acao ?? null, criada_em: audit.createdAt,
      } : null,
    });
  } catch (err) {
    console.error('[crm/attendance/relatorio]', err);
    return Response.json({ error: 'Erro ao montar o relatório.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
