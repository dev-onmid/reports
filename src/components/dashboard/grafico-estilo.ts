/**
 * Estilo único dos gráficos do dashboard de geração de leads.
 *
 * Todo gráfico da página (Ritmo do mês, CPL diário, Evolução diária da LP)
 * usa estas mesmas cores, grade, eixos e tooltip — antes cada arquivo tinha
 * o seu verde, o seu azul e a sua linha de meta, e a página parecia feita
 * por três pessoas.
 *
 *  - série PRIMÁRIA: verde, linha 2px + área suave por baixo;
 *  - série SECUNDÁRIA: azul, linha 1.5px (sem área, para não brigar com a primária);
 *  - REFERÊNCIA (meta): âmbar tracejado.
 */

export const COR_PRIMARIA = '#6cff2f';
export const COR_SECUNDARIA = '#3b9eff';
export const COR_REFERENCIA = '#f5b83d';
export const COR_GRADE = 'rgba(255,255,255,0.06)';
export const COR_EIXO = '#9aa4aa';

/** Traço da linha de meta/referência. */
export const TRACO_REFERENCIA = '4 4';
/** Traço da projeção (continuação da série primária). */
export const TRACO_PROJECAO = '6 5';

/** Altura padrão da área de plotagem de um card de gráfico. */
export const ALTURA_GRAFICO = 220;

export const tickEixo = { fill: COR_EIXO, fontSize: 10 };

export const eixoXProps = {
  tick: tickEixo,
  tickLine: false,
  axisLine: { stroke: COR_GRADE },
  interval: 'preserveStartEnd' as const,
  minTickGap: 18,
};

export const eixoYProps = {
  tick: tickEixo,
  tickLine: false,
  axisLine: false,
};

export const gradeProps = { stroke: COR_GRADE, vertical: false };

export const margemGrafico = { top: 6, right: 8, left: 0, bottom: 0 };

export const tooltipProps = {
  contentStyle: { background: '#0b1216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#f4f7f8', fontWeight: 700 },
  itemStyle: { color: '#dce4e8' },
  cursor: { stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1 },
};

export const legendaProps = {
  wrapperStyle: { fontSize: 11, color: '#a7b0b6' },
  iconType: 'plainline' as const,
};

/** Opacidades do degradê de área da série primária (topo → base). */
export const AREA_OPACIDADE = { topo: 0.28, base: 0.02 };
