/**
 * Identidade do lead e política de mesclagem — uma régua só para as 7 portas.
 *
 * O sistema recebe lead por sete caminhos (WhatsApp, planilha em 3 caminhos,
 * Agendor, Datalytics, Meta Leadgen, webhook genérico e cadastro manual) e até
 * aqui cada um resolvia identidade do seu jeito: quatro implementações, todas
 * só por telefone, todas só com número brasileiro, nenhuma olhando e-mail nem
 * o número do orçamento. O resultado é o que o Matheus descreveu: a informação
 * chega em pedaços e o pedaço novo às vezes vira um lead novo em vez de
 * atualizar o que já existe.
 *
 * ⚠️ A REGRA, decidida por ele: **origem e rastreio são SOBERANOS** — quem viu
 * o lead chegar sabe de onde ele veio, e nenhuma fonte posterior sobrescreve
 * isso. Faturamento, status e dados de cadastro podem ser atualizados pela
 * fonte mais recente.
 */

import type { Pool } from 'pg';

// ─────────────────────────────────────────────────────────── chaves de contato

/**
 * Chaves de telefone para casar o MESMO número escrito de formas diferentes.
 *
 * ⚠️ Devolve LISTA, não uma chave só. O `chaveTelefone` da importação corta o
 * DDI 55 e exige 10+ dígitos — o que resolve o Brasil e **descarta número
 * estrangeiro** (+351, +44): eles voltavam `null` e nunca casavam com nada,
 * então cada mensagem virava um lead novo. Aqui o número cru também vira
 * chave, então o estrangeiro casa consigo mesmo.
 *
 * A ordem importa: a forma normalizada BR vem primeiro porque é a que casa
 * entre fontes (uma manda 5543..., a outra 43...).
 */
export function chavesTelefone(v: unknown): string[] {
  const cru = String(v ?? '').replace(/\D/g, '');
  if (!cru) return [];
  const chaves: string[] = [];
  if (cru.length > 11 && cru.startsWith('55')) {
    const semDdi = cru.slice(2);
    if (semDdi.length >= 10) chaves.push(semDdi);
  } else if (cru.length >= 10 && cru.length <= 11) {
    chaves.push(cru);
  }
  if (!chaves.includes(cru)) chaves.push(cru);
  return chaves;
}

/**
 * E-mail normalizado, ou null.
 *
 * ⚠️ E-mail é a chave mais FRACA e por isso a mais perigosa: clínica que
 * cadastra `contato@clinica.com` em todo mundo fundiria a base inteira. Quem
 * usa esta chave precisa checar que ela aponta para UM lead só — é o que
 * `resolverLeadExistente` faz.
 */
export function chaveEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s) ? s : null;
}

// ────────────────────────────────────────────────────── política de mesclagem

/**
 * Campos SOBERANOS: dizem de ONDE o lead veio.
 *
 * Nunca são sobrescritos — só preenchidos quando estão vazios. Um lead que
 * entrou por anúncio no WhatsApp carrega `ctwa_clid`, campanha e criativo; a
 * planilha do CRM da clínica não sabe disso, e deixá-la escrever por cima
 * apagaria a única informação que liga a venda ao anúncio.
 */
export const CAMPOS_SOBERANOS = [
  'origin', 'canal', 'source', 'source_id', 'source_url',
  'ctwa_clid', 'campaign_name', 'adset_name', 'ad_name',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid',
  'keyword', 'matchtype', 'device', 'network', 'placement',
  'click_code', 'first_origin_at',
  'ddd', 'regiao_uf', 'regiao_cidade', 'regiao_fonte',
] as const;

/**
 * Campos de ESTADO: dizem o que ACONTECEU com o lead.
 *
 * A fonte mais recente manda — mas só se for mesmo mais recente
 * (`updated_at_external`). Export antigo reimportado não pode regredir o
 * status; foi exatamente o que aconteceu em 2026-08-23 no caminho por telefone.
 */
export const CAMPOS_ESTADO = [
  'status', 'status_raw', 'status_category', 'stage',
  'valor_rs', 'revenue', 'orcamento', 'pagamento', 'data_agendada',
  'data_fechamento', 'fechado_em',
] as const;

/**
 * Campos de ESTADO MONOTÔNICO: só avançam, nunca voltam.
 *
 * Ficam FORA da régua de recência de propósito. Quem compareceu não deixa de
 * ter comparecido porque um export posterior veio com outro rótulo.
 */
export const CAMPOS_MONOTONICOS = ['agendou', 'compareceu', 'fechou'] as const;

