/**
 * Lógica PURA do painel do Início. Sem banco, sem fetch, sem `Date.now()`.
 *
 * O "agora" entra por parâmetro para o teste ser determinístico — mesmo motivo
 * de `autoPreviousPeriod` em delivery-report-builder receber as datas em vez de
 * ler o relógio.
 */

export type Severidade = 'critico' | 'atencao' | 'info';

/**
 * ⚠️ O driver `pg` devolve `timestamptz` como objeto **Date**, e `Date` não tem
 * `.localeCompare` — ordenar direto lança TypeError. Com as tabelas vazias isso
 * nunca acontecia, então passou por tsc, build e testes (que usam string, como
 * o tipo declara). Descoberto na primeira carga real do Cardápio Web, onde o
 * mesmo padrão derrubou a rota do painel de delivery.
 */
export function paraIso(v: string | Date | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v);
}

export const RANK_SEVERIDADE: Record<Severidade, number> = { critico: 0, atencao: 1, info: 2 };

/**
 * Desempate DENTRO da mesma severidade. A severidade decide primeiro — é ela
 * que faz "conta seca em 1 dia" (crítico) passar na frente de "tarefa atrasada
 * há 3 dias" (atenção). Aqui só resolvemos empates.
 */
const PESO_TIPO: Record<string, number> = {
  saldo: 0, instancia: 1, cpl: 2, social: 3, agenda: 4, reuniao: 5, relatorio: 6, sistema: 7,
};

export type NotificacaoBruta = {
  id: string;
  tipo: string;
  severidade: string;
  titulo: string;
  descricao: string | null;
  href: string | null;
  client_id: string | null;
  importante: boolean;
  lida_em: string | Date | null;
  created_at: string | Date;
};

export type ItemFeed = {
  id: string;
  tipo: string;
  severidade: Severidade;
  titulo: string;
  descricao: string | null;
  href: string | null;
  clientId: string | null;
  clienteNome: string | null;
  meu: boolean;
  lida: boolean;
  importante: boolean;
  criadoEm: string;
};

export type ClienteRef = { id: string; name: string; gestor_id?: string | null };

function severidadeDe(v: string): Severidade {
  return v === 'critico' || v === 'atencao' ? v : 'info';
}

/**
 * `meu` = sou o gestor do cliente. Notificação da agência (sem cliente) não é
 * de ninguém em particular, então não conta como minha.
 */
export function normalizarFeed(
  rows: NotificacaoBruta[], clientes: ClienteRef[], userId: string,
): ItemFeed[] {
  const porId = new Map(clientes.map(c => [c.id, c]));
  return rows.map(r => {
    const c = r.client_id ? porId.get(r.client_id) : undefined;
    return {
      id: r.id,
      tipo: r.tipo,
      severidade: severidadeDe(r.severidade),
      titulo: r.titulo,
      descricao: r.descricao,
      href: r.href,
      clientId: r.client_id,
      clienteNome: c?.name ?? null,
      meu: Boolean(c && c.gestor_id && c.gestor_id === userId),
      lida: r.lida_em !== null,
      importante: r.importante,
      criadoEm: paraIso(r.created_at),
    };
  });
}

/** Não lidas primeiro, depois severidade, depois tipo, depois mais recente. */
export function ordenarFeed(itens: ItemFeed[]): ItemFeed[] {
  return [...itens].sort((a, b) =>
    Number(a.lida) - Number(b.lida)
    || RANK_SEVERIDADE[a.severidade] - RANK_SEVERIDADE[b.severidade]
    || (PESO_TIPO[a.tipo] ?? 9) - (PESO_TIPO[b.tipo] ?? 9)
    || b.criadoEm.localeCompare(a.criadoEm),
  );
}

export type GrupoConta = {
  clientId: string | null;
  clienteNome: string | null;
  meu: boolean;
  pior: Severidade;
  itens: ItemFeed[];
};

/**
 * Agrupa por CONTA, não por sinal: o gestor pensa "o cliente X está com
 * problema", não "tenho 3 alertas de CPL". Itens sem cliente (da agência)
 * ficam num grupo próprio no fim.
 */
export function agruparPorConta(itens: ItemFeed[]): GrupoConta[] {
  const grupos = new Map<string, GrupoConta>();
  for (const it of ordenarFeed(itens)) {
    const chave = it.clientId ?? '__agencia__';
    let g = grupos.get(chave);
    if (!g) {
      g = { clientId: it.clientId, clienteNome: it.clienteNome, meu: it.meu, pior: it.severidade, itens: [] };
      grupos.set(chave, g);
    }
    g.itens.push(it);
    if (RANK_SEVERIDADE[it.severidade] < RANK_SEVERIDADE[g.pior]) g.pior = it.severidade;
    g.meu = g.meu || it.meu;
  }
  return [...grupos.values()].sort((a, b) =>
    // Sem cliente vai pro fim; entre contas, a pior primeiro.
    Number(a.clientId === null) - Number(b.clientId === null)
    || RANK_SEVERIDADE[a.pior] - RANK_SEVERIDADE[b.pior]
    || (a.clienteNome ?? '').localeCompare(b.clienteNome ?? ''),
  );
}

