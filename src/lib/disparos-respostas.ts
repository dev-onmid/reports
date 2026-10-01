/**
 * Taxa de resposta dos Disparos — quantos dos contatos abordados responderam.
 *
 * É o termômetro de reputação que faltava: o WhatsApp pune quem manda muito e
 * recebe pouco, e essa razão é o sinal mais direto disso. Medido em 01/10/2026,
 * antes de existir esta tela: **37 respostas em 1.594 disparos (2,3%)** — e
 * ninguém no sistema conseguia ver esse número.
 *
 * ⚠️ NADA é gravado: a taxa é derivada na leitura, como o funil de recorrência.
 * Congelar o número mentiria exatamente em quem respondeu depois.
 */
import type { Pool } from 'pg';

export type RespostasDaCampanha = {
  campaignId: string;
  /** Falso quando a instância não alimenta o CRM — aí não há como saber. */
  mensuravel: boolean;
  enviados: number;
  responderam: number;
  /** 0–100, ou null quando não dá para medir / ninguém foi abordado ainda. */
  taxa: number | null;
};

/**
 * ⚠️ A resposta é procurada entre os leads do CLIENTE dono da instância, não no
 * CRM inteiro: o mesmo telefone pode conversar com vários clientes da carteira,
 * e contar a conversa dele com OUTRO cliente infla a taxa de quem disparou.
 *
 * ⚠️ Instância sem vínculo no CRM devolve `mensuravel: false`, nunca 0%. Zero
 * diria "ninguém respondeu"; a verdade é "não temos como saber" — e um número
 * que mente sobre reputação é pior que um traço na tela.
 *
 * ⚠️ Casamento pelo sufixo de 8 dígitos, o mesmo do opt-out: o contato chega com
 * e sem DDI e com e sem o nono dígito, e só o sufixo casa as três formas.
 */
export async function taxaDeRespostaPorCampanha(
  pool: Pool, campaignIds: string[],
): Promise<Map<string, RespostasDaCampanha>> {
  const mapa = new Map<string, RespostasDaCampanha>();
  if (campaignIds.length === 0) return mapa;

  const { rows } = await pool.query<{
    id: string; mensuravel: boolean; enviados: string; responderam: string;
  }>(
    `WITH camp AS (
       SELECT c.id, link.client_id AS onmid_client_id
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
         LEFT JOIN LATERAL (
           SELECT client_id FROM public.client_zapi_instances
            WHERE instance_id = cl.instance_id AND ativo = true
            ORDER BY created_at DESC LIMIT 1
         ) link ON true
        WHERE c.id = ANY($1::uuid[])
     ),
     env AS (
       SELECT n.campaign_id,
              right(regexp_replace(n.phone, '[^0-9]', '', 'g'), 8) AS chave,
              MIN(n.sent_at) AS enviado_em
         FROM public.zapi_numbers n
        WHERE n.campaign_id = ANY($1::uuid[]) AND n.status = 'sent'
        GROUP BY 1, 2
     )
     SELECT camp.id,
            (camp.onmid_client_id IS NOT NULL) AS mensuravel,
            COUNT(env.chave) AS enviados,
            COUNT(env.chave) FILTER (WHERE EXISTS (
              SELECT 1 FROM public.crm_leads l
                JOIN public.crm_messages m ON m.lead_id = l.id
               WHERE l.client_id = camp.onmid_client_id
                 AND m.direction = 'in'
                 AND m.created_at > env.enviado_em
                 AND right(regexp_replace(l.numero, '[^0-9]', '', 'g'), 8) = env.chave
            )) AS responderam
       FROM camp
       LEFT JOIN env ON env.campaign_id = camp.id
      GROUP BY camp.id, camp.onmid_client_id`,
    [campaignIds],
  ).catch(() => ({ rows: [] as { id: string; mensuravel: boolean; enviados: string; responderam: string }[] }));

  for (const r of rows) {
    const enviados = Number(r.enviados) || 0;
    const responderam = Number(r.responderam) || 0;
    mapa.set(r.id, {
      campaignId: r.id,
      mensuravel: r.mensuravel,
      enviados,
      responderam,
      taxa: r.mensuravel && enviados > 0 ? (responderam / enviados) * 100 : null,
    });
  }
  return mapa;
}

/**
 * Como ler a taxa. Os cortes vêm do que medimos na carteira (2,3% na média dos
 * disparos frios) e servem para dar direção, não para prometer precisão.
 */
export function faixaDaTaxa(taxa: number | null): 'sem_dado' | 'ruim' | 'atencao' | 'boa' {
  if (taxa === null) return 'sem_dado';
  if (taxa < 3) return 'ruim';
  if (taxa < 8) return 'atencao';
  return 'boa';
}