/**
 * Campos de IDENTIDADE: quem é a pessoa.
 *
 * Preenchem vazio. Nome digitado pelo atendente vale mais que "Sem nome" de um
 * import posterior — mas um lead sem nome nenhum aceita o que vier.
 */
export const CAMPOS_IDENTIDADE = [
  'nome', 'lead_name', 'email', 'numero', 'phone', 'whatsapp_lid',
  'city', 'bairro', 'observacao', 'negocio_externo_id', 'external_id',
] as const;

/** SET de UPDATE para campos que só preenchem vazio (soberanos e identidade). */
export function setPreencheVazio(coluna: string, valor: string): string {
  return `${coluna} = COALESCE(NULLIF(${coluna}, ''), ${valor})`;
}

/**
 * SET de UPDATE para campo de estado, guardado pela recência da fonte.
 * `refData` é a expressão com a data da fonte (ex.: `$9::date`).
 */
export function setEstado(coluna: string, valor: string, refData: string, tabela = 'public.crm_leads'): string {
  const maisNovo = `(${tabela}.updated_at_external IS NULL OR ${refData} IS NULL OR ${refData} >= ${tabela}.updated_at_external)`;
  return `${coluna} = CASE WHEN ${maisNovo} THEN ${valor} ELSE ${tabela}.${coluna} END`;
}

// ─────────────────────────────────────────────────────── resolução do lead

export type ChavesDeLead = {
  /** Id do negócio NA FONTE (agendor:123, leadgen:456…). A chave mais forte. */
  externalId?: string | null;
  /** Nº do orçamento/proposta — a ponte entre planilha de Leads e de Vendas. */
  negocioExternoId?: string | null;
  telefone?: string | null;
  /** LID do WhatsApp (modo @lid), quando o número real não veio. */
  lid?: string | null;
  email?: string | null;
};

export type LeadResolvido = {
  id: string;
  /** Por qual chave casou — vai pro log, e é o que permite auditar merge errado. */
  por: 'external_id' | 'negocio' | 'telefone' | 'lid' | 'email';
};

/**
 * Acha o lead já cadastrado, tentando as chaves da mais forte para a mais fraca.
 *
 * ⚠️ Aditivo por construção: tenta MAIS chaves que os matchers antigos, nunca
 * menos. Só pode encontrar lead que antes escapava — não pode perder um que já
 * casava.
 *
 * ⚠️ Registro de VENDA fica FORA: é linha de ledger de faturamento, não pessoa.
 * Casar com ele juntaria a venda com o próprio lançamento.
 */
