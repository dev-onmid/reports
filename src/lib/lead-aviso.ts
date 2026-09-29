// ── Aviso de lead novo no grupo do cliente ───────────────────────────────────
//
// Substitui o cenário do Make: quando entra lead por FORMULÁRIO (Meta Lead Ads
// ou landing page), manda uma mensagem no grupo de WhatsApp daquele cliente.
// Configurado por cliente, não global.
//
// ⚠️ O gatilho é `lead_tracking_events.event_type = 'formulario'`, não o texto
// do canal. As duas portas gravam esse evento (meta-leadgen.ts e a rota da LP),
// enquanto `canal` é livre — na LP ele é o nome da origem cadastrada, que muda
// por cliente. Casar texto de canal quebraria no dia em que alguém renomeasse
// uma origem.
//
// ⚠️⚠️ O envio roda num WORKER separado, NUNCA dentro da rota que recebe o
// lead. É a lição da integração SULTS: uma queda do WhatsApp não pode derrubar
// a recepção de lead de nenhum cliente da carteira.

import type { Pool } from 'pg';

export type FonteAviso = 'meta_forms' | 'landing_page';
export const FONTES_AVISO: FonteAviso[] = ['meta_forms', 'landing_page'];

export const ROTULO_FONTE: Record<FonteAviso, string> = {
  meta_forms: 'Formulário Meta',
  landing_page: 'Landing page',
};

/** Teto de mensagens por cliente em cada rodada — ver `processarAvisos`. */
export const TETO_POR_RODADA = 20;

let schemaPronto = false;

