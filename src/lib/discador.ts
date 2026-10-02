import type { Pool } from 'pg';
import { memoizarSchema } from '@/lib/schema-memo';

/**
 * Discador — ligações de prospecção um clique por vez.
 *
 * Não existe telefonia aqui: o botão "Ligar" da tela é um link `tel:` que o
 * Mac entrega ao FaceTime (chamada pelo iPhone) e o iPhone abre no discador.
 * O que o sistema faz é o resto do trabalho braçal — guardar a lista, dizer
 * quem é o próximo, anotar o resultado de cada tentativa e levar para o CRM
 * quem atendeu. Decisão do Matheus em 01/10/2026: semiautomático e dentro do
 * reports, em vez de um discador em nuvem.
 */

export const RESULTADOS = ['nao_atendeu', 'caixa_postal', 'numero_errado', 'atendeu'] as const;
export type Resultado = (typeof RESULTADOS)[number];

export const INTERESSES = ['proposta', 'retornar', 'sem_interesse', 'nao_decisor'] as const;
export type Interesse = (typeof INTERESSES)[number];

/** Depois disso o contato sai da fila de retentativa — ninguém liga 10 vezes. */
export const MAX_TENTATIVAS = 3;
/** Quem não atendeu só volta à fila depois deste intervalo (outro horário). */
export const HORAS_ENTRE_TENTATIVAS = 3;

export type Contato = {
  id: string;
  lista_id: string;
  posicao: number;
  empresa: string | null;
  nome_contato: string | null;
  telefone: string;
  telefone2: string | null;
  cidade: string | null;
  segmento: string | null;
  email: string | null;
  cnpj: string | null;
  status: 'fila' | 'nao_atendeu' | 'caixa_postal' | 'numero_errado' | 'atendeu' | 'retornar';
  tentativas: number;
  ultima_tentativa_at: string | null;
  proxima_tentativa_at: string | null;
  pulado_at: string | null;
  interesse: Interesse | null;
  observacao: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Contadores = {
  total: number;
  fila: number;
  sem_resposta: number;
  numero_errado: number;
  atenderam: number;
  retornar: number;
  leads: number;
  ligados: number;
  chamadas: number;
};

/**
 * Só dígitos, com o 55 na frente. Aceita "(43) 99999-8888", "043 3322-1100",
 * "5543999998888". Devolve null para o que não parece telefone brasileiro —
 * é isso que tira da lista o CNPJ, o CEP e o lixo de coluna errada.
 */
export function normalizarTelefone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null;
}

export function formatarTelefone(d: string | null | undefined): string {
  if (!d) return '';
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  const ddd = n.slice(0, 2);
  const resto = n.slice(2);
  if (resto.length === 9) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
  if (resto.length === 8) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return d;
}

export function telHref(d: string): string {
  return `tel:+${d}`;
}

export function whatsappHref(d: string): string {
  return `https://wa.me/${d}`;
}

