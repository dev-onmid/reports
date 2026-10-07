/**
 * Regras PURAS da releitura diária do Agendor (sem banco, sem rede) — o que a
 * rotina faz com cada negócio relido e como compara os totais. Separadas de
 * `agendor-releitura.ts` para serem testáveis sem Postgres nem API.
 *
 * Pedido do Matheus (07/10/2026), depois de a dashboard da Incorpast e da
 * Londrigifts divergir do relatório do Agendor: "como será para não ter mais
 * esses erros?". Decisão dele: o sistema CORRIGE SOZINHO e avisa.
 */
import type { NegocioAgendor } from '@/lib/agendor';

/** O que o banco tem hoje para um negócio do Agendor (`external_id = agendor:{id}`). */
export type LinhaGravada = {
  /** Receita gravada (COALESCE(NULLIF(revenue,0), valor_rs, 0)). */
  valor: number;
  /** fechado_em em 'AAAA-MM-DD' ou null. */
  fechadoEm: string | null;
  origemPers: string | null;
  temIdsDeOrigem: boolean;
};

export type AcaoReleitura = {
  /** Reingerir pelo caminho de backfill (cria ou atualiza; nunca dispara conversão). */
  reingerir: boolean;
  /** Tirar a receita de uma linha cujo negócio NÃO está ganho no Agendor. */
  desfazerVenda: boolean;
  motivo: string | null;
};

const dia = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/**
 * Decide o que fazer com um negócio relido. Só reingere quando algo DIFERE —
 * reingerir os ~10 mil negócios por dia gastaria tempo à toa.
 *
 * `statusExplicito`: o payload trouxe `dealStatus`/`wonAt`/`lostAt`. Sem isso
 * `statusDoNegocio` devolve 'andamento' por omissão, e desfazer venda nessa
 * base apagaria receita real.
 */
export function decidirReleitura(
  n: Pick<NegocioAgendor, 'status' | 'valor' | 'ganhoEm' | 'origemPersonalizada' | 'organizacaoId'> & {
    pessoa: { id: string | null };
  },
  linha: LinhaGravada | null,
  statusExplicito: boolean,
): AcaoReleitura {
  if (!linha) return { reingerir: true, desfazerVenda: false, motivo: 'ausente no sistema' };

  if (n.status === 'ganho') {
    const valor = n.valor ?? 0;
    if (Math.abs(linha.valor - valor) > 0.01) {
      return { reingerir: true, desfazerVenda: false, motivo: `valor ${linha.valor} → ${valor}` };
    }
    const d = dia(n.ganhoEm);
    if (d && linha.fechadoEm !== d) {
      return { reingerir: true, desfazerVenda: false, motivo: `data do ganho ${linha.fechadoEm ?? '—'} → ${d}` };
    }
  } else if (statusExplicito && linha.valor > 0) {
    return { reingerir: false, desfazerVenda: true, motivo: `venda desfeita no Agendor (${n.status})` };
  }

  // Opção de campo personalizado RENOMEADA no Agendor (caso Cinfel): não mexe
  // no negócio, só a releitura enxerga. Reingerir grava o nome novo e a
  // revisão de origem atualiza o canal.
  const pers = n.origemPersonalizada?.trim() || null;
  if (pers && pers !== (linha.origemPers?.trim() || null)) {
    return { reingerir: true, desfazerVenda: false, motivo: `origem renomeada para "${pers}"` };
  }
  if (!linha.temIdsDeOrigem && (n.organizacaoId || n.pessoa.id)) {
    return { reingerir: true, desfazerVenda: false, motivo: null };
  }
  return { reingerir: false, desfazerVenda: false, motivo: null };
}

/** Mês ('AAAA-MM') de um ganho — mesma régua do `fechado_em` gravado pela ingestão. */
export function mesDoGanho(ganhoEm: string | null): string | null {
  return ganhoEm ? ganhoEm.slice(0, 7) : null;
}

/** Os N meses que a conferência olha, do atual para trás: ['2026-10','2026-09','2026-08']. */
export function mesesConferidos(hoje: Date, n = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export type Divergencia = { mes: string; agendor: number; sistema: number; diferenca: number };

/** Compara os totais por mês. Diferença ≤ R$ 1 é arredondamento, não aviso. */
export function compararTotais(
  meses: string[],
  agendor: Map<string, number>,
  sistema: Map<string, number>,
): Divergencia[] {
  const out: Divergencia[] = [];
  for (const mes of meses) {
    const a = Math.round((agendor.get(mes) ?? 0) * 100) / 100;
    const s = Math.round((sistema.get(mes) ?? 0) * 100) / 100;
    if (Math.abs(a - s) > 1) out.push({ mes, agendor: a, sistema: s, diferenca: Math.round((s - a) * 100) / 100 });
  }
  return out;
}

/**
 * Trava contra apagar a base por engano: se um número grande de negócios
 * "sumiu" do Agendor numa volta, o mais provável é a listagem ter vindo
 * incompleta (erro da API), não o cliente ter apagado tudo.
 */
export function sumicoSuspeito(sumidos: number, total: number): boolean {
  return sumidos > 20 && sumidos > total * 0.05;
}