export async function ensureLeadAvisoSchema(pool: Pool) {
  if (schemaPronto) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.lead_aviso_config (
      client_id      TEXT PRIMARY KEY,
      ativo          BOOLEAN NOT NULL DEFAULT FALSE,
      zapi_client_id TEXT,   -- legado: a instância virou a oficial da ONMID (ver whatsapp-send)
      group_id       TEXT,
      fontes         TEXT NOT NULL DEFAULT 'meta_forms,landing_page',
      -- ⚠️ Marco zero. Ligar num cliente antigo despejaria a base histórica
      -- inteira no grupo dele, e não há como desfazer mensagem enviada. O
      -- worker só olha evento POSTERIOR a esta marca, que é reposicionada
      -- sempre que o aviso é (re)ligado.
      desde          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.lead_aviso_envios (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id  TEXT NOT NULL,
      evento_id  UUID NOT NULL,
      lead_id    UUID,
      fonte      TEXT,
      status     TEXT NOT NULL,
      erro       TEXT,
      -- O texto EXATO que foi para o grupo. Guardar só o id do evento
      -- obrigaria a remontar a mensagem para exibir, e remontagem não é
      -- registro: mudar o formato amanhã faria o histórico mentir sobre o que
      -- foi entregue ontem (mesma lição de fidelidade_envios.texto).
      texto      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- ⚠️ A defesa central contra avisar duas vezes. Não existe desfazer de
    -- mensagem no WhatsApp, e dois ticks cruzados do cron competiriam pelo
    -- mesmo evento.
    CREATE UNIQUE INDEX IF NOT EXISTS lead_aviso_envios_unico
      ON public.lead_aviso_envios (client_id, evento_id);
    CREATE INDEX IF NOT EXISTS lead_aviso_envios_cliente_idx
      ON public.lead_aviso_envios (client_id, created_at DESC);
  `).catch(err => console.error('[lead-aviso schema]', err?.message ?? err));
  schemaPronto = true;
}

/**
 * De qual porta o lead veio, lido do `external_id` do evento.
 *
 * ⚠️ O prefixo é o que as próprias ingestões escrevem: `leadgen:` em
 * meta-leadgen.ts e `lp:` na rota da landing page. O webhook genérico também
 * grava event_type 'formulario' mas com id livre — ele cai em `null` e fica de
 * fora, porque "formulário do Meta ou landing page" foi o pedido; incluir
 * qualquer webhook faria o grupo receber coisa que ninguém configurou.
 */
export function fonteDoEvento(externalId: string | null | undefined): FonteAviso | null {
  const id = String(externalId ?? '');
  if (id.startsWith('leadgen:')) return 'meta_forms';
  if (id.startsWith('lp:')) return 'landing_page';
  return null;
}

/** 'meta_forms,landing_page' → lista válida, sem lixo e sem repetição. */
export function parseFontes(bruto: string | null | undefined): FonteAviso[] {
  const itens = String(bruto ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const validas = itens.filter((f): f is FonteAviso => (FONTES_AVISO as string[]).includes(f));
  const unicas = [...new Set(validas)];
  // Config vazia ou corrompida vale como "todas" — o cliente ligou o aviso
  // esperando ser avisado, não ficar em silêncio por um campo malformado.
  return unicas.length ? unicas : [...FONTES_AVISO];
}

export type LeadDoAviso = {
  nome: string | null;
  numero: string | null;
  fonte: FonteAviso;
  canal: string | null;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  cidade: string | null;
  uf: string | null;
  email?: string | null;
  respostas?: Resposta[];
};

export type Resposta = { pergunta: string; resposta: string };

// Campos que JÁ aparecem no topo da mensagem (ou que não são pergunta). Repeti-los
// no bloco de respostas só faria o aviso crescer sem dizer nada novo.
const CAMPOS_DE_IDENTIDADE = new Set([
  'full_name', 'first_name', 'last_name', 'nome', 'nome_completo',
  'phone_number', 'telefone', 'whatsapp', 'numero_do_whatsapp', 'número_do_whatsapp',
  'email', 'e-mail',
]);

const MAX_RESPOSTAS = 8;
const MAX_PERGUNTA = 60;
const MAX_RESPOSTA = 140;

/**
 * "qual_procedimento_você_está_interessado_" → "Qual procedimento você está interessado"
 *
 * ⚠️ O Meta entrega o nome do campo como SLUG, do jeito que o gestor digitou a
 * pergunta no criador de formulário — com underscore, e frequentemente com um
 * `_` ou `:` pendurado no fim. Jogar isso cru no grupo do cliente pareceria
 * defeito do sistema, não pergunta do formulário.
 */
export function humanizarPergunta(bruto: string): string {
  const limpo = bruto.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/[:\s]+$/, '').trim();
  if (!limpo) return '';
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * "implante_unitário_" → "Implante unitário"; "tarde_—_das_14h_às_18h" → "Tarde — das 14h às 18h"
 *
 * ⚠️ O Meta entrega as OPÇÕES de múltipla escolha como slug, igual às perguntas
 * (medido na SorriLeve). Mas só desfaz o slug quando o valor PARECE um —
 * underscore e nenhum espaço. Texto que a pessoa digitou ("Nexxon solar"),
 * e-mail e url passam intactos: trocar `_` por espaço em "a_b@x.com" estragaria
 * um dado que a equipe vai copiar.
 */
export function humanizarValor(bruto: string): string {
  const v = bruto.trim();
  if (!v || /\s/.test(v) || !v.includes('_')) return v;
  if (v.includes('@') || v.includes('/') || /^https?:/i.test(v)) return v;
  const limpo = v.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return v;
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

function pushResposta(fora: Resposta[], pergunta: string, resposta: string) {
  const p = pergunta.trim().slice(0, MAX_PERGUNTA);
  const r = resposta.trim().replace(/\s*\n\s*/g, ' ').slice(0, MAX_RESPOSTA);
  if (!p || !r) return;
  if (fora.some(x => x.pergunta.toLowerCase() === p.toLowerCase())) return;
  fora.push({ pergunta: p, resposta: r });
}

/**
 * O que a pessoa RESPONDEU, lido do evento — não do cadastro do lead.
 *
 * ⚠️ A fonte é o `raw` do evento, de propósito: `crm_leads.observacao` é
 * fill-blanks, então quem já era lead mantém a observação da PRIMEIRA vez e o
 * aviso descreveria um formulário antigo. O evento é o que acabou de acontecer.
 *
 * Dois formatos, porque as duas portas gravam diferente:
 *  - Meta Lead Ads: `field_data: [{ name, values }]` (medido nas 253 entradas);
 *  - landing page: `observacao` em texto, "Pergunta: resposta" separado por
 *    quebra de linha ou " | ", mais `cidade` em campo próprio.
 */
export function respostasDoFormulario(raw: unknown, fonte: FonteAviso): Resposta[] {
  const out: Resposta[] = [];
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;

  if (fonte === 'meta_forms' && Array.isArray(obj.field_data)) {
    for (const campo of obj.field_data as Array<Record<string, unknown>>) {
      const nome = String(campo?.name ?? '');
      if (!nome || CAMPOS_DE_IDENTIDADE.has(nome.toLowerCase())) continue;
      const valores = Array.isArray(campo?.values) ? campo.values : [];
      const valor = valores
        .map(v => humanizarValor(String(v ?? '')))
        .filter(Boolean)
        .join(', ');
      if (!valor) continue; // campo em branco no formulário não vira linha vazia
      pushResposta(out, humanizarPergunta(nome), valor);
      if (out.length >= MAX_RESPOSTAS) break;
    }
    return out;
  }

  if (typeof obj.cidade === 'string') pushResposta(out, 'Cidade', obj.cidade);
  if (typeof obj.observacao === 'string') {
    for (const pedaco of obj.observacao.split(/\n|\s\|\s/)) {
      const i = pedaco.indexOf(':');
      if (i <= 0) continue;
      pushResposta(out, pedaco.slice(0, i), pedaco.slice(i + 1));
      if (out.length >= MAX_RESPOSTAS) break;
    }
  }
  return out.slice(0, MAX_RESPOSTAS);
}

export function emailDoFormulario(raw: unknown, fallback: string | null | undefined): string | null {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.field_data)) {
      for (const campo of obj.field_data as Array<Record<string, unknown>>) {
        if (String(campo?.name ?? '').toLowerCase() !== 'email') continue;
        const v = Array.isArray(campo?.values) ? String(campo.values[0] ?? '').trim() : '';
        if (v) return v;
      }
    }
    if (typeof obj.email === 'string' && obj.email.trim()) return obj.email.trim();
  }
  const f = String(fallback ?? '').trim();
  return f || null;
}

/** +55 (14) 99635-8710 — o grupo é de gente, não de máquina. */
export function formatarTelefone(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length < 10) return bruto?.trim() || null;
  const sem55 = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  const ddd = sem55.slice(0, 2);
  const resto = sem55.slice(2);
  if (resto.length < 8) return bruto?.trim() || null;
  const meio = resto.slice(0, resto.length - 4);
  return `+55 (${ddd}) ${meio}-${resto.slice(-4)}`;
}

/**
 * A mensagem que chega no grupo.
 *
 * ⚠️ Sem link para o nosso CRM de propósito: quem está no grupo é a equipe do
 * CLIENTE, que não tem login aqui — o link só entregaria uma tela de senha.
 *
 * ⚠️ E sem NENHUMA url, nem a de atalho `wa.me`: o WhatsApp pré-visualiza o
 * primeiro link da mensagem, e a miniatura ocupava mais espaço que o lead
 * inteiro — o aviso virava uma logo gigante com o nome da pessoa embaixo. O
 * telefone em formato internacional já vira um toque para conversar, que era
 * tudo o que o atalho fazia.
 */
export function montarMensagem(lead: LeadDoAviso): string {
  const linhas: string[] = [`🔔 *Lead novo* — ${ROTULO_FONTE[lead.fonte]}`, ''];
  linhas.push(`*${lead.nome?.trim() || 'Sem nome'}*`);

  const tel = formatarTelefone(lead.numero);
  if (tel) linhas.push(tel);
  const email = lead.email?.trim();
  if (email) linhas.push(email);

  const local = [lead.cidade, lead.uf].filter(Boolean).join(' · ');
  const detalhe: string[] = [];
  if (lead.campanha) detalhe.push(`Campanha: ${lead.campanha}`);
  if (lead.conjunto) detalhe.push(`Conjunto: ${lead.conjunto}`);
  // ⚠️ "Criativo", não "Anúncio": é como a equipe chama, e é a pergunta que o
  // grupo realmente faz ao ver o lead ("qual criativo trouxe esse?").
  if (lead.anuncio) detalhe.push(`Criativo: ${lead.anuncio}`);
  if (!lead.campanha && lead.canal && lead.canal !== ROTULO_FONTE[lead.fonte]) {
    detalhe.push(`Origem: ${lead.canal}`);
  }
  if (local) detalhe.push(`Região: ${local}`);
  if (detalhe.length) { linhas.push(''); linhas.push(...detalhe); }

  const respostas = lead.respostas ?? [];
  if (respostas.length) {
    linhas.push('', '*Respostas do formulário*');
    for (const r of respostas) linhas.push(`• ${r.pergunta}: ${r.resposta}`);
  }

  return linhas.join('\n');
}

// ── Motor ────────────────────────────────────────────────────────────────────

export type ResultadoAviso = {
  clientes: number;
  enviados: number;
  falhas: number;
  detalhes: Array<{ cliente: string; enviados: number; falhas: number; erro?: string }>;
};

/**
 * Varre os eventos de formulário ainda não avisados e manda um por lead.
 *
 * ⚠️ Volume medido em 28/09 (14 dias): o cliente mais movimentado tem 5,7
 * formulários por dia e pico de 3 numa hora. Por isso é uma mensagem POR LEAD,
 * sem lote: no volume real não é spam, e avisar na hora é o ponto. O
 * `TETO_POR_RODADA` existe só como cinto de segurança para um dia anormal —
 * o que sobrar entra na rodada seguinte, não se perde.
 */
export async function processarAvisos(
  pool: Pool,
  enviar: (destino: string, texto: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<ResultadoAviso> {
  await ensureLeadAvisoSchema(pool);
  const out: ResultadoAviso = { clientes: 0, enviados: 0, falhas: 0, detalhes: [] };

  const { rows: configs } = await pool.query<{
    client_id: string; group_id: string | null;
    fontes: string; desde: string; nome: string | null;
  }>(
    `SELECT a.client_id, a.group_id, a.fontes, a.desde, c.name AS nome
       FROM public.lead_aviso_config a
       LEFT JOIN public.clients c ON c.id = a.client_id
      WHERE a.ativo = TRUE
        AND NULLIF(a.group_id, '') IS NOT NULL`,
  );

  for (const cfg of configs) {
    out.clientes++;
    const fontes = parseFontes(cfg.fontes);
    const det = { cliente: cfg.nome ?? cfg.client_id, enviados: 0, falhas: 0 } as ResultadoAviso['detalhes'][number];

    // Eventos ainda não avisados. O LEFT JOIN é o filtro barato; a UNIQUE é a
    // garantia real (dois ticks cruzados leem a mesma lista).
    const { rows: eventos } = await pool.query<{
      id: string; lead_id: string | null; external_id: string | null; canal: string | null;
      campaign_name: string | null; adset_name: string | null; ad_name: string | null;
      regiao_cidade: string | null; regiao_uf: string | null; raw: unknown;
      nome: string | null; numero: string | null; email: string | null;
    }>(
      // ⚠️ COALESCE evento → lead, nesta ordem. Medido em 29/09: no lead de
      // landing page o nome da campanha É resolvido (ids do Google viram nome
      // pelo google-ad-resolver) e gravado em crm_leads, mas NÃO no evento —
      // lendo só o evento, 18 de 37 leads de LP sairiam sem campanha nenhuma.
      // O evento vem primeiro porque descreve ESTA submissão; o lead é
      // first-touch e, em quem já era lead, guarda a campanha da primeira vez.
      `SELECT e.id, e.lead_id, e.external_id, e.canal,
              COALESCE(e.campaign_name, l.campaign_name) AS campaign_name,
              COALESCE(e.adset_name,    l.adset_name)    AS adset_name,
              COALESCE(e.ad_name,       l.ad_name)       AS ad_name,
              e.regiao_cidade, e.regiao_uf, e.raw,
              l.nome, l.numero, l.email
         FROM public.lead_tracking_events e
         LEFT JOIN public.crm_leads l ON l.id = e.lead_id
         LEFT JOIN public.lead_aviso_envios v
                ON v.client_id = e.client_id AND v.evento_id = e.id
        WHERE e.client_id = $1
          AND e.event_type = 'formulario'
          AND e.created_at > $2::timestamptz
          AND v.id IS NULL
        ORDER BY e.created_at ASC
        LIMIT $3`,
      [cfg.client_id, cfg.desde, TETO_POR_RODADA],
    );

    for (const ev of eventos) {
      const fonte = fonteDoEvento(ev.external_id);
      if (!fonte || !fontes.includes(fonte)) continue;

      const texto = montarMensagem({
        nome: ev.nome, numero: ev.numero, fonte, canal: ev.canal,
        campanha: ev.campaign_name, conjunto: ev.adset_name, anuncio: ev.ad_name,
        cidade: ev.regiao_cidade, uf: ev.regiao_uf,
        email: emailDoFormulario(ev.raw, ev.email),
        respostas: respostasDoFormulario(ev.raw, fonte),
      });

      // ⚠️ RESERVA ANTES DE ENVIAR. Gravar depois deixaria a janela em que um
      // segundo tick lê o mesmo evento e a pessoa recebe o aviso duas vezes.
      // Se o INSERT colidir, outro tick já pegou — segue para o próximo.
      const { rowCount } = await pool.query(
        `INSERT INTO public.lead_aviso_envios (client_id, evento_id, lead_id, fonte, status, texto)
         VALUES ($1,$2,$3,$4,'enviando',$5)
         ON CONFLICT (client_id, evento_id) DO NOTHING`,
        [cfg.client_id, ev.id, ev.lead_id, fonte, texto],
      );
      if (!rowCount) continue;

      const r = await enviar(cfg.group_id!, texto)
        .catch(e => ({ ok: false, error: String(e?.message ?? e) }));

      await pool.query(
        `UPDATE public.lead_aviso_envios SET status = $3, erro = $4
          WHERE client_id = $1 AND evento_id = $2`,
        [cfg.client_id, ev.id, r.ok ? 'enviado' : 'erro', r.ok ? null : (r.error ?? 'falha no envio')],
      ).catch(() => null);

      if (r.ok) { out.enviados++; det.enviados++; }
      else { out.falhas++; det.falhas++; det.erro = r.error; }
    }

    if (det.enviados || det.falhas) out.detalhes.push(det);
  }
  return out;
}
