/**
 * Integração Agendor (CRM externo) — normalização de negócios e pessoas.
 *
 * Duas fontes alimentam o mesmo funil:
 *  1. WEBHOOK (tempo real): o Agendor manda o evento quando negócio é criado /
 *     muda de etapa / é ganho ou perdido. ⚠️ O shape do ENVELOPE não é
 *     documentado — a extração é tolerante (entidade na raiz ou dentro de
 *     wrappers comuns) e o payload cru vai SEMPRE pro agendor_log; ajuste de
 *     aliases acontece AQUI e só aqui, depois da primeira entrega real.
 *  2. API v3 (backfill + reconciliação): GET /deals e /deals/movements_history
 *     devolvem DealEntity/FullDealEntity, cujo shape É documentado — o mesmo
 *     normalizador cobre os dois.
 *
 * ⚠️ O negócio referencia a pessoa como LeanPersonEntity (id, name, email) —
 * SEM telefone. O telefone (chave de casamento com o nosso CRM) vem de um GET
 * /people/{id} feito pelo chamador com o token do cliente; aqui só extraímos.
 *
 * Pura e client-safe: sem pg, sem fetch.
 */

import { chaveTelefone } from '@/lib/importacao-origem';

export type StatusNegocio = 'andamento' | 'ganho' | 'perdido';

export type NegocioAgendor = {
  /** Id do negócio no Agendor — vira external_id `agendor:{id}` no CRM. */
  idExterno: string;
  titulo: string | null;
  valor: number | null;
  /** Nome legível da etapa (dealStage.name) — espelhável no Kanban. */
  etapa: string | null;
  /** Funil do Agendor a que o negócio pertence (dealStage.funnel) — base do filtro de importação. */
  funilId: string | null;
  funilNome: string | null;
  status: StatusNegocio;
  ganhoEm: string | null;
  perdidoEm: string | null;
  motivoPerda: string | null;
  pessoa: { id: string | null; nome: string | null; email: string | null };
  organizacao: string | null;
  organizacaoId: string | null;
  descricao: string | null;
  criadoEm: string | null;
};

export type PessoaAgendor = {
  id: string | null;
  nome: string | null;
  email: string | null;
  /** Já normalizado por chaveTelefone (dígitos, sem DDI 55). */
  telefone: string | null;
  /** Como veio (pro campo `numero` ao criar o lead). */
  telefoneBruto: string | null;
  cidade: string | null;
  estado: string | null;
  origemLead: string | null;
  origemLeadId: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== 'null' && s !== 'undefined' ? s : null;
};

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(',', '.'));
  return isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};

/**
 * Status do negócio. O Agendor modela como dealStatus {id, name} com nomes em
 * português ("Em andamento" / "Ganho" / "Perdido"); wonAt/lostAt são a
 * confirmação por data. Data vence o rótulo: um payload com wonAt preenchido é
 * ganho mesmo que o dealStatus venha ausente/estranho.
 */
export function statusDoNegocio(d: Obj): StatusNegocio {
  if (str(d.wonAt)) return 'ganho';
  if (str(d.lostAt)) return 'perdido';
  const nome = (str(obj(d.dealStatus)?.name) ?? '').toLowerCase();
  if (nome.startsWith('ganh') || nome === 'won') return 'ganho';
  if (nome.startsWith('perd') || nome === 'lost') return 'perdido';
  return 'andamento';
}

/** Um objeto "parece um negócio" se tem cara de DealEntity. */
function pareceNegocio(d: Obj): boolean {
  return ('dealStage' in d || 'dealStatus' in d || 'wonAt' in d) && ('title' in d || 'value' in d || 'id' in d);
}

/** Um objeto "parece uma pessoa" se tem os campos de PersonEntity. */
function parecePessoa(d: Obj): boolean {
  return ('contact' in d || 'cpf' in d || 'leadOrigin' in d) && 'name' in d && !('dealStage' in d);
}

export function normalizarNegocio(d: Obj): NegocioAgendor | null {
  const id = str(d.id);
  if (!id) return null;
  const pessoa = obj(d.person);
  const etapaObj = obj(d.dealStage);
  const funilObj = obj(etapaObj?.funnel);
  return {
    idExterno: id,
    titulo: str(d.title),
    valor: num(d.value),
    // dealStage pode vir como objeto {name} (API) ou string solta (webhook).
    etapa: str(etapaObj?.name) ?? (typeof d.dealStage === 'string' ? str(d.dealStage) : null),
    funilId: str(funilObj?.id),
    funilNome: str(funilObj?.name),
    status: statusDoNegocio(d),
    ganhoEm: str(d.wonAt),
    perdidoEm: str(d.lostAt),
    motivoPerda: str(obj(d.lossReason)?.name),
    pessoa: {
      id: str(pessoa?.id),
      nome: str(pessoa?.name),
      email: str(pessoa?.email),
    },
    organizacao: str(obj(d.organization)?.name),
    organizacaoId: str(obj(d.organization)?.id),
    descricao: str(d.description),
    criadoEm: str(d.createdAt),
  };
}

