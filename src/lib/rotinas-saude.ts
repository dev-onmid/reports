import type { Pool } from 'pg';

/**
 * Painel de saúde das rotinas (Configurações → Rotinas, só Administrador).
 *
 * O painel cruza DOIS sinais, porque cada um sozinho mente:
 *
 *  1. EXECUÇÃO — o cron da VPS rodou? Vem dos arquivos `/tmp/onmid-*.last` que
 *     cada linha da crontab escreve, copiados a cada 5 min para um diretório
 *     montado no container (`CRON_STATUS_DIR`). O mtime diz QUANDO terminou e o
 *     corpo diz O QUE a rota respondeu.
 *
 *  2. EFEITO — a rotina produziu alguma coisa? Vem da última gravação na tabela
 *     que ela alimenta.
 *
 * ⚠️ Só o efeito não serve: rotina que roda e não acha trabalho (disparo sem
 * campanha, follow-up sem lead vencendo) ficaria eternamente "parada". Só a
 * execução também não serve: o cron pode estar rodando e a rota devolvendo erro
 * silencioso há semanas — foi exatamente assim que a duplicação do SULTS e o
 * alerta de saldo passaram despercebidos. Por isso os dois, lado a lado.
 */

export type GrupoRotina = 'crm' | 'integracoes' | 'anuncios' | 'envios' | 'relatorios';

export const GRUPOS: { id: GrupoRotina; nome: string }[] = [
  { id: 'crm', nome: 'CRM e atendimento' },
  { id: 'integracoes', nome: 'Integrações' },
  { id: 'anuncios', nome: 'Anúncios' },
  { id: 'envios', nome: 'Envios automáticos' },
  { id: 'relatorios', nome: 'Relatórios' },
];

type Rastro = {
  /** Rótulo do que a última gravação representa ("último pedido", "última mensagem"). */
  rotulo: string;
  sql: string;
  /** Acima disso o rastro vira alerta. Em rotina `ocioso`, vira só informação. */
  toleranciaMin: number;
};

export type DefRotina = {
  id: string;
  nome: string;
  grupo: GrupoRotina;
  oQueFaz: string;
  /** Texto humano da cadência, sempre em horário de Brasília. */
  cadencia: string;
  /** Minutos esperados entre duas execuções. */
  intervaloMin: number;
  /** Arquivo de saída do cron (nome dentro de CRON_STATUS_DIR). */
  arquivo: string;
  /**
   * `true` quando "não fez nada" é o estado normal — a rotina só age se houver
   * trabalho. Nessas, a ausência de rastro recente NÃO é alarme.
   */
  ocioso?: boolean;
  rastro?: Rastro;
};

const MIN = 1;
const HORA = 60;
const DIA = 24 * HORA;

/**
 * ⚠️ Esta lista espelha a crontab da VPS (`crontab -l | grep onmid-cron`).
 * Rotina nova lá = linha nova aqui, senão ela nunca aparece no painel e o
 * silêncio dela fica invisível — que é justamente o problema que o painel existe
 * para resolver.
 */