export async function resolverLeadExistente(
  pool: Pool, clientId: string, chaves: ChavesDeLead,
): Promise<LeadResolvido | null> {
  const externalId = String(chaves.externalId ?? '').trim();
  const negocio = String(chaves.negocioExternoId ?? '').trim();
  const tels = chavesTelefone(chaves.telefone);
  const lid = String(chaves.lid ?? '').replace(/\D/g, '');
  const email = chaveEmail(chaves.email);

  if (!externalId && !negocio && tels.length === 0 && !lid && !email) return null;

  const NORM = `NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '')`;
  const NORM_BR = `CASE WHEN length(${NORM}) > 11 AND ${NORM} LIKE '55%' THEN substring(${NORM} from 3) ELSE ${NORM} END`;

  const { rows } = await pool.query<{ id: string; forca: number }>(
    `SELECT id,
            CASE
              WHEN $2 <> '' AND external_id = $2 THEN 1
              WHEN $3 <> '' AND negocio_externo_id = $3 THEN 2
              WHEN cardinality($4::text[]) > 0 AND (${NORM} = ANY($4) OR ${NORM_BR} = ANY($4)) THEN 3
              WHEN $5 <> '' AND whatsapp_lid = $5 THEN 4
              ELSE 5
            END AS forca
       FROM public.crm_leads
      WHERE client_id = $1
        AND COALESCE(registro_tipo, 'hibrido') <> 'venda'
        AND (
          ($2 <> '' AND external_id = $2)
          OR ($3 <> '' AND negocio_externo_id = $3)
          OR (cardinality($4::text[]) > 0 AND (${NORM} = ANY($4) OR ${NORM_BR} = ANY($4)))
          OR ($5 <> '' AND whatsapp_lid = $5)
          OR ($6 <> '' AND lower(COALESCE(email, '')) = $6)
        )
      ORDER BY forca,
               CASE WHEN funnel_id IS NOT NULL THEN 0 ELSE 1 END,
               COALESCE(updated_at, created_at) DESC NULLS LAST,
               created_at DESC
      LIMIT 2`,
    [clientId, externalId, negocio, tels, lid, email ?? ''],
  );

  const melhor = rows[0];
  if (!melhor) return null;

  // ⚠️ Casou SÓ por e-mail: exige que o e-mail aponte para um lead único. Sem
  // isso, um e-mail de balcão (contato@clinica.com) fundiria a base inteira.
  if (melhor.forca === 5) {
    if (rows.length > 1) return null;
    const { rows: [{ n }] } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.crm_leads
        WHERE client_id = $1 AND lower(COALESCE(email, '')) = $2
          AND COALESCE(registro_tipo, 'hibrido') <> 'venda'`,
      [clientId, email ?? ''],
    );
    if (Number(n) !== 1) return null;
  }

  const por = (['external_id', 'negocio', 'telefone', 'lid', 'email'] as const)[melhor.forca - 1];
  return { id: melhor.id, por };
}

// ───────────────────────────────────────────── vínculo sem mesclagem (B2B)

/**
 * Liga um lead ao lead que o ORIGINOU, sem juntar as duas linhas.
 *
 * ⚠️ Existe para o caso B2B, onde mesclar seria errado: no Agendor da Incorpast
 * o negócio está pendurado na EMPRESA, e a mesma empresa tem vários negócios.
 * Escrever o telefone da empresa em `numero` fundiria todos eles num lead só
 * (e estouraria a unique de produção). Mas a conversa de WhatsApp que originou
 * aqueles negócios é UMA, e é ela que carrega o criativo.
 *
 * A solução é a mesma da ponte do ledger de faturamento: aponta
 * `origem_lead_id` e COPIA o rastreio, mantendo as linhas separadas. Três
 * negócios da mesma empresa podem apontar para a mesma conversa — o que é
 * exatamente a verdade.
 *
 * ⚠️ Rastreio é SOBERANO: preenche só o que está vazio no destino e **nunca
 * escreve de volta** na origem.
 *
 * Devolve true quando ligou algo novo.
 */
export async function vincularAoLeadDeOrigem(
  pool: Pool, clientId: string, leadId: string,
  contato: { telefone?: string | null; email?: string | null },
): Promise<boolean> {
  if (!contato.telefone && !contato.email) return false;
  const origem = await resolverLeadExistente(pool, clientId, contato);
  // Achou a si mesmo (o lead já tem esse telefone) → nada a ligar.
  if (!origem || origem.id === leadId) return false;

  const { rowCount } = await pool.query(
    `UPDATE public.crm_leads d
        SET origem_lead_id = o.id,
            canal         = COALESCE(NULLIF(d.canal, ''), o.canal),
            origin        = COALESCE(NULLIF(d.origin, ''), o.origin),
            source_id     = COALESCE(NULLIF(d.source_id, ''), o.source_id),
            source_url    = COALESCE(NULLIF(d.source_url, ''), o.source_url),
            ctwa_clid     = COALESCE(NULLIF(d.ctwa_clid, ''), o.ctwa_clid),
            campaign_name = COALESCE(NULLIF(d.campaign_name, ''), o.campaign_name),
            adset_name    = COALESCE(NULLIF(d.adset_name, ''), o.adset_name),
            ad_name       = COALESCE(NULLIF(d.ad_name, ''), o.ad_name),
            utm_source    = COALESCE(NULLIF(d.utm_source, ''), o.utm_source),
            utm_medium    = COALESCE(NULLIF(d.utm_medium, ''), o.utm_medium),
            utm_campaign  = COALESCE(NULLIF(d.utm_campaign, ''), o.utm_campaign),
            utm_content   = COALESCE(NULLIF(d.utm_content, ''), o.utm_content),
            utm_term      = COALESCE(NULLIF(d.utm_term, ''), o.utm_term),
            gclid         = COALESCE(NULLIF(d.gclid, ''), o.gclid),
            fbclid        = COALESCE(NULLIF(d.fbclid, ''), o.fbclid),
            ddd           = COALESCE(NULLIF(d.ddd, ''), o.ddd),
            regiao_uf     = COALESCE(NULLIF(d.regiao_uf, ''), o.regiao_uf),
            regiao_cidade = COALESCE(NULLIF(d.regiao_cidade, ''), o.regiao_cidade),
            regiao_fonte  = COALESCE(NULLIF(d.regiao_fonte, ''), o.regiao_fonte),
            first_origin_at = COALESCE(d.first_origin_at, o.first_origin_at),
            updated_at    = NOW()
       FROM public.crm_leads o
      WHERE d.id = $1 AND o.id = $2 AND d.client_id = $3
        AND d.origem_lead_id IS DISTINCT FROM o.id`,
    [leadId, origem.id, clientId],
  );
  return (rowCount ?? 0) > 0;
}
