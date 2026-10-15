import type { Pool } from 'pg';
import { analisarConversa, type ResultadoAnalise } from '@/lib/crm-ai-analysis';

/**
 * Análise de IA em LOTE — o retroativo que se perde enquanto a automação do
 * CRM está desligada (pedido do Matheus, 2026-10-02: "quando eu deixo
 * desativada a gente acaba perdendo o retroativo").
 *
 * ⚠️ O recorte NÃO é recalculado aqui. O CRM filtra por período no navegador
 * (`filtered = leads.filter(...)`), então a tela já sabe exatamente quais leads
 * o gestor está olhando e manda os ids. Refazer a régua de data no servidor
 * criaria duas verdades sobre "o que está na tela" — é o mesmo erro que já
 * separou o donut da lista de leads antes de `canalSql` existir.
 *
 * ⚠️ Toda análise daqui roda com `semEfeitosExternos`: move o board, mas não
 * manda WhatsApp de follow-up nem conversão velha para Meta/Google. Ver o
 * comentário de `OpcoesAnalise` — o risco é medido, não teórico.
 */

/** Haiku 4.5, ~2.000 tokens por conversa analisada (prompt + resposta). */
const TOKENS_POR_LEAD = 2000;
const USD_POR_TOKEN = 0.0000008;
/** Câmbio só para a estimativa na tela; o custo real vai para `ia_uso_mensal`. */
const USD_PARA_BRL = 5.5;

/** Quanto deve custar analisar N conversas. Serve para o gestor decidir ANTES. */
export function estimarCusto(leads: number): { usd: number; brl: number } {
  const usd = Math.max(0, leads) * TOKENS_POR_LEAD * USD_POR_TOKEN;
  return { usd, brl: usd * USD_PARA_BRL };
}

/**
 * Quantos leads por chamada HTTP.
 *
 * ⚠️ Pequeno de propósito: a tela chama a rota em sequência e desenha a barra
 * de progresso com o que voltou. Bloco grande daria menos requisições e uma
 * barra que fica parada minutos — e, se a requisição morresse no meio, o
 * gestor não saberia quanto já tinha sido feito.
 */
export const LEADS_POR_BLOCO = 25;

/**
 * Chamadas simultâneas à Anthropic.
 *
 * ⚠️ Três, não mais: o pool do projeto é `max: 1`, então as consultas ao banco
 * serializam de qualquer forma e o ganho vem só de sobrepor a espera da IA.
 * Subir isso não acelera e aumenta a chance de estourar o limite do provedor.
 */
const CONCORRENCIA = 3;

export type CandidatosLote = {
  /** Leads que valem analisar (têm conversa e a análise está faltando/velha). */
  candidatos: string[];
  /** Já analisados depois da última mensagem — reanalisar daria o mesmo veredito. */
  jaAnalisados: number;
  /** Sem nenhuma mensagem: não há o que ler. */
  semConversa: number;
  /** Marcados como time interno — nunca entram, igual na análise automática. */
  timeInterno: number;
};

/**
 * Separa, entre os leads da tela, quais têm o que analisar.
 *
 * `incluirJaAnalisados` existe para quando os CRITÉRIOS da IA mudam: a conversa
 * é a mesma, mas a régua não, então reavaliar passa a fazer sentido. Fora
 * disso fica de fora — pagar de novo pela mesma conversa devolve o mesmo
 * resultado.
 */
export async function separarCandidatos(
  pool: Pool,
  clientId: string,
  leadIds: string[],
  incluirJaAnalisados = false,
): Promise<CandidatosLote> {
  const ids = [...new Set(leadIds.filter(id => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) {
    return { candidatos: [], jaAnalisados: 0, semConversa: 0, timeInterno: 0 };
  }

  // ⚠️ O `client_id` entra na query, não só nos ids: a tela manda uma lista e
  // ela nunca deve poder alcançar lead de outro cliente.
  const { rows } = await pool.query<{
    id: string;
    time_interno: boolean | null;
    tem_conversa: boolean;
    analise_velha: boolean;
  }>(
    `SELECT l.id,
            l.time_interno,
            (u.ultima_msg IS NOT NULL) AS tem_conversa,
            (l.ia_ultimo_analise IS NULL OR u.ultima_msg > l.ia_ultimo_analise) AS analise_velha
       FROM public.crm_leads l
       LEFT JOIN (
         SELECT lead_id, MAX(created_at) AS ultima_msg
           FROM public.crm_messages
          WHERE lead_id = ANY($2::uuid[])
          GROUP BY lead_id
       ) u ON u.lead_id = l.id
      WHERE l.client_id = $1
        AND l.id = ANY($2::uuid[])`,
    [clientId, ids],
  );

  const out: CandidatosLote = { candidatos: [], jaAnalisados: 0, semConversa: 0, timeInterno: 0 };
  for (const row of rows) {
    if (row.time_interno === true) { out.timeInterno += 1; continue; }
    if (!row.tem_conversa) { out.semConversa += 1; continue; }
    if (!row.analise_velha && !incluirJaAnalisados) { out.jaAnalisados += 1; continue; }
    out.candidatos.push(String(row.id));
  }
  return out;
}

export type ResumoBloco = {
  analisados: number;
  moveuStatus: number;
  moveuTemperatura: number;
  erros: number;
  /** Leads que a análise recusou e por quê — a tela mostra sem inventar motivo. */
  pulados: Array<{ leadId: string; motivo: NonNullable<ResultadoAnalise['motivo']> }>;
};

/**
 * Analisa um bloco de leads. Sem orçamento de tempo próprio: o bloco é pequeno
 * e quem controla o ritmo é a tela, que chama isto em sequência.
 */
export async function analisarBloco(pool: Pool, leadIds: string[]): Promise<ResumoBloco> {
  const resumo: ResumoBloco = { analisados: 0, moveuStatus: 0, moveuTemperatura: 0, erros: 0, pulados: [] };
  const fila = [...leadIds];

  async function trabalhador() {
    for (;;) {
      const leadId = fila.shift();
      if (!leadId) return;
      // ⚠️ `analisarConversa` nunca lança (tem catch próprio e grava o erro em
      // `crm_ia_historico`), então um lead problemático não derruba o bloco.
      const r = await analisarConversa(pool, leadId, {
        forcarMesmoDesligada: true,
        semEfeitosExternos: true,
      });
      if (r.analisou) {
        resumo.analisados += 1;
        if (r.moveuStatus) resumo.moveuStatus += 1;
        if (r.moveuTemperatura) resumo.moveuTemperatura += 1;
      } else if (r.motivo === 'erro') {
        resumo.erros += 1;
      } else if (r.motivo) {
        resumo.pulados.push({ leadId, motivo: r.motivo });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, trabalhador));
  return resumo;
}
