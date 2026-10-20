// Filtro de origem do CRM (Kanban/lista), pedido do Matheus em 2026-10-20:
// "quero poder selecionar de forma fácil se quero ver todos os leads ou só de
// uma origem específica. Carregar mais de 2.700 leads também não dá."
//
// Duas regras sustentam o desenho:
//
// 1. O padrão continua sendo "Tráfego": o que conta no dashboard (leadContaSql)
//    mais o lead criado à mão no CRM (porta 'manual'), que nunca pode sumir da
//    tela de quem acabou de criá-lo. É o mesmo volume que o CRM carregava antes.
//
// 2. Conversa SEM anúncio só vem do servidor dentro do período escolhido. É o
//    que segura a carga: a Tokiomaki tem 2.753 conversas, 110 de tráfego. A
//    exceção são as que a equipe precisa ver hoje de qualquer jeito (agendada de
//    hoje em diante ou com próxima ação vencida), senão "Agenda de hoje" e
//    "Atrasados" mentiriam. O tráfego vem inteiro, como sempre, porque a busca
//    do CRM procura em todos os períodos.

import { leadContaSql, portaSql } from '@/lib/lead-contagem';
import { canalSql } from '@/lib/canal-lead';

export type OrigemFiltro =
  | { tipo: 'trafego' }
  | { tipo: 'todos' }
  | { tipo: 'sem_anuncio' }
  | { tipo: 'canal'; canal: string };

/** Valor da URL → filtro. Qualquer coisa desconhecida vira o padrão. */
export function lerOrigem(v: string | null | undefined): OrigemFiltro {
  const t = (v ?? '').trim();
  if (t === 'todos') return { tipo: 'todos' };
  if (t === 'sem_anuncio') return { tipo: 'sem_anuncio' };
  if (t.startsWith('canal:')) return { tipo: 'canal', canal: t.slice(6).slice(0, 200) };
  return { tipo: 'trafego' };
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Período do CRM. Datas inválidas são ignoradas (sem período = tudo). */
export function lerJanela(from: string | null, to: string | null): { from: string | null; to: string | null } {
  return { from: from && DIA.test(from) ? from : null, to: to && DIA.test(to) ? to : null };
}

/** Lead que o CRM mostra no padrão: conta no dashboard ou foi criado à mão. */
export function trafegoOuManualSql(alias = ''): string {
  return `(${leadContaSql(alias)} OR (${portaSql(alias)}) = 'manual')`;
}

/** Teto de conversas sem anúncio por carga: as mais recentes ficam, o resto
 *  aparece na contagem do filtro. Medido em 20/10: o Adriano Moleiro tem 1.857
 *  conversas sem anúncio só em outubro (5 MB numa carga). */
export const TETO_SEM_ANUNCIO = 300;

/**
 * Cláusula AND para o WHERE. Acrescenta os parâmetros em `params` (que já
 * carrega os da consulta, com o client_id em $1) e usa os índices seguintes.
 * Com `comTeto`, a parte sem anúncio sai por subconsulta limitada às mais
 * recentes; a carga incremental (só o que mudou) dispensa o teto.
 */
export function filtroOrigemSql(
  alias: string,
  origem: OrigemFiltro,
  janela: { from: string | null; to: string | null },
  params: unknown[],
  comTeto = true,
): string {
  const c = (n: string) => (alias ? `${alias}.${n}` : n);
  const base = trafegoOuManualSql(alias);
  if (origem.tipo === 'trafego') return `AND ${base}`;

  // Canal: lista de grafias separadas por "|" ("google|Google Ads" é o mesmo
  // canal na tela). Vazio = "sem canal informado".
  let canalCond: (a: string) => string = () => 'TRUE';
  if (origem.tipo === 'canal') {
    const grafias = origem.canal.split('|').map(s => s.trim().toLowerCase());
    if (grafias.length === 1 && !grafias[0]) {
      canalCond = (a: string) => `(${canalSql(a)}) IS NULL`;
    } else {
      params.push(grafias.filter(Boolean));
      const i = params.length;
      canalCond = (a: string) => `lower(btrim(${canalSql(a)})) = ANY($${i}::text[])`;
    }
  }

  const periodo = (a: string) => {
    const cc = (n: string) => (a ? `${a}.${n}` : n);
    const partes: string[] = [];
    if (janela.from) partes.push(`${cc('data')} >= $${iFrom}::date`);
    if (janela.to) partes.push(`${cc('data')} <= $${iTo}::date`);
    return `(${partes.length ? `(${partes.join(' AND ')})` : 'TRUE'}
      OR ${cc('data_agendada')} >= CURRENT_DATE
      OR ${cc('proxima_acao_em')} < now())`;
  };
  let iFrom = 0, iTo = 0;
  if (janela.from) { params.push(janela.from); iFrom = params.length; }
  if (janela.to) { params.push(janela.to); iTo = params.length; }

  const semAnuncio = comTeto
    ? `${c('id')} IN (SELECT s.id FROM public.crm_leads s
         WHERE s.client_id = $1 AND NOT ${trafegoOuManualSql('s')}
           AND ${periodo('s')} AND ${canalCond('s')}
         ORDER BY COALESCE(s.whatsapp_last_message_at, s.updated_at, s.created_at) DESC
         LIMIT ${TETO_SEM_ANUNCIO})`
    : `(NOT ${base} AND ${periodo(alias)} AND ${canalCond(alias)})`;

  if (origem.tipo === 'sem_anuncio') return `AND ${semAnuncio}`;
  return `AND ((${base} AND ${canalCond(alias)}) OR ${semAnuncio})`;
}
