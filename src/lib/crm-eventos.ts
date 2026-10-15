/**
 * Histórico do lead: quem fez o quê, e quando.
 *
 * ⚠️ Por que existe (2026-10-09): o CRM passa a ser operado pelos funcionários
 * dos clientes. Até aqui um PUT sobrescrevia o lead sem rastro — não dava para
 * saber quem moveu o lead de etapa, quem mudou o valor nem quem excluiu.
 * `crm_status_historico` só recebia o que a IA move.
 *
 * Tabela só de INSERT, SEM chave estrangeira para `crm_leads` de propósito: o
 * registro de exclusão tem de sobreviver à exclusão. A autoria vem dos headers
 * que o PROXY escreve a partir do cookie assinado (o valor mandado pelo
 * navegador é apagado antes), então não dá para forjar o autor.
 *
 * Nunca lança: registrar o histórico não pode derrubar a edição do lead.
 */
import type { Pool } from 'pg';

export type EventoLead = {
  tipo: 'criado' | 'editado' | 'etapa' | 'excluido';
  campo?: string | null;
  de?: string | null;
  para?: string | null;
};

let pronto: Promise<void> | null = null;
export function ensureCrmEventos(pool: Pool): Promise<void> {
  if (!pronto) {
    pronto = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.crm_lead_eventos (
          id BIGSERIAL PRIMARY KEY,
          lead_id UUID NOT NULL,
          client_id TEXT NOT NULL,
          tipo TEXT NOT NULL,
          campo TEXT,
          de TEXT,
          para TEXT,
          autor_id TEXT,
          autor_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS crm_lead_eventos_lead_idx ON public.crm_lead_eventos (lead_id, created_at DESC)`);
    })().catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

/** Autor da requisição, como o proxy escreveu. Chamada interna (cron, IA) = sistema. */
export function autorDaRequisicao(req: Request): { id: string | null; nome: string } {
  const id = req.headers.get('x-onmid-user-id');
  const cru = req.headers.get('x-onmid-user-name');
  let nome = '';
  try { nome = cru ? decodeURIComponent(cru) : ''; } catch { nome = ''; }
  return { id: id || null, nome: nome || (id ? 'Usuário' : 'Sistema') };
}

/** Campos acompanhados no histórico, com o nome que aparece na tela. */
export const CAMPOS_ACOMPANHADOS: Record<string, string> = {
  status: 'Etapa',
  nome: 'Nome',
  numero: 'Telefone',
  canal: 'Origem',
  responsavel: 'Responsável',
  valor_rs: 'Valor',
  fechou: 'Fechou negócio',
  qualificado: 'Qualificado',
  data_agendada: 'Agendamento',
  hora_agendada: 'Horário',
  compareceu: 'Compareceu',
  motivo_perda: 'Motivo da perda',
  proxima_acao: 'Próxima ação',
  proxima_acao_em: 'Prazo da próxima ação',
  temperatura: 'Temperatura',
  time_interno: 'Time interno',
};

function texto(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return String(v);
}

/** Datas chegam como Date do driver e como 'YYYY-MM-DD' da tela: compara pelo dia. */
function normal(campo: string, v: unknown): string | null {
  const t = texto(v);
  if (t === null) return null;
  if (campo === 'data_agendada' && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (campo === 'valor_rs') { const n = Number(t); return Number.isFinite(n) ? String(n) : t; }
  return t;
}

/** O que mudou entre a linha antiga e a nova, só nos campos acompanhados. */
export function diffLead(antes: Record<string, unknown>, depois: Record<string, unknown>): EventoLead[] {
  const out: EventoLead[] = [];
  for (const campo of Object.keys(CAMPOS_ACOMPANHADOS)) {
    if (!(campo in depois)) continue;
    const de = normal(campo, antes[campo]);
    const para = normal(campo, depois[campo]);
    if (de === para) continue;
    out.push({ tipo: campo === 'status' ? 'etapa' : 'editado', campo, de, para });
  }
  return out;
}

export async function registrarEventos(pool: Pool, opts: {
  leadId: string; clientId: string; autor: { id: string | null; nome: string }; eventos: EventoLead[];
}): Promise<void> {
  if (opts.eventos.length === 0) return;
  try {
    await ensureCrmEventos(pool);
    const vals: unknown[] = [];
    const linhas = opts.eventos.map((e, i) => {
      const b = i * 8;
      vals.push(opts.leadId, opts.clientId, e.tipo, e.campo ?? null,
        e.de?.slice(0, 500) ?? null, e.para?.slice(0, 500) ?? null, opts.autor.id, opts.autor.nome);
      return `($${b + 1}::uuid,$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    await pool.query(
      `INSERT INTO public.crm_lead_eventos (lead_id, client_id, tipo, campo, de, para, autor_id, autor_nome)
       VALUES ${linhas.join(',')}`,
      vals,
    );
  } catch (err) {
    console.error('[crm-eventos]', err instanceof Error ? err.message : err);
  }
}

/**
 * Colunas da operação do dia a dia (2026-10-09):
 * - `hora_agendada` ('HH:MM'): campo SEPARADO de `data_agendada` de propósito.
 *   O funil (a comparecer/faltaram) e as importações de planilha dependem de
 *   `data_agendada` ser DATE; trocar o tipo quebraria os dois.
 * - `proxima_acao` / `proxima_acao_em`: a tarefa do lead ("ligar quinta 10h").
 * - `responsavel_manual`: quem foi definido à mão no CRM VENCE a integração
 *   (SULTS/Agendor reescrevem `responsavel` a cada sincronização — sem esta
 *   marca, a troca feita na tela sumiria na sincronização seguinte).
 */
let colunasProntas: Promise<void> | null = null;
export function ensureColunasOperacao(pool: Pool): Promise<void> {
  if (!colunasProntas) {
    colunasProntas = pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS responsavel TEXT,
        ADD COLUMN IF NOT EXISTS responsavel_manual BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS hora_agendada TEXT,
        ADD COLUMN IF NOT EXISTS proxima_acao TEXT,
        ADD COLUMN IF NOT EXISTS proxima_acao_em TIMESTAMPTZ`)
      .then(() => undefined)
      .catch((e) => { colunasProntas = null; throw e; });
  }
  return colunasProntas;
}

/** 'HH:MM' válido ou null. */
export function horaValida(v: unknown): string | null {
  const m = String(v ?? '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