async function ensureInterno(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.discador_listas (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome        TEXT NOT NULL,
      client_id   TEXT,
      criado_por  TEXT,
      arquivada   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.discador_contatos (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lista_id             UUID NOT NULL REFERENCES public.discador_listas(id) ON DELETE CASCADE,
      posicao              INT NOT NULL DEFAULT 0,
      empresa              TEXT,
      nome_contato         TEXT,
      telefone             TEXT NOT NULL,
      telefone2            TEXT,
      cidade               TEXT,
      segmento             TEXT,
      email                TEXT,
      cnpj                 TEXT,
      extra                JSONB,
      status               TEXT NOT NULL DEFAULT 'fila',
      tentativas           INT NOT NULL DEFAULT 0,
      ultima_tentativa_at  TIMESTAMPTZ,
      proxima_tentativa_at TIMESTAMPTZ,
      pulado_at            TIMESTAMPTZ,
      interesse            TEXT,
      observacao           TEXT,
      lead_id              UUID,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS discador_contatos_lista_status_idx ON public.discador_contatos(lista_id, status);
    CREATE INDEX IF NOT EXISTS discador_contatos_telefone_idx ON public.discador_contatos(telefone);
    CREATE TABLE IF NOT EXISTS public.discador_chamadas (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contato_id    UUID NOT NULL REFERENCES public.discador_contatos(id) ON DELETE CASCADE,
      lista_id      UUID NOT NULL,
      user_id       TEXT,
      resultado     TEXT NOT NULL,
      interesse     TEXT,
      observacao    TEXT,
      iniciada_at   TIMESTAMPTZ,
      registrada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS discador_chamadas_lista_idx ON public.discador_chamadas(lista_id, registrada_at DESC);
  `);
}

export const ensureDiscadorSchema = memoizarSchema(ensureInterno);

export async function contadoresDaLista(pool: Pool, listaId: string): Promise<Contadores> {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'fila')::int AS fila,
            COUNT(*) FILTER (WHERE status IN ('nao_atendeu','caixa_postal'))::int AS sem_resposta,
            COUNT(*) FILTER (WHERE status = 'numero_errado')::int AS numero_errado,
            COUNT(*) FILTER (WHERE status IN ('atendeu','retornar'))::int AS atenderam,
            COUNT(*) FILTER (WHERE status = 'retornar')::int AS retornar,
            COUNT(*) FILTER (WHERE lead_id IS NOT NULL)::int AS leads,
            COUNT(*) FILTER (WHERE tentativas > 0)::int AS ligados,
            COALESCE(SUM(tentativas), 0)::int AS chamadas
       FROM public.discador_contatos
      WHERE lista_id = $1`,
    [listaId],
  );
  return r as Contadores;
}

export type MotivoProximo = 'retorno' | 'fila' | 'nova_tentativa';

/**
 * Quem é o próximo. Ordem: retorno combinado que já venceu → fila (quem foi
 * pulado vai para o fim) → quem não atendeu há mais de N horas e ainda tem
 * tentativa. `excluir` tira o contato que acabou de ser registrado, para a
 * tela nunca mostrar o mesmo duas vezes seguidas.
 */
export async function proximoContato(
  pool: Pool,
  listaId: string,
  excluir?: string | null,
): Promise<{ contato: Contato | null; motivo: MotivoProximo | null }> {
  const ex = excluir ?? null;
  const passos: Array<[MotivoProximo, string]> = [
    ['retorno', `SELECT * FROM public.discador_contatos
                  WHERE lista_id = $1 AND status = 'retornar' AND proxima_tentativa_at <= NOW()
                    AND ($2::uuid IS NULL OR id <> $2::uuid)
                  ORDER BY proxima_tentativa_at ASC LIMIT 1`],
    ['fila', `SELECT * FROM public.discador_contatos
               WHERE lista_id = $1 AND status = 'fila'
                 AND ($2::uuid IS NULL OR id <> $2::uuid)
               ORDER BY pulado_at ASC NULLS FIRST, posicao ASC LIMIT 1`],
    ['nova_tentativa', `SELECT * FROM public.discador_contatos
                         WHERE lista_id = $1 AND status IN ('nao_atendeu','caixa_postal')
                           AND tentativas < ${MAX_TENTATIVAS}
                           AND ultima_tentativa_at < NOW() - INTERVAL '${HORAS_ENTRE_TENTATIVAS} hours'
                           AND ($2::uuid IS NULL OR id <> $2::uuid)
                         ORDER BY ultima_tentativa_at ASC LIMIT 1`],
  ];
  for (const [motivo, sql] of passos) {
    const { rows } = await pool.query(sql, [listaId, ex]);
    if (rows[0]) return { contato: rows[0] as Contato, motivo };
  }
  return { contato: null, motivo: null };
}

/** Quantos ainda podem ser ligados agora ou mais tarde (para a barra de progresso). */
export async function pendentesDaLista(pool: Pool, listaId: string): Promise<{ agora: number; depois: number }> {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'fila'
                              OR (status = 'retornar' AND proxima_tentativa_at <= NOW())
                              OR (status IN ('nao_atendeu','caixa_postal') AND tentativas < $2
                                  AND ultima_tentativa_at < NOW() - ($3 || ' hours')::interval))::int AS agora,
            COUNT(*) FILTER (WHERE (status = 'retornar' AND proxima_tentativa_at > NOW())
                              OR (status IN ('nao_atendeu','caixa_postal') AND tentativas < $2
                                  AND ultima_tentativa_at >= NOW() - ($3 || ' hours')::interval))::int AS depois
       FROM public.discador_contatos WHERE lista_id = $1`,
    [listaId, MAX_TENTATIVAS, String(HORAS_ENTRE_TENTATIVAS)],
  );
  return r as { agora: number; depois: number };
}

export const ROTULO_RESULTADO: Record<Resultado, string> = {
  nao_atendeu: 'Não atendeu',
  caixa_postal: 'Caixa postal',
  numero_errado: 'Número errado',
  atendeu: 'Atendeu',
};

export const ROTULO_INTERESSE: Record<Interesse, string> = {
  proposta: 'Quer proposta',
  retornar: 'Retornar depois',
  sem_interesse: 'Sem interesse',
  nao_decisor: 'Não é quem decide',
};
