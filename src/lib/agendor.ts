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
  /** Responsável pela venda (`owner.name`) — 100% preenchido nas contas medidas. */
  responsavel: string | null;
  responsavelId: string | null;
  /**
   * Valor ESTIMADO do negócio, venha ele ganho, perdido ou aberto.
   *
   * ⚠️ NÃO é faturamento e nunca pode virar `valor_rs`. O sistema inteiro
   * assume "tem valor = vendeu" (`crm/summary` classifica `valor > 0` como
   * fechado), e foi gravar valor de negócio ABERTO que inflou a dashboard da
   * Incorpast em 2026-08-21. Existe para o painel "quem vendeu mais", que
   * precisa somar perdidos e novos — coluna própria, longe da receita.
   */
  valorEstimado: number | null;
  produtos: ProdutoAgendor[];
  /** Link do negócio no Agendor (`_webUrl`). */
  linkExterno: string | null;
  /**
   * Origem descoberta pelo FILTRO de importação (`conferirFiltros`), quando o
   * negócio não tem pessoa e ela veio da ficha da ORGANIZAÇÃO.
   *
   * ⚠️ Existe porque a descoberta estava sendo jogada fora. O filtro buscava a
   * organização, via "Google", deixava o negócio passar — e a gravação, que só
   * olhava `pessoa?.origemLead` (null em B2B), escrevia `canal = 'agendor'`.
   * Resultado medido na Londrigifts, agosto/2026: 12 vendas de R$ 30.142,50
   * aparecendo como "canal não informado" quando as 12 eram Google.
   *
   * Viaja DENTRO do negócio de propósito: os dois chamadores já repassam o
   * negócio devolvido pelo filtro, então nenhum deles precisa mudar.
   */
  origemResolvida?: string | null;
};

/** Item vendido no negócio — a base do painel de categorias mais vendidas. */
export type ProdutoAgendor = {
  nome: string | null;
  categoria: string | null;
  quantidade: number | null;
  valorTotal: number | null;
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
    responsavel: str(obj(d.owner)?.name),
    responsavelId: str(obj(d.owner)?.id),
    valorEstimado: num(d.value),
    produtos: normalizarProdutos(d.products_entities ?? d.products),
    linkExterno: str(d._webUrl),
  };
}

/**
 * Produtos do negócio.
 *
 * ⚠️ Lê `products_entities` (que traz quantidade/valor) e cai em `products`
 * (só o catálogo) — o webhook manda um, a API manda os dois. Item sem
 * categoria entra como null e a tela agrupa em "Sem categoria": inventar um
 * rótulo aqui esconderia lacuna de cadastro do cliente.
 */
export function normalizarProdutos(v: unknown): ProdutoAgendor[] {
  if (!Array.isArray(v)) return [];
  const out: ProdutoAgendor[] = [];
  for (const item of v.slice(0, 60)) {
    const p = obj(item);
    if (!p) continue;
    const nome = str(p.name);
    const categoria = str(p.category) ?? str(obj(p.category)?.name);
    if (!nome && !categoria) continue;
    out.push({
      nome,
      categoria,
      quantidade: num(p.quantity),
      valorTotal: num(p.totalValue),
    });
  }
  return out;
}

/**
 * Canal do lead: o que TROUXE o cliente, não a porta por onde o dado entrou.
 *
 * Ordem: origem da PESSOA → origem resolvida na ficha da EMPRESA → marca da
 * fonte ('agendor').
 *
 * ⚠️ O degrau do meio existe por um bug real (Londrigifts, agosto/2026): o
 * filtro de importação buscava a organização, via "Google" e deixava o negócio
 * passar — mas a gravação só olhava a pessoa, que em B2B é null, e escrevia
 * 'agendor'. 12 vendas de R$ 30.142,50 apareceram como "canal não informado"
 * sendo que as 12 eram Google, e o gestor sabia que não podia ser: só Google,
 * Instagram e Email MKT passam no filtro dele.
 */
export function canalDoNegocio(
  pessoa: { origemLead?: string | null } | null,
  negocio: { origemResolvida?: string | null },
): string {
  return pessoa?.origemLead?.trim() || negocio.origemResolvida?.trim() || 'agendor';
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
    // ⚠️ Origem NÃO verificada (a busca da pessoa/empresa falhou, tipicamente
    // 429 do Agendor) não pode entrar quando há filtro de origem. A regra
    // anterior deixava passar "pra não perder negócio por um 429 passageiro" —
    // mas nestas contas o 429 é SISTEMÁTICO, então a peneira virava um buraco:
    // 701 dos 748 negócios da Londrigifts entraram sem verificação nenhuma e
    // o faturamento da dashboard subiu R$ 462 mil (auditoria 2026-08-22).
    // O negócio não é descartado pra sempre: a página é refeita quando há
    // muitas falhas e a reconciliação por updatedAtGt volta a vê-lo.
    if (opts?.origemDesconhecida) {
      return { passa: false, motivo: 'origem não verificada (limite de requisições) — será tentado de novo' };
    }
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