/**
 * PersonEntity → pessoa com telefone. Preferência: whatsapp → mobile → work —
 * o WhatsApp é a identidade que casa com o CRM (leads chegam por lá).
 */
export function normalizarPessoa(p: Obj): PessoaAgendor {
  const contato = obj(p.contact) ?? {};
  const bruto = str(contato.whatsapp) ?? str(contato.mobile) ?? str(contato.work);
  const endereco = obj(p.address) ?? {};
  return {
    id: str(p.id),
    nome: str(p.name),
    email: str(p.email) ?? str(contato.email),
    telefone: chaveTelefone(bruto),
    telefoneBruto: bruto,
    cidade: str(endereco.city),
    estado: str(endereco.state),
    origemLead: str(obj(p.leadOrigin)?.name),
    origemLeadId: str(obj(p.leadOrigin)?.id),
  };
}

export type EventoAgendor =
  | { tipo: 'negocio'; evento: string | null; negocio: NegocioAgendor }
  | { tipo: 'pessoa'; evento: string | null; pessoa: PessoaAgendor }
  | { tipo: 'desconhecido'; evento: string | null };

/**
 * Desembrulha o payload do WEBHOOK. O envelope não é documentado, então
 * procura a entidade na raiz e 1 nível dentro dos wrappers usuais — raiz
 * vence (mesma regra do Datalytics).
 */
export function extrairEventoAgendor(raw: unknown): EventoAgendor {
  const base = obj(raw) ?? {};
  const evento = str(base.event) ?? str(base.event_type) ?? str(base.trigger);
  const candidatos: Obj[] = [base];
  for (const k of ['data', 'current', 'deal', 'person', 'body', 'payload', 'entity']) {
    const c = obj(base[k]);
    if (c) candidatos.push(c);
  }
  for (const c of candidatos) {
    if (pareceNegocio(c)) {
      const n = normalizarNegocio(c);
      if (n) return { tipo: 'negocio', evento, negocio: n };
    }
  }
  for (const c of candidatos) {
    if (parecePessoa(c)) {
      return { tipo: 'pessoa', evento, pessoa: normalizarPessoa(c) };
    }
  }
  return { tipo: 'desconhecido', evento };
}

// ---------------------------------------------------------------- filtros

export type FiltrosImportacao = {
  /** Ids de funil do Agendor permitidos; null/[] = todos. */
  funis: string[] | null;
  /** Ids de origem de lead permitidos; null/[] = todas. */
  origens: string[] | null;
};

/**
 * O negócio passa nos filtros de importação do cliente?
 *
 * Regra deliberadamente PERMISSIVA no desconhecido: filtro de funil ligado +
 * negócio sem informação de funil no payload → PASSA (com o chamador tendo
 * tentado resolver antes via API). Bloquear no desconhecido perderia negócio
 * legítimo em silêncio — o custo de um indesejado entrar é visível e
 * reversível; o de um legítimo sumir, não.
 */
export function passaFiltros(
  filtros: FiltrosImportacao,
  negocio: NegocioAgendor,
  pessoa: PessoaAgendor | null,
  opts?: {
    /**
     * A busca da pessoa FALHOU (rate limit/rede) — origem é desconhecida, não
     * ausente. Barrar aqui descartaria negócio legítimo por um 429 passageiro
     * (visto ao vivo na reimportação da Cinfel); desconhecido passa, e a
     * reconciliação seguinte completa os dados.
     */
    origemDesconhecida?: boolean;
  },
): { passa: boolean; motivo: string | null } {
  if (filtros.funis && filtros.funis.length > 0 && negocio.funilId !== null) {
    if (!filtros.funis.includes(negocio.funilId)) {
      return { passa: false, motivo: `funil "${negocio.funilNome ?? negocio.funilId}" fora do filtro` };
    }
  }
  if (filtros.origens && filtros.origens.length > 0) {
    if (opts?.origemDesconhecida) return { passa: true, motivo: null };
    const id = pessoa?.origemLeadId ?? null;
    // Origem conhecida e fora da lista → barra. Pessoa sem origem cadastrada
    // no Agendor conta como "fora" quando há filtro — origem específica foi
    // pedida justamente pra excluir o resto.
    if (id === null || !filtros.origens.includes(id)) {
      return { passa: false, motivo: `origem "${pessoa?.origemLead ?? 'sem origem'}" fora do filtro` };
    }
  }
  return { passa: true, motivo: null };
}

/** Normaliza o JSONB salvo (array de ids como strings; lixo → null = sem filtro). */
export function parseFiltro(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v.map(x => str(x)).filter((x): x is string => x !== null);
  return ids.length > 0 ? ids : null;
}
