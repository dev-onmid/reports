/**
 * Disparos: o destino de uma campanha é o CLIENTE, não a instância.
 *
 * Antes desta lib a tela de Disparos só enxergava `zapi_clients` — as instâncias
 * criadas PELA PRÓPRIA tela. As instâncias reais dos clientes vivem em
 * `client_zapi_instances` (o vínculo do CRM) e nunca apareciam ali, então a
 * única saída era criar uma instância descartável `disparo-<nome>-<hash>` por
 * campanha. Foi assim que a campanha da SAAC nasceu apontada pra uma instância
 * que depois deixou de existir na Evolution: 89 contatos queimados em 404.
 *
 * Aqui o vocabulário é: CLIENTE (clients.id) → INSTÂNCIA (Evolution) → status
 * VIVO lido da própria Evolution. Instância que não existe mais no servidor
 * aparece como `existe: false` em vez de sumir — some em silêncio é o que
 * escondeu o problema por três dias.
 */
import type { Pool } from 'pg';
import { normalizeClientName } from '@/lib/client-name';

export type ProviderWa = 'zapi' | 'evolution';

/** Uma linha de vínculo cliente↔instância, como sai do banco. */
export type VinculoBruto = {
  clientId: string;
  clientName: string | null;
  instanceId: string;
  nome: string | null;
  provider: string | null;
};

/** O que a Evolution diz que existe AGORA (fetchInstances). */
export type InstanciaViva = { name: string; connectionStatus: string | null };

export type InstanciaDestino = {
  instanceId: string;
  nome: string;
  provider: ProviderWa;
  /** Existe no servidor Evolution neste momento. */
  existe: boolean;
  conectada: boolean;
  /** Rótulo curto do porquê não dá pra usar (vazio quando dá). */
  impedimento: '' | 'inexistente' | 'desconectada';
};

export type DestinoCliente = {
  clientId: string;
  clientName: string;
  instancias: InstanciaDestino[];
  /** Tem ao menos uma instância pronta pra disparar. */
  disponivel: boolean;
};

/** Instância conectada que ninguém vinculou a cliente nenhum. */
export type InstanciaOrfa = {
  instanceId: string;
  nome: string;
  conectada: boolean;
  /** true quando já existe como instância de Disparos (zapi_clients). */
  emDisparos: boolean;
};

/**
 * `connectionStatus` da Evolution: 'open' é o único estado que envia. 'close' e
 * 'connecting' não — mandar em 'connecting' devolve erro e queima o contato.
 */
export function estaConectada(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'open';
}

