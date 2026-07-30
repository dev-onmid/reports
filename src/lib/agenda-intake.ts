import type { makeServerPool } from '@/lib/server-db';
import { resolveClientByName } from '@/lib/reuniao-intake';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Agenda do dia, alimentada pelo Make.
 *
 * O sistema não fala com o Google Calendar: os scopes do OAuth cobrem apenas
 * `business.manage`, `adwords` e `gmail.send`, e as conexões Google existentes
 * são da agência para contas de cliente (GMB/Ads/envio) — não o calendário
 * pessoal de quem trabalha aqui. Ler o Calendar direto exigiria um tipo novo de
 * conexão, por pessoa, com cada gestor autorizando a própria conta.
 *
 * Enquanto isso, quem lê o Calendar é o Make, que empurra os eventos do dia
 * para cá. Mesma arquitetura do intake de reuniões do TLDV.
 *
 * ⚠️ Nada aqui inventa reunião: se o cenário do Make não existir, a tabela fica
 * vazia e o bloco de agenda no painel aparece vazio — corretamente.
 */

let schemaReady: Promise<void> | null = null;

export function ensureAgendaSchema(pool: Pool): Promise<void> {
  schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.agenda_eventos (
        id BIGSERIAL PRIMARY KEY,
        external_id TEXT NOT NULL,
        client_id TEXT,
        titulo TEXT NOT NULL,
        inicio TIMESTAMPTZ NOT NULL,
        fim TIMESTAMPTZ,
        participantes TEXT,
        meeting_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // O Make reexecuta cenário com frequência — o mesmo evento do Calendar não
    // pode virar duas linhas.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agenda_eventos_external_uq
        ON public.agenda_eventos (external_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS agenda_eventos_inicio_idx
        ON public.agenda_eventos (inicio)
    `);
  })().catch((err) => {
    schemaReady = null; // deixa a próxima chamada tentar de novo
    throw err;
  });
  return schemaReady;
}

export type EventoInput = {
  external_id?: string;
  id?: string;
  titulo?: string;
  summary?: string;
  inicio?: string;
  start?: string;
  fim?: string;
  end?: string;
  cliente?: string;
  participantes?: string | string[];
  meeting_url?: string;
  hangout_link?: string;
};

export type EventoResultado = {
  ok: boolean;
  external_id: string;
  titulo?: string;
  client_id?: string | null;
  erro?: string;
};

/** O Make manda nomes variados dependendo do módulo do Calendar usado. */
function primeiro(...vs: unknown[]): string {
  for (const v of vs) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

function parseData(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Um objeto só é um evento se traz pelo menos id/título/início. */
export function pareceEvento(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as EventoInput;
  return Boolean(primeiro(r.external_id, r.id) || primeiro(r.titulo, r.summary) || primeiro(r.inicio, r.start));
}

export async function upsertEvento(pool: Pool, raw: EventoInput): Promise<EventoResultado> {
  // Valida ANTES de tocar o banco: payload ruim devolvia erro de conexão em vez
  // do motivo real, o que esconde de quem monta o cenário no Make o que faltou.
  const externalId = primeiro(raw.external_id, raw.id);
  const titulo = primeiro(raw.titulo, raw.summary);
  const inicioStr = primeiro(raw.inicio, raw.start);

  if (!externalId) return { ok: false, external_id: '', erro: 'external_id_ausente' };
  if (!titulo) return { ok: false, external_id: externalId, erro: 'titulo_ausente' };

  const inicio = inicioStr ? parseData(inicioStr) : null;
  if (!inicio) return { ok: false, external_id: externalId, erro: 'inicio_invalido' };
  const fimStr = primeiro(raw.fim, raw.end);
  const fim = fimStr ? parseData(fimStr) : null;

  await ensureAgendaSchema(pool);

  // Cliente é OPCIONAL: reunião interna não tem cliente, e um nome que não casa
  // não pode derrubar o evento — ele entra sem vínculo em vez de sumir.
  let clientId: string | null = null;
  const nomeCliente = primeiro(raw.cliente);
  if (nomeCliente) {
    // `ambiguo` (dois clientes com o mesmo nome normalizado) devolve match null
    // de propósito — vincular ao cliente errado é pior que não vincular.
    const r = await resolveClientByName(pool, nomeCliente).catch(() => null);
    clientId = r?.match?.id ?? null;
  }

  const participantes = Array.isArray(raw.participantes)
    ? raw.participantes.filter(p => typeof p === 'string').join(', ')
    : primeiro(raw.participantes) || null;

  await pool.query(
    `INSERT INTO public.agenda_eventos
       (external_id, client_id, titulo, inicio, fim, participantes, meeting_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (external_id) DO UPDATE SET
       client_id = $2, titulo = $3, inicio = $4, fim = $5,
       participantes = $6, meeting_url = $7, updated_at = NOW()`,
    [
      externalId, clientId, titulo, inicio.toISOString(), fim?.toISOString() ?? null,
      participantes, primeiro(raw.meeting_url, raw.hangout_link) || null,
    ],
  );

  return { ok: true, external_id: externalId, titulo, client_id: clientId };
}

export type AgendaEvento = {
  id: string;
  client_id: string | null;
  titulo: string;
  inicio: string;
  fim: string | null;
  participantes: string | null;
  meeting_url: string | null;
};

/**
 * Eventos de HOJE em horário de Brasília.
 *
 * A janela é resolvida em BRT no banco (`AT TIME ZONE`) porque o servidor da
 * Vercel roda em UTC — usar a data do servidor mostraria a agenda errada nas
 * primeiras 3 horas do dia.
 */
export async function eventosDeHoje(pool: Pool): Promise<AgendaEvento[]> {
  await ensureAgendaSchema(pool);
  const { rows } = await pool.query(
    `SELECT id::text, client_id, titulo, inicio, fim, participantes, meeting_url
       FROM public.agenda_eventos
      WHERE (inicio AT TIME ZONE 'America/Sao_Paulo')::date
            = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY inicio ASC`,
  );
  return rows as AgendaEvento[];
}