/**
 * Separa a carteira do gestor do resto da agência.
 *
 * Ninguém perde visibilidade — o resto vem recolhido, não escondido. Isso
 * respeita a decisão do commit `9ecc921`, que liberou todos os clientes para
 * todos os usuários de propósito.
 */
export function separarCarteira(grupos: GrupoConta[]): { meus: GrupoConta[]; outros: GrupoConta[] } {
  return { meus: grupos.filter(g => g.meu), outros: grupos.filter(g => !g.meu) };
}

// ---------------------------------------------------------------- Quadro

export type NotaBruta = {
  id: string;
  cliente_id: string;
  texto: string;
  categoria: string | null;
  status: string | null;
  prazo_em: string | Date | null;
  autor_id: string | null;
  autor_nome: string | null;
  created_at: string | Date;
};

export type CardQuadro = {
  id: string;
  clientId: string;
  clienteNome: string | null;
  texto: string;
  categoria: string | null;
  status: 'rapida' | 'andamento';
  prazoEm: string | null;
  atrasada: boolean;
  autorNome: string | null;
  meu: boolean;
  criadoEm: string;
};

export type Quadro = { rapida: CardQuadro[]; andamento: CardQuadro[] };

/**
 * Monta as duas colunas do quadro. `concluida` não entra — nem aqui, nem no
 * prompt do Otimizador (ver `loadManualNotesContext` em weekly/route.ts).
 */
export function montarQuadro(
  notas: NotaBruta[], clientes: ClienteRef[], userId: string, agora: Date,
): Quadro {
  const porId = new Map(clientes.map(c => [c.id, c]));
  const t = agora.getTime();

  const cards = notas
    .filter(n => (n.status ?? 'rapida') !== 'concluida')
    .map<CardQuadro>(n => {
      const c = porId.get(n.cliente_id);
      const prazoIso = paraIso(n.prazo_em);
      const prazo = prazoIso ? new Date(prazoIso).getTime() : NaN;
      return {
        id: n.id,
        clientId: n.cliente_id,
        clienteNome: c?.name ?? null,
        texto: n.texto,
        categoria: n.categoria,
        status: (n.status ?? 'rapida') === 'andamento' ? 'andamento' : 'rapida',
        prazoEm: prazoIso || null,
        atrasada: Number.isFinite(prazo) && prazo < t,
        autorNome: n.autor_nome,
        // Nota é "minha" por autoria OU por ser de cliente que eu gerencio.
        meu: n.autor_id === userId || Boolean(c && c.gestor_id && c.gestor_id === userId),
        criadoEm: paraIso(n.created_at),
      };
    })
    // Atrasada primeiro, depois quem tem prazo mais próximo, depois mais recente.
    .sort((a, b) =>
      Number(b.atrasada) - Number(a.atrasada)
      || Number(Boolean(b.prazoEm)) - Number(Boolean(a.prazoEm))
      || (a.prazoEm ?? '').localeCompare(b.prazoEm ?? '')
      || b.criadoEm.localeCompare(a.criadoEm),
    );

  return {
    rapida: cards.filter(c => c.status === 'rapida'),
    andamento: cards.filter(c => c.status === 'andamento'),
  };
}

// ---------------------------------------------------------------- Cobertura

export type AvisoCobertura = { texto: string; href: string };

/**
 * Avisos de "não estou vendo tudo".
 *
 * O cron de saldo só avalia conta que tem destino em `balance_alert_configs`.
 * Conta sem destino nunca é avaliada e apareceria como "tudo em dia" — o painel
 * precisa dizer isso em voz alta, senão o vazio mente.
 */
export function avisosCobertura(input: {
  clientesSemAlertaSaldo: number;
  fontesComFalha: string[];
}): AvisoCobertura[] {
  const avisos: AvisoCobertura[] = [];
  if (input.clientesSemAlertaSaldo > 0) {
    avisos.push({
      texto: `${input.clientesSemAlertaSaldo} conta(s) sem alerta de saldo configurado — não são avaliadas.`,
      href: '/pagamentos',
    });
  }
  for (const f of input.fontesComFalha) {
    avisos.push({ texto: `Não foi possível carregar: ${f}. O painel está incompleto.`, href: '#' });
  }
  return avisos;
}
