/**
 * SULTS → `crm_leads`: o negócio do cliente vira lead no CRM daqui.
 *
 * ⚠️ Isto REVERTE, para este caso, a regra do `sults-sync`: lá a etapa do SULTS
 * fica numa tabela ao lado, sem encostar em `crm_leads.status`. A regra vale
 * para cliente cujo funil vive AQUI — o Kanban, o follow-up e a IA disputariam
 * a mesma coluna de texto livre.
 *
 * O CondoStore é o caso oposto: ele qualifica tudo dentro do SULTS, e o CRM
 * daqui é o espelho. Sem trazer para `crm_leads`, nada disso chega na
 * dashboard, no funil ou na Performance Comercial — todos leem essa tabela.
 * É exatamente o desenho que o Agendor e o Datalytics já usam.
 *
 * A ingestão é OPCIONAL por conexão (`ingerir_crm`): cliente que usa o SULTS só
 * como destino continua com o espelho isolado.
 */

import type { Pool } from 'pg';
import { ensureDefaultFunnel, getFirstFunnelStageLabel } from '@/lib/crm-conversation-sync';
import { resolverLeadExistente } from '@/lib/lead-identity';
import { classificarEtapa } from '@/lib/funil-etapas';
import { sinaisDoStatus } from '@/lib/importacao-origem';
import type { SnapshotNegocio } from '@/lib/sults';

let colunasOk: Promise<void> | null = null;