export const ROTINAS: DefRotina[] = [
  // ── CRM e atendimento ─────────────────────────────────────────────────────
  {
    id: 'crmsync',
    nome: 'Conversas do WhatsApp',
    grupo: 'crm',
    oQueFaz: 'Traz as conversas das instâncias Evolution para o CRM e reaponta webhook que tenha caído.',
    cadencia: 'a cada 10 minutos',
    intervaloMin: 10 * MIN,
    arquivo: 'onmid-crmsync.last',
    rastro: {
      rotulo: 'última mensagem recebida',
      sql: `SELECT MAX(created_at) AS t FROM public.crm_messages`,
      toleranciaMin: 2 * HORA,
    },
  },
  {
    id: 'rotina-crm',
    nome: 'Análise e nota de atendimento',
    grupo: 'crm',
    oQueFaz: 'Lê as conversas do dia, move o Kanban de quem não tem integração e dá nota ao atendimento.',
    cadencia: 'todo dia às 03h30',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-rotina-cron.last',
    rastro: {
      rotulo: 'última conversa analisada',
      sql: `SELECT MAX(created_at) AS t FROM public.crm_rotina_log`,
      toleranciaMin: 2 * DIA,
    },
  },
  {
    id: 'followup',
    nome: 'Follow-up do CRM',
    grupo: 'crm',
    oQueFaz: 'Dispara as mensagens de follow-up programadas por etapa do funil.',
    cadencia: 'a cada 5 minutos, das 07h às 20h',
    intervaloMin: 5 * MIN,
    arquivo: 'onmid-followup.last',
    ocioso: true,
    rastro: {
      rotulo: 'último follow-up enviado',
      sql: `SELECT MAX(enviado_em) AS t FROM public.crm_followup_execucoes`,
      toleranciaMin: 7 * DIA,
    },
  },
  {
    id: 'lembretes',
    nome: 'Lembretes de follow-up',
    grupo: 'crm',
    oQueFaz: 'Avisa o time sobre follow-up vencendo.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-lembretes.last',
    ocioso: true,
  },
  {
    id: 'lead-aviso',
    nome: 'Aviso de lead novo',
    grupo: 'crm',
    oQueFaz: 'Manda no WhatsApp o aviso de lead que acabou de entrar.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-lead-aviso.last',
    ocioso: true,
    rastro: {
      rotulo: 'último aviso enviado',
      sql: `SELECT MAX(created_at) AS t FROM public.lead_aviso_envios`,
      toleranciaMin: 2 * DIA,
    },
  },

  // ── Integrações ───────────────────────────────────────────────────────────
  {
    id: 'agendor',
    nome: 'Agendor',
    grupo: 'integracoes',
    oQueFaz: 'Importa negócios e mudanças de etapa do CRM Agendor dos clientes conectados.',
    cadencia: 'a cada 15 minutos',
    intervaloMin: 15 * MIN,
    arquivo: 'onmid-agendor.last',
    rastro: {
      rotulo: 'último evento recebido',
      sql: `SELECT MAX(created_at) AS t FROM public.agendor_log`,
      toleranciaMin: 6 * HORA,
    },
  },
  {
    id: 'cardapioweb',
    nome: 'Cardápio Web',
    grupo: 'integracoes',
    oQueFaz: 'Busca os pedidos de delivery das lojas conectadas ao Cardápio Web.',
    cadencia: 'de hora em hora',
    intervaloMin: 1 * HORA,
    arquivo: 'onmid-cardapioweb.last',
    rastro: {
      rotulo: 'último pedido importado',
      sql: `SELECT MAX(created_at) AS t FROM public.cardapioweb_orders`,
      toleranciaMin: 12 * HORA,
    },
  },
  {
    id: 'anotaai',
    nome: 'Anota AI',
    grupo: 'integracoes',
    oQueFaz: 'Busca os pedidos do dia nas lojas conectadas ao Anota AI.',
    cadencia: 'de hora em hora',
    intervaloMin: 1 * HORA,
    arquivo: 'onmid-anotaai.last',
    rastro: {
      rotulo: 'último pedido importado',
      sql: `SELECT MAX(created_at) AS t FROM public.anotaai_orders`,
      toleranciaMin: 12 * HORA,
    },
  },
  {
    id: 'anotaai-fimdodia',
    nome: 'Anota AI — fechamento do dia',
    grupo: 'integracoes',
    oQueFaz: 'Passada final do dia, para capturar o status dos pedidos que fecham tarde.',
    cadencia: 'todo dia às 23h55',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-anotaai-fimdodia.last',
    ocioso: true,
  },
  {
    id: 'sults-sync',
    nome: 'SULTS — trazer movimentação',
    grupo: 'integracoes',
    oQueFaz: 'Varre o funil do SULTS e traz as mudanças de etapa dos negócios.',
    cadencia: 'a cada 10 minutos',
    intervaloMin: 10 * MIN,
    arquivo: 'onmid-sults-sync.last',
    rastro: {
      rotulo: 'última varredura',
      sql: `SELECT MAX(visto_em) AS t FROM public.sults_negocios`,
      toleranciaMin: 1 * HORA,
    },
  },
  {
    id: 'sults',
    nome: 'SULTS — enviar leads',
    grupo: 'integracoes',
    oQueFaz: 'Manda para o SULTS os leads novos dos clientes conectados.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-sults.last',
    ocioso: true,
    rastro: {
      rotulo: 'último lead enviado',
      sql: `SELECT MAX(enviado_em) AS t FROM public.sults_envios`,
      toleranciaMin: 2 * DIA,
    },
  },
  {
    id: 'sorrifacil',
    nome: 'Planilhas da Sorrifácil',
    grupo: 'integracoes',
    oQueFaz: 'Entra no CRM da Sorrifácil, baixa os relatórios de Leads e Faturamento e importa.',
    cadencia: 'todo dia às 06h',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-sorrifacil.last',
    rastro: {
      rotulo: 'última planilha importada',
      sql: `SELECT MAX(created_at) AS t FROM public.crm_uploads`,
      toleranciaMin: 2 * DIA,
    },
  },
  {
    id: 'sheets',
    nome: 'Planilhas do Google',
    grupo: 'integracoes',
    oQueFaz: 'Lê as planilhas do Drive que os clientes compartilharam e importa como leads/vendas.',
    cadencia: 'todo dia às 08h',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-sheets.last',
    rastro: {
      rotulo: 'última planilha lida',
      sql: `SELECT MAX(ultima_sync) AS t FROM public.client_sheets WHERE ativo`,
      toleranciaMin: 2 * DIA,
    },
  },
  {
    id: 'leadgen',
    nome: 'Formulários da Meta',
    grupo: 'integracoes',
    oQueFaz: 'Mantém as Páginas dos clientes assinadas para receber lead de formulário nativo.',
    cadencia: 'todo dia às 09h20',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-leadgen.last',
    rastro: {
      rotulo: 'última conferência',
      sql: `SELECT MAX(checked_at) AS t FROM public.meta_leadgen_paginas`,
      toleranciaMin: 2 * DIA,
    },
  },

  // ── Anúncios ──────────────────────────────────────────────────────────────
  {
    id: 'socialmonitor',
    nome: 'Monitor de redes sociais',
    grupo: 'anuncios',
    oQueFaz: 'Mede dias sem post, seguidores e alcance de cada cliente e avisa no WhatsApp quem está atrasado.',
    cadencia: 'todo dia às 09h15',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-socialmonitor.last',
    rastro: {
      rotulo: 'última coleta',
      sql: `SELECT MAX(fetched_at) AS t FROM public.social_monitor_snapshots`,
      toleranciaMin: 2 * DIA,
    },
  },
  {
    id: 'balance',
    nome: 'Alerta de saldo de mídia',
    grupo: 'anuncios',
    oQueFaz: 'Confere o saldo das contas de anúncio e avisa quem vai ficar sem verba.',
    cadencia: 'todo dia às 07h',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-balance.last',
    ocioso: true,
    rastro: {
      rotulo: 'último alerta enviado',
      sql: `SELECT MAX(created_at) AS t FROM public.balance_alerts_log`,
      toleranciaMin: 7 * DIA,
    },
  },
  {
    id: 'search-terms',
    nome: 'Saneamento de termos (Google)',
    grupo: 'anuncios',
    oQueFaz: 'Lê os termos de pesquisa, negativa o que não faz sentido e promove o que converte.',
    cadencia: 'todo dia às 09h',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-search-terms.last',
    ocioso: true,
    rastro: {
      rotulo: 'última ação aplicada',
      sql: `SELECT MAX(created_at) AS t FROM public.otimizacao_registros WHERE origem = 'automacao'`,
      toleranciaMin: 7 * DIA,
    },
  },
  {
    id: 'resumo',
    nome: 'Resumo diário das contas',
    grupo: 'anuncios',
    oQueFaz: 'Compila no Histórico o que foi mexido ontem em cada conta de Meta e Google.',
    cadencia: 'todo dia às 08h40',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-resumo.last',
    rastro: {
      rotulo: 'último resumo gravado',
      sql: `SELECT MAX(created_at) AS t FROM public.otimizacao_registros WHERE origem = 'resumo'`,
      toleranciaMin: 3 * DIA,
    },
  },

  // ── Envios automáticos ────────────────────────────────────────────────────
  {
    id: 'disparos',
    nome: 'Disparos de WhatsApp',
    grupo: 'envios',
    oQueFaz: 'Envia as campanhas de disparo respeitando intervalo, teto diário e janela de horário.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-disparos.last',
    ocioso: true,
    rastro: {
      rotulo: 'último envio',
      sql: `SELECT MAX(sent_at) AS t FROM public.zapi_numbers`,
      toleranciaMin: 3 * DIA,
    },
  },
  {
    id: 'fidelidade',
    nome: 'Campanhas de fidelidade',
    grupo: 'envios',
    oQueFaz: 'Fala com quem está em risco, inativo ou é VIP, pela instância do próprio cliente.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-fidelidade.last',
    ocioso: true,
    rastro: {
      rotulo: 'último envio',
      sql: `SELECT MAX(enviado_em) AS t FROM public.fidelidade_envios`,
      toleranciaMin: 30 * DIA,
    },
  },
  {
    id: 'publicacoes',
    nome: 'Publicações agendadas',
    grupo: 'envios',
    oQueFaz: 'Publica no Instagram e no Facebook os posts e stories agendados.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-publicacoes.last',
    ocioso: true,
    rastro: {
      rotulo: 'última publicação',
      sql: `SELECT MAX(publicado_em) AS t FROM public.post_alvo`,
      toleranciaMin: 7 * DIA,
    },
  },
  {
    id: 'mcworker',
    nome: 'Automações multicanal',
    grupo: 'envios',
    oQueFaz: 'Toca os fluxos de automação (WhatsApp, e-mail) montados na tela de Automações.',
    cadencia: 'a cada minuto',
    intervaloMin: 1 * MIN,
    arquivo: 'onmid-mcworker.last',
    ocioso: true,
  },
  {
    id: 'luna',
    nome: 'Tarefas agendadas da Luna',
    grupo: 'envios',
    oQueFaz: 'Executa as tarefas que a Luna agendou e entrega o resultado no WhatsApp.',
    cadencia: 'a cada 15 minutos',
    intervaloMin: 15 * MIN,
    arquivo: 'onmid-luna.last',
    ocioso: true,
    rastro: {
      rotulo: 'última tarefa executada',
      sql: `SELECT MAX(ran_at) AS t FROM public.luna_task_runs`,
      toleranciaMin: 7 * DIA,
    },
  },

  // ── Relatórios ────────────────────────────────────────────────────────────
  {
    id: 'reports-monthly',
    nome: 'Relatórios mensais',
    grupo: 'relatorios',
    oQueFaz: 'Gera e envia o relatório do mês para cada cliente, no dia configurado.',
    cadencia: 'todo dia às 08h05 (envia no dia de cada cliente)',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-reports-monthly.last',
    ocioso: true,
    rastro: {
      rotulo: 'último relatório gerado',
      sql: `SELECT MAX(created_at) AS t FROM public.diagnostic_reports`,
      toleranciaMin: 7 * DIA,
    },
  },
  {
    id: 'resumo-diario',
    nome: 'Relatório diário no WhatsApp',
    grupo: 'relatorios',
    oQueFaz: 'Manda no grupo o resumo do dia anterior.',
    cadencia: 'dias úteis às 07h15',
    intervaloMin: 1 * DIA,
    arquivo: 'onmid-resumo-diario.last',
    ocioso: true,
  },
];

