/**
 * Integração SULTS (CRM de Expansão) — montagem do negócio a partir do lead.
 *
 * MÃO ÚNICA DE PROPÓSITO: a API de Expansão do SULTS publica criar negócio,
 * listar negócios e listar timeline — e NENHUM webhook de saída. O que sai
 * daqui é só ida (lead nosso → negócio deles). A volta (etapa, ganho/perdido)
 * existe e é legível por GET, mas hoje é conferida em planilha/reunião: por
 * isso o `id` devolvido pelo POST é gravado em `sults_envios.negocio_id` —
 * é a ÚNICA chave que liga as duas bases depois.
 *
 * ⚠️ O payload de criação NÃO tem campo de atribuição (utm, campanha do Meta,
 * criativo). `campanhaId`/`origemId` são IDs de tabelas cadastradas à mão no
 * SULTS, não texto livre. Toda a atribuição fina vai no `descricao` — perder
 * isso foi o motivo de o reports ficar no meio, e não o Make.
 *
 * Pura e client-safe: sem pg, sem fetch.
 */

import { chaveTelefone } from '@/lib/importacao-origem';

/** Colunas de `crm_leads` que o envio consome. */
export type LeadParaSults = {
  id: string;
  nome: string | null;
  numero: string | null;
  email: string | null;
  canal: string | null;
  origin: string | null;
  temperatura: string | null;
  valor_rs: number | string | null;
  regiao_cidade: string | null;
  regiao_uf: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  source_url: string | null;
  created_at: string | Date | null;
};

/** Configuração por cliente (linha de `sults_connections`). */
export type ConfigSults = {
  responsavelId: number | null;
  etapaId: number | null;
  origemId: number | null;
  campanhaId: number | null;
  /** canal/origin do nosso CRM (minúsculo) → origemId do SULTS. Vence `origemId`. */
  mapaOrigem: Record<string, number> | null;
};

export type NegocioSults = {
  titulo: string;
  responsavelId: number;
  etapaId: number;
  valor?: number;
  cidade?: string;
  uf?: string;
  origemId?: number;
  campanhaId?: number;
  temperatura?: number;
  situacaoId?: number;
  descricao?: string;
};

export type PayloadSults = {
  sendNotificationToResponsavel: boolean;
  negocio: NegocioSults;
  pessoa?: { nome?: string; email?: string; phone?: string; cidade?: string; uf?: string };
};

export type ResultadoMontagem =
  | { ok: true; payload: PayloadSults }
  | { ok: false; motivo: string };

const LIMITE_TITULO = 120;
const LIMITE_DESCRICAO = 2000;

