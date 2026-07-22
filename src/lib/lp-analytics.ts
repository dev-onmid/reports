// ── Radar de LP: analytics de comportamento por landing page ─────────────────
//
// Coleta AGREGADA de comportamento (cliques + scroll + tempo) nas landing pages
// dos clientes, via script embarcável (/api/lp/tag.js) → beacon (/api/lp/collect).
//
// Princípio anti-firehose (Vercel Hobby): 1 LINHA POR SESSÃO em lp_sessions —
// o script acumula os eventos no browser e manda snapshots via sendBeacon
// (flush ~20s + pagehide); o collect faz UPSERT por (lp_id, session_key).
// Nada de gravação de tela, nada de mousemove, nada de 1 request por evento.
//
// Etapa 2 (futura — overlay de mapa de calor visual): as coordenadas absolutas
// E normalizadas (xp = x/viewport_w, yp = y/doc_height) já ficam salvas em
// clicks JSONB desde já — o heatmap só precisa ler, sem mudar schema.

import { randomBytes } from 'crypto';
import type { Pool } from 'pg';

// Alfabeto minúsculo sem ambíguos (0/O, 1/I/L) — a key vive numa URL pública.
const KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const KEY_LENGTH = 10;

export const TRACKING_KEY_REGEX = /^[a-z2-9]{10}$/;

export function generateLpTrackingKey(): string {
  const bytes = randomBytes(KEY_LENGTH);
  let key = '';
  for (let i = 0; i < KEY_LENGTH; i++) key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return key;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Um clique dentro de uma sessão (guardado no array clicks JSONB). */
export type LpClick = {
  x: number;   // pageX absoluto (px)
  y: number;   // pageY absoluto (px)
  xp: number;  // clientX / viewport_w (0–1) — pronto pro heatmap da Etapa 2
  yp: number;  // pageY / doc_height (0–1)
  el: string;  // descritor do elemento: "a#cta-hero" | "button.btn-comprar" | "div"
  txt: string; // aria-label/innerText truncado (vazio p/ inputs — LGPD)
};

// ── Schema ───────────────────────────────────────────────────────────────────

let schemaEnsured = false;

export async function ensureLpAnalyticsSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS public.client_landing_pages (
       id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       client_id    TEXT NOT NULL,
       name         TEXT NOT NULL,
       url          TEXT NOT NULL,
       tracking_key TEXT NOT NULL UNIQUE,
       active       BOOLEAN NOT NULL DEFAULT TRUE,
       created_at   TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS client_landing_pages_client_idx
       ON public.client_landing_pages (client_id)`,
    `CREATE TABLE IF NOT EXISTS public.lp_sessions (
       id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       lp_id          UUID NOT NULL REFERENCES public.client_landing_pages(id) ON DELETE CASCADE,
       session_key    TEXT NOT NULL,
       device         TEXT,
       viewport_w     INT,
       viewport_h     INT,
       doc_height     INT,
       url_path       TEXT,
       utm_source     TEXT,
       utm_medium     TEXT,
       utm_campaign   TEXT,
       referrer       TEXT,
       max_scroll_pct INT DEFAULT 0,
       duration_ms    INT DEFAULT 0,
       clicks         JSONB,
       created_at     TIMESTAMPTZ DEFAULT NOW()
     )`,
    // Proteção contra tabela parcial de deploy anterior (padrão do repo)
    `ALTER TABLE public.lp_sessions
       ADD COLUMN IF NOT EXISTS device TEXT,
       ADD COLUMN IF NOT EXISTS viewport_w INT,
       ADD COLUMN IF NOT EXISTS viewport_h INT,
       ADD COLUMN IF NOT EXISTS doc_height INT,
       ADD COLUMN IF NOT EXISTS url_path TEXT,
       ADD COLUMN IF NOT EXISTS utm_source TEXT,
       ADD COLUMN IF NOT EXISTS utm_medium TEXT,
       ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
       ADD COLUMN IF NOT EXISTS referrer TEXT,
       ADD COLUMN IF NOT EXISTS max_scroll_pct INT DEFAULT 0,
       ADD COLUMN IF NOT EXISTS duration_ms INT DEFAULT 0,
       ADD COLUMN IF NOT EXISTS clicks JSONB`,
    // Habilita o ON CONFLICT (lp_id, session_key) do upsert do collect
    `CREATE UNIQUE INDEX IF NOT EXISTS lp_sessions_lp_session_idx
       ON public.lp_sessions (lp_id, session_key)`,
    `CREATE INDEX IF NOT EXISTS lp_sessions_lp_created_idx
       ON public.lp_sessions (lp_id, created_at DESC)`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch((err) => console.error('[lp-analytics schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}