// ── Estado ───────────────────────────────────────────────────────────────────

export type EstadoRotina = 'ok' | 'ocioso' | 'atencao' | 'parado' | 'erro' | 'sem_leitura';

export type RotinaStatus = {
  id: string;
  nome: string;
  grupo: GrupoRotina;
  oQueFaz: string;
  cadencia: string;
  estado: EstadoRotina;
  motivo: string;
  /** Quando o cron terminou pela última vez (ISO) — null se não há leitura. */
  ultimaExecucao: string | null;
  /** O que a rota respondeu na última execução, resumido. */
  ultimaResposta: string | null;
  rastroRotulo: string | null;
  rastroEm: string | null;
};

/** Minutos entre `t` e agora. `null` quando não há data. */
export function minutosDesde(t: Date | string | null | undefined, agora: Date): number | null {
  if (!t) return null;
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return (agora.getTime() - d.getTime()) / 60_000;
}

/**
 * A folga que uma rotina tem antes de ser chamada de parada. Rotina de minuto
 * em minuto não pode alarmar por um atraso de 2 min (a VPS tem `flock`, e uma
 * execução longa segura a próxima), então o piso é generoso.
 */
export function limiteAtraso(intervaloMin: number): number {
  return Math.max(intervaloMin * 3, intervaloMin + 20);
}