function txt(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Telefone no formato que o SULTS espera: só dígitos e SEM o 55.
 *
 * ⚠️ A doc é explícita ("11987654321") e o nosso `numero` guarda com DDI. Mandar
 * `5511987654321` cria o negócio do mesmo jeito — com um telefone que ninguém
 * consegue discar a partir do CRM do cliente, e que não casa com nada na
 * planilha de conferência. `chaveTelefone` já é a régua do repo pra isso.
 */
export function telefoneSults(numero: unknown): string | null {
  return chaveTelefone(numero);
}

/**
 * Temperatura do nosso CRM (texto livre) → escala 1-5 do SULTS.
 *
 * Devolve null quando não reconhece: o campo é opcional lá, e chutar "morno"
 * num lead sem classificação faria o time de expansão priorizar por um dado
 * que nós inventamos.
 */
export function temperaturaSults(t: unknown): number | null {
  const s = String(t ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/gelad/.test(s)) return 1;
  if (/fri/.test(s)) return 2;
  if (/morn/.test(s)) return 3;
  if (/quent/.test(s)) return 4;
  if (/ardent|fervend/.test(s)) return 5;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** origemId pelo canal/origin do lead; cai no padrão da conexão quando não há mapa. */
export function origemSults(lead: LeadParaSults, conf: ConfigSults): number | null {
  const mapa = conf.mapaOrigem ?? {};
  for (const chave of [lead.canal, lead.origin]) {
    const k = String(chave ?? '').trim().toLowerCase();
    if (k && Number.isInteger(mapa[k])) return mapa[k];
  }
  return conf.origemId ?? null;
}

/**
 * Bloco de atribuição que vai no `descricao` — o SULTS não tem onde guardar
 * isso em campo próprio.
 *
 * A primeira linha é sempre o id do lead no reports: é o que permite cruzar as
 * duas bases na planilha mesmo antes de o `negocio_id` voltar pra cá.
 */
export function descricaoAtribuicao(lead: LeadParaSults): string {
  const linhas: string[] = [`Lead reports: ${lead.id}`];
  const par = (rotulo: string, v: unknown) => {
    const s = txt(v, 200);
    if (s) linhas.push(`${rotulo}: ${s}`);
  };
  par('Canal', lead.canal);
  par('Origem', lead.origin);
  par('Campanha (Meta)', lead.campaign_name);
  par('Conjunto', lead.adset_name);
  par('Anúncio', lead.ad_name);
  par('utm_source', lead.utm_source);
  par('utm_medium', lead.utm_medium);
  par('utm_campaign', lead.utm_campaign);
  par('utm_content', lead.utm_content);
  par('utm_term', lead.utm_term);
  par('Página', lead.source_url);
  par('E-mail', lead.email);
  const tel = telefoneSults(lead.numero);
  if (tel) linhas.push(`Telefone: ${tel}`);
  return linhas.join('\n').slice(0, LIMITE_DESCRICAO);
}

/** Título do negócio: nome do lead, com o canal como desempate legível. */
export function tituloNegocio(lead: LeadParaSults): string {
  const nome = txt(lead.nome, 80);
  const canal = txt(lead.canal, 24);
  const base = nome || telefoneSults(lead.numero) || txt(lead.email, 80) || 'Lead sem identificação';
  return (canal ? `${base} — ${canal}` : base).slice(0, LIMITE_TITULO);
}

/**
 * Monta o POST /expansao/negocio, ou recusa com motivo.
 *
 * ⚠️ Recusa em vez de completar: `responsavelId` e `etapaId` são obrigatórios e
 * são IDs de cadastro do cliente, que só existem depois que alguém abriu o
 * SULTS e copiou. Sem eles o POST volta erro e o envio entraria em retry
 * eterno; com um id chutado, o negócio nasce no funil errado, na mão do
 * vendedor errado — e a API não publica DELETE de negócio pra desfazer.
 */
export function montarPayloadSults(lead: LeadParaSults, conf: ConfigSults): ResultadoMontagem {
  if (!Number.isInteger(conf.responsavelId as number) || (conf.responsavelId as number) <= 0) {
    return { ok: false, motivo: 'responsavelId não configurado (Expansão > Parâmetros > Equipe)' };
  }
  if (!Number.isInteger(conf.etapaId as number) || (conf.etapaId as number) <= 0) {
    return { ok: false, motivo: 'etapaId não configurado (Expansão > Parâmetros > Funis > Etapas)' };
  }

  const telefone = telefoneSults(lead.numero);
  const email = txt(lead.email, 120);
  if (!telefone && !email) {
    return { ok: false, motivo: 'lead sem telefone e sem e-mail — negócio nasceria sem contato' };
  }

  const negocio: NegocioSults = {
    titulo: tituloNegocio(lead),
    responsavelId: conf.responsavelId as number,
    etapaId: conf.etapaId as number,
    situacaoId: 1, // 1 ABERTO — lead recém-chegado nunca nasce ganho/perdido
    descricao: descricaoAtribuicao(lead),
  };

  const cidade = txt(lead.regiao_cidade, 80);
  const uf = txt(lead.regiao_uf, 2);
  if (cidade) negocio.cidade = cidade;
  if (uf) negocio.uf = uf.toUpperCase();

  const origemId = origemSults(lead, conf);
  if (origemId) negocio.origemId = origemId;
  if (conf.campanhaId) negocio.campanhaId = conf.campanhaId;

  const temp = temperaturaSults(lead.temperatura);
  if (temp) negocio.temperatura = temp;

  // ⚠️ `valor_rs` NÃO vira `valor`. No reports valor_rs é receita de venda
  // FECHADA; no SULTS `valor` é o ticket estimado de um negócio que está
  // abrindo agora. Copiar faria o funil de expansão do cliente nascer com
  // valor de coisa que já aconteceu — o mesmo erro que inflou a dashboard da
  // Incorpast em 2026-08-21, invertido de lado.

  const pessoa: NonNullable<PayloadSults['pessoa']> = {};
  const nome = txt(lead.nome, 80);
  if (nome) pessoa.nome = nome;
  if (email) pessoa.email = email;
  if (telefone) pessoa.phone = telefone;
  if (cidade) pessoa.cidade = cidade;
  if (uf) pessoa.uf = uf.toUpperCase();

  return {
    ok: true,
    payload: {
      sendNotificationToResponsavel: true,
      negocio,
      ...(Object.keys(pessoa).length ? { pessoa } : {}),
    },
  };
}

// ── VOLTA: SULTS → reports ───────────────────────────────────────────────────
//
// A API de Expansão não tem webhook de saída, então a volta é VARREDURA:
// `GET /expansao/negocio` paginado, comparado com o snapshot anterior. O que
// muda vira movimento. As funções abaixo são a parte pura disso.

/** Negócio como a listagem do SULTS devolve (campos que consumimos). */
export type NegocioRemoto = {
  id?: number | string;
  titulo?: string | null;
  valor?: number | string | null;
  dtCadastro?: string | null;
  dtConclusao?: string | null;
  etapa?: { id?: number; nome?: string; funil?: { id?: number; nome?: string } } | null;
  situacao?: { id?: number; nome?: string } | null;
  responsavel?: { id?: number; nome?: string } | null;
  origem?: { id?: number; nome?: string } | null;
  campanha?: { id?: number; nome?: string } | null;
  temperatura?: { id?: number; nome?: string } | null;
  situacaoPerdaMotivo?: { id?: number; nome?: string } | null;
  duracaoEtapa?: Array<{
    etapa?: { id?: number; nome?: string };
    duracaoMinuto?: number;
    dtPrimeiraVez?: string | null;
    dtUltimaVez?: string | null;
  }> | null;
};

/** Snapshot achatado — é o que gravamos e comparamos entre varreduras. */
export type SnapshotNegocio = {
  negocioId: number;
  titulo: string | null;
  funilId: number | null;
  funilNome: string | null;
  etapaId: number | null;
  etapaNome: string | null;
  situacaoId: number | null;
  situacaoNome: string | null;
  responsavelNome: string | null;
  origemNome: string | null;
  campanhaNome: string | null;
  motivoPerda: string | null;
  valor: number | null;
  dtCadastro: string | null;
  dtConclusao: string | null;
  /** Entrada na etapa ATUAL, lida de `duracaoEtapa` — o timestamp do movimento. */
  entrouNaEtapaEm: string | null;
  /** Minutos acumulados por etapa, para o relatório de tempo de funil. */
  duracaoEtapas: Array<{ etapaId: number | null; etapaNome: string | null; minutos: number }>;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function nome(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

/**
 * Momento em que o negócio entrou na etapa em que está agora.
 *
 * ⚠️ É `dtUltimaVez` da linha de `duracaoEtapa` que casa com a etapa atual —
 * NÃO `dtPrimeiraVez`. Negócio que voltou de etapa (avançou, regrediu, avançou)
 * tem primeira e última vez diferentes, e o movimento que acabou de acontecer é
 * o último. Sem isso, o tempo em etapa de um lead que voltou seria contado
 * desde a primeira passagem, inflando o número.
 */
export function entradaNaEtapa(n: NegocioRemoto): string | null {
  const etapaId = num(n.etapa?.id);
  if (etapaId === null || !Array.isArray(n.duracaoEtapa)) return null;
  for (const d of n.duracaoEtapa) {
    if (num(d?.etapa?.id) === etapaId) return nome(d?.dtUltimaVez) ?? nome(d?.dtPrimeiraVez);
  }
  return null;
}

/** Achata o negócio da API no snapshot. Devolve null se nem id tiver. */
export function normalizarNegocio(n: NegocioRemoto): SnapshotNegocio | null {
  const negocioId = num(n?.id);
  if (negocioId === null || negocioId <= 0) return null;

  return {
    negocioId,
    titulo: nome(n.titulo),
    funilId: num(n.etapa?.funil?.id),
    funilNome: nome(n.etapa?.funil?.nome),
    etapaId: num(n.etapa?.id),
    etapaNome: nome(n.etapa?.nome),
    situacaoId: num(n.situacao?.id),
    situacaoNome: nome(n.situacao?.nome),
    responsavelNome: nome(n.responsavel?.nome),
    origemNome: nome(n.origem?.nome),
    campanhaNome: nome(n.campanha?.nome),
    motivoPerda: nome(n.situacaoPerdaMotivo?.nome),
    valor: num(n.valor),
    dtCadastro: nome(n.dtCadastro),
    dtConclusao: nome(n.dtConclusao),
    entrouNaEtapaEm: entradaNaEtapa(n),
    duracaoEtapas: (Array.isArray(n.duracaoEtapa) ? n.duracaoEtapa : []).map(d => ({
      etapaId: num(d?.etapa?.id),
      etapaNome: nome(d?.etapa?.nome),
      minutos: num(d?.duracaoMinuto) ?? 0,
    })),
  };
}

export type MovimentoNegocio = {
  negocioId: number;
  etapaDeId: number | null;
  etapaDeNome: string | null;
  etapaParaId: number | null;
  etapaParaNome: string | null;
  situacaoDeId: number | null;
  situacaoDeNome: string | null;
  situacaoParaId: number | null;
  situacaoParaNome: string | null;
  ocorridoEm: string;
};

/**
 * Compara duas varreduras e devolve o movimento, se houve.
 *
 * ⚠️ PRIMEIRA VEZ NÃO É MOVIMENTO. `anterior === null` devolve null de
 * propósito: a primeira varredura de um funil que já existe veria centenas de
 * negócios pela primeira vez e inventaria um "mudou de etapa" para cada um,
 * todos com a data de hoje. O histórico do relatório nasceria mentindo. O
 * estado inicial fica no snapshot; movimento só quando algo de fato muda.
 *
 * ⚠️ Só etapa e situação contam. Editar título, valor ou responsável no SULTS
 * não é movimentação de funil — entra no snapshot, não no histórico.
 */
export function diffNegocio(
  anterior: SnapshotNegocio | null,
  atual: SnapshotNegocio,
  agoraIso: string,
): MovimentoNegocio | null {
  if (!anterior) return null;

  const mudouEtapa = anterior.etapaId !== atual.etapaId;
  const mudouSituacao = anterior.situacaoId !== atual.situacaoId;
  if (!mudouEtapa && !mudouSituacao) return null;

  return {
    negocioId: atual.negocioId,
    etapaDeId: anterior.etapaId,
    etapaDeNome: anterior.etapaNome,
    etapaParaId: atual.etapaId,
    etapaParaNome: atual.etapaNome,
    situacaoDeId: anterior.situacaoId,
    situacaoDeNome: anterior.situacaoNome,
    situacaoParaId: atual.situacaoId,
    situacaoParaNome: atual.situacaoNome,
    // A data do SULTS vence o relógio da varredura: o movimento aconteceu
    // quando o vendedor arrastou o card, não quando o cron reparou. Só vale
    // para mudança de ETAPA — `duracaoEtapa` não registra troca de situação.
    ocorridoEm: (mudouEtapa && atual.entrouNaEtapaEm) || agoraIso,
  };
}