function ensureColunasLead(pool: Pool): Promise<void> {
  if (!colunasOk) {
    colunasOk = (async () => {
      await pool.query(`
        ALTER TABLE public.crm_leads
          ADD COLUMN IF NOT EXISTS external_id TEXT,
          ADD COLUMN IF NOT EXISTS email TEXT,
          ADD COLUMN IF NOT EXISTS fechado_em DATE,
          ADD COLUMN IF NOT EXISTS perdido_em DATE,
          ADD COLUMN IF NOT EXISTS responsavel TEXT,
          ADD COLUMN IF NOT EXISTS valor_negocio NUMERIC,
          ADD COLUMN IF NOT EXISTS link_externo TEXT
      `);
    })().catch(err => { colunasOk = null; throw err; });
  }
  return colunasOk;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Cria a etapa no funil daqui quando ela só existe no SULTS.
 *
 * Sem isso, lead em "Abordagem D3" ficaria com um status que não é coluna
 * nenhuma do Kanban — some do board sem explicação (a lição da IA do Kanban,
 * 2026-07-17). Cópia deliberada do `espelharEtapa` do Agendor.
 */
async function espelharEtapa(
  pool: Pool, clientId: string, funnelId: string, label: string,
): Promise<void> {
  const { rows } = await pool.query<{ label: string }>(
    `SELECT label FROM public.crm_stages WHERE funnel_id = $1`, [funnelId]);
  const alvo = normalizar(label);
  if (rows.some(r => normalizar(r.label) === alvo)) return;
  await pool.query(
    `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
     SELECT $1, $2, $3, '#94a3b8', COALESCE(MAX(position), -1) + 1, $4
       FROM public.crm_stages WHERE funnel_id = $1`,
    [funnelId, clientId, label, classificarEtapa(label)],
  );
}

export type ResultadoIngestao = { leadId: string; criado: boolean };

const GANHO = 2;
const PERDA = 3;

/**
 * Ingere UM negócio do SULTS como lead.
 *
 * ⚠️ A ordem de identificação começa por `sults_envios`, e isso não é detalhe:
 * lead que NÓS enviamos vira negócio lá e volta por aqui. Sem consultar o
 * vínculo da ida primeiro, o mesmo lead seria recriado a cada varredura como se
 * fosse alguém novo — a integração se alimentando do próprio eco.
 */
export async function ingerirNegocioSults(
  pool: Pool, clientId: string, s: SnapshotNegocio,
): Promise<ResultadoIngestao | null> {
  await ensureColunasLead(pool);

  const externalId = `sults:${s.negocioId}`;
  const ganhou = s.situacaoId === GANHO;
  const perdeu = s.situacaoId === PERDA;

  // ⚠️ Valor SÓ quando GANHO. No SULTS 77% dos negócios têm valor preenchido,
  // aberto ou não; gravar isso em `valor_rs` quebra o invariante do sistema
  // inteiro ("tem valor = vendeu") e infla o Faturamento com pipeline aberto.
  // É o mesmo erro que estourou a dashboard da Incorpast em 2026-08-21.
  const valorVenda = ganhou ? s.valor : null;
  const dia = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
  const fechadoEm = ganhou ? (dia(s.dtConclusao) ?? dia(s.entrouNaEtapaEm)) : null;
  const perdidoEm = perdeu ? (dia(s.dtConclusao) ?? dia(s.entrouNaEtapaEm)) : null;

  // O rótulo do board é a etapa do SULTS. Ganho sem etapa cai no rótulo
  // canônico de venda do sistema ('Fechado', o que a importação grava).
  const label = s.etapaNome ?? (ganhou ? 'Fechado' : null);
  const sinais = sinaisDoStatus(label ?? '');
  const fechou = sinais.fechou || ganhou;

  // ⚠️ `canal` guarda a ORIGEM do negócio ("Landing Page (Google)", "Indicação"),
  // não a porta de entrada — senão o donut de canais mostra tudo como "sults",
  // que foi exatamente o defeito do Agendor corrigido em 2026-08-22.
  const canal = s.origemNome ?? 'sults';

  const observacao = [
    s.funilNome ? `Funil no SULTS: ${s.funilNome}` : null,
    perdeu && s.motivoPerda ? `Perdido: ${s.motivoPerda}` : null,
  ].filter(Boolean).join(' · ') || null;

  await pool.query('BEGIN');
  try {
    await pool.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sults:${clientId}:${s.negocioId}`]);
    const funnelId = await ensureDefaultFunnel(pool, clientId);

    // 1º o vínculo da IDA — impede o eco virar lead novo.
    const { rows: [envio] } = await pool.query<{ lead_id: string }>(
      `SELECT lead_id FROM public.sults_envios
        WHERE client_id = $1 AND negocio_id = $2 AND lead_id IS NOT NULL LIMIT 1`,
      [clientId, s.negocioId],
    );

    // 2º a régua única de identidade do repo (id externo, telefone BR e
    // estrangeiro, e-mail com a trava de e-mail de balcão).
    const achado = envio?.lead_id
      ? { id: envio.lead_id }
      : await resolverLeadExistente(pool, clientId, {
        externalId,
        telefone: s.contatoTelefone,
        email: s.contatoEmail,
      });

    if (achado) {
      const { rows: [match] } = await pool.query<{ funnel_id: string | null }>(
        `SELECT funnel_id FROM public.crm_leads WHERE id = $1`, [achado.id]);
      if (!match) { await pool.query('ROLLBACK'); return null; }

      await pool.query(
        `UPDATE public.crm_leads SET
           -- O SULTS é a fonte da verdade da ETAPA para este cliente: status
           -- sobrescreve, ao contrário do fill-blanks das demais fontes.
           status = COALESCE($2, status),
           agendou = COALESCE(agendou, FALSE) OR $3,
           compareceu = COALESCE(compareceu, FALSE) OR $4,
           fechou = COALESCE(fechou, FALSE) OR $5,
           valor_rs = COALESCE($6, valor_rs),
           revenue = COALESCE($6, revenue),
           fechado_em = COALESCE(fechado_em, $7::date),
           perdido_em = COALESCE(perdido_em, $8::date),
           responsavel = COALESCE($9, responsavel),
           temperatura = COALESCE(NULLIF(temperatura, ''), $10),
           nome = COALESCE(NULLIF(nome, ''), $11),
           email = COALESCE(NULLIF(email, ''), $12),
           numero = COALESCE(NULLIF(numero, ''), $13),
           regiao_cidade = COALESCE(NULLIF(regiao_cidade, ''), $14),
           regiao_uf = COALESCE(NULLIF(regiao_uf, ''), $15),
           observacao = COALESCE(NULLIF(observacao, ''), $16),
           -- canal só é sobrescrito enquanto for a porta de entrada; canal
           -- digitado por gestor ou vindo de outra fonte nunca é perdido.
           canal = CASE
             WHEN $17 <> 'sults' AND (canal IS NULL OR lower(btrim(canal)) IN ('', 'sults'))
               THEN $17 ELSE canal END,
           external_id = COALESCE(external_id, $18),
           funnel_id = COALESCE(funnel_id, $19),
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          achado.id, label, sinais.agendou, sinais.compareceu, fechou,
          valorVenda, fechadoEm, perdidoEm, s.responsavelNome, s.temperatura,
          s.contatoNome ?? s.titulo, s.contatoEmail, s.contatoTelefone,
          s.cidade, s.uf, observacao, canal, externalId, funnelId,
        ],
      );
      if (label) await espelharEtapa(pool, clientId, match.funnel_id ?? funnelId, label);
      await pool.query('COMMIT');
      return { leadId: achado.id, criado: false };
    }

    const status = label ?? await getFirstFunnelStageLabel(pool, funnelId);
    // ⚠️ Data do lead = criação NO SULTS, não hoje. É isso que põe negócio
    // antigo no mês certo do funil em vez de empilhar tudo no dia da carga.
    const dataLead = dia(s.dtCadastro) ?? new Date().toISOString().slice(0, 10);

    const { rows: [novo] } = await pool.query<{ id: string }>(
      `INSERT INTO public.crm_leads
         (client_id, mes, data, nome, numero, email, canal, origin, observacao,
          status, funnel_id, valor_rs, revenue, agendou, compareceu, fechou,
          fechado_em, perdido_em, external_id, responsavel, temperatura,
          regiao_cidade, regiao_uf)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,'sults',$8,$9,$10,$11,$11,$12,$13,$14,
               $15::date,$16::date,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        clientId, dataLead.slice(0, 7), dataLead,
        s.contatoNome ?? s.titulo, s.contatoTelefone, s.contatoEmail,
        canal, observacao, status, funnelId, valorVenda,
        sinais.agendou, sinais.compareceu, fechou,
        fechadoEm, perdidoEm, externalId, s.responsavelNome, s.temperatura,
        s.cidade, s.uf,
      ],
    );
    if (label) await espelharEtapa(pool, clientId, funnelId, label);
    await pool.query('COMMIT');
    return { leadId: novo.id, criado: true };
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => null);
    throw err;
  }
}
