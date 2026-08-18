/**
 * Resumo do dia — compila as atividades da conta de anúncio (Meta/Google) em
 * UM texto por canal, pro registro automático no Histórico.
 *
 * A régua do "igual é no log, só que compilado no dia" (pedido do Matheus):
 * em vez de 40 linhas de "alterou orçamento" repetidas, o registro diz
 * "Orçamento alterado ×12 · por Fulano e Sicrano". Agrupamento por
 * (descrição normalizada + autor); campanhas citadas viram amostra.
 *
 * Pura e client-safe — testável sem banco.
 */

import type { EventoConta } from '@/lib/atividade-conta';

export type ResumoCanal = {
  canal: 'meta' | 'google';
  totalEventos: number;
  autores: string[];
  descricao: string;
  /** Slugs do catálogo ACOES_OTIMIZACAO inferidos — viram chips na UI. */
  acoes: string[];
};

/** descrição → slug do catálogo (chips do Histórico). Sem casar → sem chip. */
function inferirAcao(desc: string): string | null {
  const d = desc.toLowerCase();
  if (/or[çc]amento|budget/.test(d)) return 'orcamento';
  if (/pausou campanha|campanha pausada|campaign.*paus/.test(d)) return 'campanha_pausada';
  if (/criou campanha|campanha criada|create.*campaign|criou campaign/.test(d)) return 'campanha_nova';
  if (/criativo|ad criad|criou ad|anúncio|anuncio|\bad\b/.test(d)) return 'criativos_novos';
  if (/lance|bid|estrat[ée]gia/.test(d)) return 'lance';
  if (/p[úu]blico|audi[êe]ncia|segmenta/.test(d)) return 'publico';
  if (/palavra|keyword/.test(d)) return 'keywords';
  return null;
}

/** Normaliza a descrição pro agrupamento (Meta repete o mesmo texto N vezes). */
function chaveDoGrupo(ev: EventoConta): string {
  return `${ev.descricao.trim().toLowerCase()}|${ev.autor.trim().toLowerCase()}`;
}

const MAX_LINHAS = 12;

export function compilarResumoDoDia(eventos: EventoConta[], diaLabel: string): ResumoCanal[] {
  const porCanal = new Map<'meta' | 'google', EventoConta[]>();
  for (const ev of eventos) {
    if (!porCanal.has(ev.plataforma)) porCanal.set(ev.plataforma, []);
    porCanal.get(ev.plataforma)!.push(ev);
  }

  const resumos: ResumoCanal[] = [];
  for (const [canal, evs] of porCanal) {
    if (evs.length === 0) continue;

    const grupos = new Map<string, { desc: string; autor: string; vezes: number; campanhas: Set<string> }>();
    for (const ev of evs) {
      const k = chaveDoGrupo(ev);
      const g = grupos.get(k) ?? { desc: ev.descricao.trim(), autor: ev.autor.trim(), vezes: 0, campanhas: new Set<string>() };
      g.vezes += 1;
      if (ev.campanha) g.campanhas.add(ev.campanha);
      grupos.set(k, g);
    }

    const ordenados = [...grupos.values()].sort((a, b) => b.vezes - a.vezes);
    const linhas = ordenados.slice(0, MAX_LINHAS).map(g => {
      const vezes = g.vezes > 1 ? ` ×${g.vezes}` : '';
      const camp = g.campanhas.size > 0
        ? ` (${[...g.campanhas].slice(0, 2).join(', ')}${g.campanhas.size > 2 ? '…' : ''})`
        : '';
      return `• ${g.desc}${vezes}${camp} — ${g.autor}`;
    });
    const omitidos = ordenados.length - MAX_LINHAS;
    if (omitidos > 0) linhas.push(`• … e mais ${omitidos} tipo(s) de ação`);

    const autores = [...new Set(ordenados.map(g => g.autor))];
    const acoes = [...new Set(ordenados.map(g => inferirAcao(g.desc)).filter((a): a is string => a !== null))];

    resumos.push({
      canal,
      totalEventos: evs.length,
      autores,
      acoes,
      descricao: `Resumo do dia ${diaLabel} — ${evs.length} ação(ões) na conta:\n${linhas.join('\n')}`,
    });
  }
  return resumos.sort((a, b) => a.canal.localeCompare(b.canal));
}
