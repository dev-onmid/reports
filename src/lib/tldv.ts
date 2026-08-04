/**
 * Cliente da API do TLDV e o disparo do pipeline de reuniões.
 *
 * Existe porque o webhook do TLDV **desapareceu sozinho** duas vezes (a chave
 * de API continuou válida, mas a configuração do webhook sumiu do painel) e
 * cada sumiço custou um dia de reuniões perdidas em silêncio — 5 na última
 * vez. A API do TLDV não expõe endpoint de webhook, então não dá para
 * recriá-lo por código; o jeito de não depender dele é PERGUNTAR.
 *
 * O polling é a fonte primária. Se alguém reconfigurar o webhook no painel,
 * os dois convivem sem duplicar: o Cenário 1 é protegido pela tabela
 * `tldv_reunioes` daqui, e o v4 pelo próprio Data Store de deduplicação.
 */

const BASE = 'https://pasta.tldv.io/v1alpha1';

/**
 * Webhooks do Make. Não são segredo (quem tem a URL só consegue disparar o
 * cenário, que por sua vez só age sobre reuniões que existem no TLDV), mas
 * ficam em env para poder trocar sem deploy se um cenário for recriado.
 */
export const WEBHOOK_REUNIAO_PRONTA =
  process.env.MAKE_WEBHOOK_REUNIAO_PRONTA ??
  'https://hook.us2.make.com/gckmj2d5q72uv1ml87ie7quo3cnuxoso';
export const WEBHOOK_TRANSCRICAO_PRONTA =
  process.env.MAKE_WEBHOOK_TRANSCRICAO_PRONTA ??
  'https://hook.us2.make.com/k9xxpv9qept5tk2xcq39gj9dsm1jcr5o';

export type TldvMeeting = {
  id: string;
  name?: string;
  happenedAt?: string;
  duration?: number;
  organizer?: { name?: string; email?: string };
  extraProperties?: { conferenceId?: string };
};

export type TldvTranscript = {
  id: string;
  meetingId: string;
  data?: { startTime: number; endTime: number; speaker: string; text: string }[];
};

export class TldvError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TldvError';
  }
}

async function tldvFetch<T>(caminho: string): Promise<T> {
  const chave = process.env.TLDV_API_KEY;
  if (!chave) throw new TldvError('TLDV_API_KEY não configurada');

  const r = await fetch(`${BASE}${caminho}`, {
    headers: { 'x-api-key': chave },
    // A lista de reuniões muda a cada gravação; cache aqui esconderia
    // justamente a reunião nova que o polling existe para encontrar.
    cache: 'no-store',
  });
  if (!r.ok) throw new TldvError(`TLDV ${caminho} respondeu ${r.status}`, r.status);
  return r.json() as Promise<T>;
}

/**
 * Data em ISO. A LISTAGEM devolve `happenedAt` no formato de `Date.toString()`
 * ("Tue Aug 04 2026 13:07:17 GMT+0000 (...)"), enquanto o detalhe devolve ISO
 * — o Postgres recusa o primeiro e o Make não o parseia na janela da agenda.
 */
export function dataIso(bruta: string | undefined): string | null {
  if (!bruta) return null;
  const t = Date.parse(bruta);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Reuniões mais recentes primeiro. */
export async function listarReunioes(limite = 20): Promise<TldvMeeting[]> {
  const d = await tldvFetch<{ results?: TldvMeeting[]; data?: TldvMeeting[] }>(
    `/meetings?page=1&limit=${limite}`,
  );
  return d.results ?? d.data ?? [];
}

/** Detalhe de uma reunião — é o que o webhook do TLDV mandaria, verbatim. */
export async function buscarReuniao(meetingId: string): Promise<TldvMeeting> {
  return tldvFetch<TldvMeeting>(`/meetings/${meetingId}`);
}

export async function buscarTranscricao(meetingId: string): Promise<TldvTranscript> {
  return tldvFetch<TldvTranscript>(`/meetings/${meetingId}/transcript`);
}

/**
 * Reencena para o Make o webhook que o TLDV deveria ter mandado. O formato é
 * o mesmo que o TLDV usa — os cenários não sabem (nem precisam saber) que o
 * evento veio de um polling.
 */
async function dispararWebhook(url: string, corpo: unknown): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new TldvError(`webhook do Make respondeu ${r.status}`, r.status);
}

export async function dispararReuniaoPronta(m: TldvMeeting): Promise<void> {
  await dispararWebhook(WEBHOOK_REUNIAO_PRONTA, {
    event: 'MeetingReady',
    data: m,
    executedAt: m.happenedAt,
  });
}

export async function dispararTranscricaoPronta(t: TldvTranscript): Promise<void> {
  await dispararWebhook(WEBHOOK_TRANSCRICAO_PRONTA, {
    event: 'TranscriptReady',
    data: t,
  });
}