/**
 * Lê o corpo que o cron gravou e diz se a rota reclamou.
 *
 * ⚠️ Corpo VAZIO não é sucesso. Rota que responde nada (ou que nem foi chamada
 * porque o `flock` barrou) deixa o arquivo com 0 byte — cinco rotinas estavam
 * exatamente assim quando este painel foi escrito.
 */
export function lerResposta(corpo: string | null): { ok: boolean; resumo: string | null } {
  if (corpo == null) return { ok: false, resumo: null };
  const txt = corpo.trim();
  if (!txt) return { ok: false, resumo: 'resposta vazia' };
  try {
    const j = JSON.parse(txt) as Record<string, unknown>;
    if (typeof j.error === 'string' && j.error) return { ok: false, resumo: j.error.slice(0, 200) };
    if (j.ok === false) {
      const m = typeof j.erro === 'string' ? j.erro : typeof j.motivo === 'string' ? j.motivo : 'ok: false';
      return { ok: false, resumo: m.slice(0, 200) };
    }
    // Resumo legível: os campos de contagem que as rotas costumam devolver.
    const partes: string[] = [];
    for (const k of ['processados', 'enviados', 'importados', 'analisados', 'clientes', 'configs', 'total', 'skipped', 'pulou']) {
      const v = j[k];
      if (typeof v === 'number' || typeof v === 'string') partes.push(`${k}: ${v}`);
    }
    return { ok: true, resumo: partes.length ? partes.join(' · ') : 'ok' };
  } catch {
    // Não é JSON: HTML de erro do proxy, texto do curl, stack trace…
    const primeira = txt.split('\n')[0]?.slice(0, 200) ?? '';
    // ⚠️ Inclui as falhas do próprio curl: quando a VPS não consegue falar com o
    // app, o arquivo guarda "curl: (28) Operation timed out" — texto que não
    // contém a palavra "erro" e passaria por resposta boa.
    const pareceErro =
      /error|erro|unauthorized|não autenticado|forbidden|timeout|timed out|refused|could not resolve|empty reply|<html/i.test(txt) ||
      /^curl:/i.test(txt);
    return { ok: !pareceErro, resumo: primeira };
  }
}