function normalizaId(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Cruza os vínculos do banco com o que a Evolution tem de pé e agrupa por
 * cliente. Cliente com duas instâncias (ex.: PicoLocos) vem com as duas, as
 * conectadas primeiro — quem dispara escolhe o número.
 */
export function montarDestinos(vinculos: VinculoBruto[], vivas: InstanciaViva[]): DestinoCliente[] {
  const statusPorId = new Map<string, string | null>();
  for (const v of vivas) statusPorId.set(normalizaId(v.name), v.connectionStatus);

  const porCliente = new Map<string, DestinoCliente>();
  const vistos = new Set<string>();

  for (const v of vinculos) {
    if (!v.clientId || !v.instanceId) continue;
    const chave = `${v.clientId}::${normalizaId(v.instanceId)}`;
    if (vistos.has(chave)) continue; // mesma instância listada 2x pro mesmo cliente
    vistos.add(chave);

    const existe = statusPorId.has(normalizaId(v.instanceId));
    const conectada = existe && estaConectada(statusPorId.get(normalizaId(v.instanceId)));
    const inst: InstanciaDestino = {
      instanceId: v.instanceId,
      nome: v.nome?.trim() || v.instanceId,
      provider: v.provider === 'zapi' ? 'zapi' : 'evolution',
      existe,
      conectada,
      impedimento: conectada ? '' : (existe ? 'desconectada' : 'inexistente'),
    };

    const atual = porCliente.get(v.clientId);
    if (atual) atual.instancias.push(inst);
    else porCliente.set(v.clientId, {
      clientId: v.clientId,
      clientName: v.clientName?.trim() || 'Cliente sem nome',
      instancias: [inst],
      disponivel: false,
    });
  }

  const saida = [...porCliente.values()];
  for (const c of saida) {
    // Conectada primeiro: o <select> abre já numa instância utilizável.
    c.instancias.sort((a, b) => Number(b.conectada) - Number(a.conectada) || a.nome.localeCompare(b.nome, 'pt-BR'));
    c.disponivel = c.instancias.some(i => i.conectada);
  }
  saida.sort((a, b) =>
    Number(b.disponivel) - Number(a.disponivel) || a.clientName.localeCompare(b.clientName, 'pt-BR'));
  return saida;
}

/**
 * Instâncias da Evolution que nenhum cliente reivindica. NÃO some da tela: é
 * ela que explica "cadê a SAAC 2.0?" e leva pro botão de vincular. Sem isso a
 * troca de instância→cliente parece que apagou instância de gente.
 */
export function instanciasOrfas(
  vivas: InstanciaViva[],
  vinculos: VinculoBruto[],
  emDisparos: string[],
): InstanciaOrfa[] {
  const vinculadas = new Set(vinculos.map(v => normalizaId(v.instanceId)));
  const disparos = new Set(emDisparos.map(normalizaId));
  return vivas
    .filter(v => !vinculadas.has(normalizaId(v.name)))
    .map(v => ({
      instanceId: v.name,
      nome: v.name,
      conectada: estaConectada(v.connectionStatus),
      emDisparos: disparos.has(normalizaId(v.name)),
    }))
    .sort((a, b) => Number(b.conectada) - Number(a.conectada) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Confirmação por digitação. Tolerante ao que um humano digita (acento, caixa,
 * espaço a mais) e intolerante ao resto — é a mesma régua que casa nome de
 * cliente no matcher de reuniões, então "Sorrifácil" nunca passa por
 * "Sorrifácil Cambé".
 */
export function nomeConfere(digitado: string, real: string): boolean {
  const a = normalizeClientName(digitado ?? '');
  const b = normalizeClientName(real ?? '');
  return a.length > 0 && a === b;
}

export type TipoErroEnvio = 'instancia' | 'numero' | 'outro';

/**
 * Separa "a instância morreu" de "esse número não tem WhatsApp".
 *
 * ⚠️ A diferença decide se o contato é QUEIMADO. `exists:false` é falha do
 * número (marca failed, correto). 404 "instance does not exist" é falha nossa —
 * marcar failed ali gasta a lista inteira contra uma porta fechada, sem retry,
 * que foi exatamente o custo de 20/08 (89 contatos) e 17/08 (925).
 */
export function classificarErroEnvio(msg: string): TipoErroEnvio {
  const m = String(msg ?? '');
  // Número inexistente vem como 400 + exists:false — checado ANTES pra nunca
  // ser confundido com problema de instância.
  if (/"exists"\s*:\s*false/i.test(m)) return 'numero';
  if (/\bnumber\s+(does\s+not\s+exist|not\s+found)/i.test(m)) return 'numero';

  if (/instance\s+does\s+not\s+exist/i.test(m)) return 'instancia';
  if (/instance\s+.*\bnot\s+found\b/i.test(m)) return 'instancia';
  if (/\bconnection\s+closed\b/i.test(m)) return 'instancia';
  if (/\bnot\s+connected\b/i.test(m)) return 'instancia';
  if (/"status"\s*:\s*404/.test(m)) return 'instancia';
  return 'outro';
}

/** Texto do alerta quando o motor pausa a campanha sozinho. */
export function mensagemPausaAutomatica(o: {
  campanha: string; cliente: string; instancia: string; motivo: string; restantes: number;
}): string {
  return [
    '🚨 *DISPARO PAUSADO AUTOMATICAMENTE*',
    '',
    `Campanha: ${o.campanha}`,
    `Cliente: ${o.cliente}`,
    `Instância: ${o.instancia}`,
    '',
    `Motivo: ${o.motivo}`,
    `Restam ${o.restantes} contato(s) na fila — nenhum foi queimado.`,
    '',
    'Reconecte o WhatsApp em Configurações → Instâncias e retome a campanha.',
  ].join('\n');
}

// ───────────────────────── camada de banco ─────────────────────────

/** Todos os vínculos cliente↔instância ativos (fonte: CRM). */
export async function carregarVinculos(pool: Pool): Promise<VinculoBruto[]> {
  const { rows } = await pool.query(
    `SELECT czi.client_id AS "clientId", c.name AS "clientName",
            czi.instance_id AS "instanceId", czi.nome, czi.provider
       FROM public.client_zapi_instances czi
       LEFT JOIN public.clients c ON c.id = czi.client_id
      WHERE czi.ativo = true
      ORDER BY c.name NULLS LAST, czi.created_at DESC`,
  );
  return rows as VinculoBruto[];
}

/**
 * Resolve (ou cria) a linha de `zapi_clients` que representa esta instância.
 *
 * ⚠️ Mantido de propósito: `zapi_campaigns.client_id` é FK pra `zapi_clients` e
 * o worker lê as credenciais desse JOIN. Trocar o FK exigiria mexer no motor
 * que está rodando campanha REAL agora — resolver-ou-criar entrega o destino
 * por cliente sem tocar em uma linha do worker.
 */
export async function garantirZapiClient(pool: Pool, o: {
  instanceId: string; nomeCliente: string; provider: ProviderWa; token: string; ownerId: string | null;
}): Promise<string> {
  const { rows: [existente] } = await pool.query(
    `SELECT id FROM public.zapi_clients WHERE instance_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [o.instanceId],
  );
  if (existente) {
    // Reativa e reetiqueta com o nome do cliente — a linha pode ter ficado
    // `active=false` de uma desativação antiga e o nome pode estar velho.
    await pool.query(
      `UPDATE public.zapi_clients SET active = true, name = $2 WHERE id = $1`,
      [existente.id, o.nomeCliente],
    );
    return existente.id as string;
  }
  const { rows: [novo] } = await pool.query(
    `INSERT INTO public.zapi_clients (name, instance_id, token, provider, owner_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [o.nomeCliente, o.instanceId, o.token ?? '', o.provider, o.ownerId],
  );
  return novo.id as string;
}

export type DestinoResolvido = {
  clientId: string;
  clientName: string;
  instanceId: string;
  provider: ProviderWa;
  token: string;
};

/**
 * Portão do servidor: a instância precisa estar REALMENTE vinculada ao cliente
 * pedido. A tela é só apresentação — chamada por fora, aba aberta antes de um
 * desvínculo ou id trocado na mão não passam por aqui.
 */
export async function resolverDestino(
  pool: Pool, clientId: string, instanceId: string,
): Promise<DestinoResolvido | { erro: string }> {
  const { rows: [row] } = await pool.query(
    `SELECT czi.client_id, czi.instance_id, czi.provider, czi.token, c.name AS client_name
       FROM public.client_zapi_instances czi
       LEFT JOIN public.clients c ON c.id = czi.client_id
      WHERE czi.client_id = $1 AND czi.instance_id = $2 AND czi.ativo = true
      LIMIT 1`,
    [clientId, instanceId],
  );
  if (!row) return { erro: 'Esta instância não está vinculada a este cliente.' };
  if (!row.client_name) return { erro: 'Cliente não encontrado.' };
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    instanceId: row.instance_id,
    provider: row.provider === 'zapi' ? 'zapi' : 'evolution',
    token: row.token ?? '',
  };
}

export type EstadoInstancia = 'conectada' | 'desconectada' | 'inexistente' | 'indisponivel';

/**
 * Traduz o `state` da Evolution em decisão do motor.
 *
 * ⚠️ 'connecting' NÃO pausa: é o estado normal de quem está reatando a sessão
 * (celular trocando de rede, restart do container). Pausar ali exigiria retomar
 * na mão — com confirmação digitada — a cada soluço de reconexão. Só 'close'
 * (deslogado de verdade) é tratado como desconexão.
 */
export function estadoDoState(state: string | null | undefined): EstadoInstancia {
  const s = String(state ?? '').toLowerCase();
  if (s === 'open') return 'conectada';
  if (s === 'connecting') return 'indisponivel';
  return 'desconectada';
}

/**
 * Falha da sonda: instância que não existe mais é DIFERENTE de Evolution fora
 * do ar. A primeira é definitiva (pausa a campanha); a segunda é passageira
 * (só adia o tick). Tratar as duas igual pausaria campanha saudável a cada
 * soluço de rede.
 */
export function classificarFalhaSonda(msg: string): 'inexistente' | 'indisponivel' {
  return /\b404\b|does not exist|not found/i.test(String(msg ?? '')) ? 'inexistente' : 'indisponivel';
}

