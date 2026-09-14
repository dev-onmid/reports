// Respostas de formulário e localização do lead — a leitura honesta de dois
// dados que o sistema já recebia e escondia.
//
// Pedido do Matheus (13/09): "no modal de informação dos leads precisam conter
// também cidade e respostas de formulário quando tiver. E isso tem que virar
// informação na dashboard".
//
// ⚠️ As respostas NÃO ficam em coluna: moram em `lead_tracking_events.raw`, o
// snapshot imutável do toque. A observação do lead recebe uma versão achatada
// ("Formulário Meta — q: a | q: a") que serve para ler de relance, não para
// agrupar. Quem quer contar resposta lê daqui.

export type RespostaFormulario = { pergunta: string; resposta: string };

/**
 * Campos que JÁ viram coluna do lead (nome, telefone, e-mail, cidade…).
 * Repeti-los como "resposta" seria ruído: a tela já mostra cada um no seu lugar.
 */
const CAMPOS_DO_CADASTRO = new Set([
  'full_name', 'first_name', 'last_name', 'nome', 'name', 'nome_completo',
  'phone_number', 'phone', 'telefone', 'whatsapp', 'celular', 'phonewithdialcode',
  'email', 'e-mail', 'email_address',
  'city', 'cidade', 'state', 'estado', 'uf', 'province',
  'observacao', 'observação', 'mensagem', 'message', 'comentario', 'comentário',
]);

/** Envelope técnico — identificador de anúncio, rastreio, metadado da Meta. */
const PREFIXOS_TECNICOS = ['utm_', 'ga_', '_'];
const CHAVES_TECNICAS = new Set([
  'ad_id', 'adset_id', 'campaign_id', 'form_id', 'page_id', 'leadgen_id',
  'created_time', 'is_organic', 'field_data', 'type', 'lead',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid', 'msclkid', 'gad_source',
  'keyword', 'matchtype', 'device', 'network', 'placement', 'loc_physical_ms',
  'campaignid', 'adgroupid', 'creative', 'source_url', 'page_url', 'url', 'referrer',
  'client_id', 'clientid', 'lead_id', 'leadid', 'id', 'token', 'secret',
  'stage', 'stageid', 'status', 'etapa', 'valor', 'value', 'isqualified',
]);

function ehTecnica(chave: string): boolean {
  const k = chave.toLowerCase().trim();
  if (CHAVES_TECNICAS.has(k)) return true;
  return PREFIXOS_TECNICOS.some(p => k.startsWith(p));
}

/**
 * `qual_procedimento_você_está_interessado_` → "Qual procedimento você está
 * interessado". A Meta entrega a pergunta como slug: underscore no lugar de
 * espaço, minúscula. ⚠️ A pontuação final que virou `_` não dá para restaurar —
 * inventar um "?" seria escrever pergunta que ninguém fez.
 */