/** Decide o estado de UMA rotina a partir dos dois sinais. Pura, testável. */
export function avaliarRotina(
  def: DefRotina,
  sinal: { execucaoEm: Date | null; corpo: string | null; rastroEm: Date | null },
  agora: Date,
): RotinaStatus {
  const base = {
    id: def.id,
    nome: def.nome,
    grupo: def.grupo,
    oQueFaz: def.oQueFaz,
    cadencia: def.cadencia,
    ultimaExecucao: sinal.execucaoEm ? sinal.execucaoEm.toISOString() : null,
    rastroRotulo: def.rastro?.rotulo ?? null,
    rastroEm: sinal.rastroEm ? sinal.rastroEm.toISOString() : null,
  };

  const resposta = lerResposta(sinal.corpo);
  const atraso = minutosDesde(sinal.execucaoEm, agora);

  // Sem leitura de execução ainda assim aproveita o rastro: rotina recém-criada
  // (cujo arquivo só nasce na primeira passada do cron) não pode parecer morta
  // quando o banco mostra que ela acabou de produzir.
  if (atraso === null) {
    const r = def.rastro ? minutosDesde(sinal.rastroEm, agora) : null;
    const motivo = def.rastro && r !== null && r <= def.rastro.toleranciaMin
      ? `Sem leitura da execução, mas ${def.rastro.rotulo} foi há ${humanizar(r)} — está produzindo.`
      : 'Ainda sem leitura do servidor para esta rotina.';
    return { ...base, estado: 'sem_leitura', motivo, ultimaResposta: null };
  }

  if (atraso > limiteAtraso(def.intervaloMin)) {
    return {
      ...base,
      estado: 'parado',
      motivo: `Não roda há ${humanizar(atraso)} — deveria rodar ${def.cadencia}.`,
      ultimaResposta: resposta.resumo,
    };
  }

  if (!resposta.ok) {
    return {
      ...base,
      estado: 'erro',
      motivo: resposta.resumo ? `A última execução respondeu: ${resposta.resumo}` : 'A última execução não respondeu nada.',
      ultimaResposta: resposta.resumo,
    };
  }

  // Executando bem. O rastro decide entre "produzindo" e "sem resultado".
  const rastroAtraso = def.rastro ? minutosDesde(sinal.rastroEm, agora) : null;
  if (def.rastro && (rastroAtraso === null || rastroAtraso > def.rastro.toleranciaMin)) {
    const quanto = rastroAtraso === null ? 'nunca' : `há ${humanizar(rastroAtraso)}`;
    if (def.ocioso) {
      return { ...base, estado: 'ocioso', motivo: `Rodando normalmente. Sem trabalho a fazer (${def.rastro.rotulo} ${quanto}).`, ultimaResposta: resposta.resumo };
    }
    return { ...base, estado: 'atencao', motivo: `Está rodando, mas ${def.rastro.rotulo} foi ${quanto}.`, ultimaResposta: resposta.resumo };
  }

  return { ...base, estado: 'ok', motivo: `Rodando há ${humanizar(atraso)}.`, ultimaResposta: resposta.resumo };
}

export function humanizar(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

/** Ordem de urgência para a tela: o que está quebrado aparece primeiro. */
export const PESO_ESTADO: Record<EstadoRotina, number> = {
  parado: 0, erro: 1, atencao: 2, sem_leitura: 3, ocioso: 4, ok: 5,
};

// ── Conexões de plataforma ───────────────────────────────────────────────────

export type ConexaoStatus = {
  id: string;
  plataforma: string;
  conta: string;
  estado: 'ok' | 'atencao' | 'erro';
  motivo: string;
  conectadaEm: string | null;
};

/**
 * ⚠️ `token_expiry` é informativo. O token do Google é renovado por refresh a
 * cada uso, então "expirado" ali é normal; o que mata de verdade é o refresh
 * token revogado — e isso só o uso real revela. Por isso o painel reporta
 * ausência de conexão como erro e expiração do Meta (que NÃO se auto-renova)
 * como aviso, sem fingir que sabe mais do que sabe.
 */
export async function lerConexoes(pool: Pool): Promise<ConexaoStatus[]> {
  const out: ConexaoStatus[] = [];
  const agora = Date.now();

  const meta = await pool
    .query<{ id: string; status: string; user_name: string | null; connected_at: Date | null; token_expiry: string | null }>(
      `SELECT id, status, user_name, connected_at, token_expiry FROM public.meta_connections ORDER BY connected_at DESC`,
    )
    .catch(() => ({ rows: [] }));

  if (meta.rows.length === 0) {
    out.push({ id: 'meta', plataforma: 'Meta Ads', conta: '—', estado: 'erro', motivo: 'Nenhuma conta da Meta conectada.', conectadaEm: null });
  } else {
    for (const r of meta.rows) {
      const exp = r.token_expiry ? new Date(r.token_expiry) : null;
      const diasPara = exp && !Number.isNaN(exp.getTime()) ? (exp.getTime() - agora) / 86_400_000 : null;
      let estado: ConexaoStatus['estado'] = 'ok';
      let motivo = 'Conectada.';
      if (r.status !== 'connected') { estado = 'erro'; motivo = `Conexão em "${r.status}" — reconectar em Integrações.`; }
      else if (diasPara !== null && diasPara < 0) { estado = 'erro'; motivo = 'Token vencido — reconectar em Integrações.'; }
      else if (diasPara !== null && diasPara < 14) { estado = 'atencao'; motivo = `Token vence em ${Math.round(diasPara)} dias.`; }
      else if (diasPara !== null) { motivo = `Token válido por mais ${Math.round(diasPara)} dias.`; }
      out.push({ id: `meta:${r.id}`, plataforma: 'Meta Ads', conta: r.user_name ?? '—', estado, motivo, conectadaEm: r.connected_at ? r.connected_at.toISOString() : null });
    }
  }

  const google = await pool
    .query<{ id: string; email: string; account_type: string; status: string; connected_at: Date | null }>(
      `SELECT id, email, account_type, status, connected_at FROM public.google_connections ORDER BY connected_at DESC`,
    )
    .catch(() => ({ rows: [] }));

  const ESPERADAS: { tipo: string; nome: string }[] = [
    { tipo: 'google_ads', nome: 'Google Ads' },
    { tipo: 'ga4', nome: 'Google Analytics' },
    { tipo: 'sheets', nome: 'Google Planilhas' },
    { tipo: 'gmail', nome: 'Gmail (envio)' },
  ];

  for (const { tipo, nome } of ESPERADAS) {
    const linha = google.rows.find((r) => r.account_type === tipo);
    if (!linha) {
      out.push({ id: `google:${tipo}`, plataforma: nome, conta: '—', estado: 'erro', motivo: 'Nenhuma conta conectada para este acesso.', conectadaEm: null });
      continue;
    }
    const ok = linha.status === 'connected';
    out.push({
      id: `google:${linha.id}`,
      plataforma: nome,
      conta: linha.email,
      estado: ok ? 'ok' : 'erro',
      motivo: ok ? 'Conectada.' : `Conexão em "${linha.status}" — reconectar em Integrações.`,
      conectadaEm: linha.connected_at ? linha.connected_at.toISOString() : null,
    });
  }

  return out;
}