export function humanizarRotulo(bruto: string): string {
  const limpo = bruto.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * `implante_unitário_` → "Implante unitário"; `tarde_—_das_14h_às_18h` →
 * "Tarde — das 14h às 18h". A opção pré-definida chega slugada; texto livre
 * chega como a pessoa digitou.
 *
 * ⚠️ Não capitaliza valor com "@": e-mail digitado numa pergunta custom tem
 * parte local sensível a caixa, e trocá-la seria alterar o dado.
 */
export function humanizarValor(bruto: string): string {
  const limpo = bruto.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo || limpo.includes('@')) return limpo;
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

type CampoMeta = { name?: unknown; values?: unknown };

function respostaDeValores(values: unknown): string {
  if (Array.isArray(values)) {
    return values.map(v => humanizarValor(String(v ?? ''))).filter(Boolean).join(', ');
  }
  return humanizarValor(String(values ?? ''));
}

/**
 * Lê as respostas do payload cru, em qualquer um dos formatos que chegam:
 * Meta Lead Ads (`field_data[] = {name, values[]}`), formulário de LP/webhook
 * (objeto plano) e Datalytics (`{lead: {...}}`).
 *
 * Devolve só o que é RESPOSTA: fora identidade (já está no cadastro) e fora
 * envelope técnico (id de anúncio, utm, token).
 */
export function extrairRespostas(raw: unknown): RespostaFormulario[] {
  // ⚠️ Array no topo é descartado: `typeof [] === 'object'`, e iterar um array
  // solto produziria perguntas chamadas "0" e "1" (pego por assert).
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;

  // Meta Lead Ads
  if (Array.isArray(obj.field_data)) {
    const out: RespostaFormulario[] = [];
    for (const campo of obj.field_data as CampoMeta[]) {
      const chave = String(campo?.name ?? '').toLowerCase().trim();
      if (!chave || CAMPOS_DO_CADASTRO.has(chave) || ehTecnica(chave)) continue;
      const resposta = respostaDeValores(campo?.values);
      if (!resposta) continue;
      out.push({ pergunta: humanizarRotulo(chave), resposta });
    }
    return out;
  }

  // Wrapper de CRM externo — a resposta mora um nível abaixo.
  const dentro = obj.lead ?? obj.data ?? obj.body;
  const alvo = (dentro && typeof dentro === 'object' && !Array.isArray(dentro))
    ? dentro as Record<string, unknown>
    : obj;

  const out: RespostaFormulario[] = [];
  for (const [chave, valor] of Object.entries(alvo)) {
    const k = chave.toLowerCase().trim();
    if (!k || CAMPOS_DO_CADASTRO.has(k) || ehTecnica(k)) continue;
    if (valor === null || valor === undefined || typeof valor === 'object') continue;
    const resposta = humanizarValor(String(valor));
    if (!resposta) continue;
    out.push({ pergunta: humanizarRotulo(chave), resposta });
  }
  return out;
}

// ── Localização ──────────────────────────────────────────────────────────────

export type FonteLocal = 'formulario' | 'ip' | 'ddd';

export type LocalDoLead = {
  /** "Londrina / PR" ou "Bauru / Marília / SP" */
  texto: string;
  fonte: FonteLocal;
  /** "Cidade" quando a pessoa declarou; "Região" quando veio do DDD/IP. */
  rotulo: 'Cidade' | 'Região';
  /** Explica de onde saiu — o gestor precisa saber se pode confiar. */
  detalhe: string;
};

type LeadLocalizavel = {
  city?: string | null;
  regiao_cidade?: string | null;
  regiao_uf?: string | null;
  regiao_fonte?: string | null;
};

const DETALHE: Record<FonteLocal, string> = {
  formulario: 'informada pela pessoa no formulário',
  ip: 'pelo IP no momento do clique',
  ddd: 'estimada pelo DDD do telefone',
};

/**
 * ⚠️ A distinção aqui é a razão desta função existir. `regiao_cidade` guarda
 * DUAS coisas: a cidade que a pessoa escreveu (`regiao_fonte='form'`) e a
 * REGIÃO do DDD (`'ddd'`) — e a segunda domina a base (medido em 13/09: 10.551
 * de 12.441). Rotular "Bauru / Marília / SP" como Cidade seria afirmar um
 * endereço que ninguém informou.
 */
export function localDoLead(lead: LeadLocalizavel): LocalDoLead | null {
  const uf = lead.regiao_uf?.trim() || null;
  const declarada = lead.city?.trim() || null;

  if (declarada) {
    return {
      texto: [declarada, uf].filter(Boolean).join(' / '),
      fonte: 'formulario',
      rotulo: 'Cidade',
      detalhe: DETALHE.formulario,
    };
  }

  const regiao = lead.regiao_cidade?.trim() || null;
  if (!regiao && !uf) return null;

  const fonte: FonteLocal = lead.regiao_fonte === 'form'
    ? 'formulario'
    : lead.regiao_fonte === 'ip' ? 'ip' : 'ddd';

  return {
    texto: [regiao, uf].filter(Boolean).join(' / '),
    fonte,
    rotulo: fonte === 'formulario' ? 'Cidade' : 'Região',
    detalhe: DETALHE[fonte],
  };
}
