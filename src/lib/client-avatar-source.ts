/**
 * De onde sai a foto de um cliente — regra ÚNICA, usada pela rota do mapa de
 * avatares (e testável sem banco).
 *
 * ⚠️ Ordem de preferência decidida por medição (2026-09-12), não por gosto:
 *
 * 1. **Foto do Instagram** (`social_monitor_snapshots.profile_picture_url`),
 *    desde que a URL ainda esteja válida. É a foto que o cliente realmente
 *    mantém atualizada — e há Página de Facebook SEM foto nenhuma (medido: a
 *    do Atmos.mov devolve o placeholder de bandeirinha do Facebook, enquanto o
 *    @atmos.mov tem foto de verdade).
 * 2. **Foto da Página do Facebook** via `graph.facebook.com/{pageId}/picture`.
 *    Endpoint público (não precisa de token) e a URL NUNCA expira — por isso é
 *    o alicerce, mesmo sendo a segunda opção.
 * 3. Nada → a UI cai nas iniciais.
 *
 * ⚠️ O id do Instagram NÃO serve neste endpoint: `graph.facebook.com/{ig_id}/picture`
 * responde **400 "Tried accessing nonexisting field (picture)"** (medido nas
 * contas reais). Era por isso que todo cliente cujo primeiro vínculo era
 * Instagram ficava sem foto. Só entra aqui id de PÁGINA.
 */

/** 120px cobre o maior avatar da UI (56px) em tela retina, com folga. */
const LADO_PX = 120;

/** Margem de segurança: URL que vence dentro de 1h já é tratada como vencida. */
const MARGEM_MS = 60 * 60 * 1000;

/**
 * URLs do fbcdn carregam a própria expiração no parâmetro `oe` (epoch em
 * HEXADECIMAL). Sem conferir isso, o snapshot de um cliente que o monitor
 * parou de coletar serviria uma URL que o CDN responde com **403** — medido:
 * Cost Odonto e Elquis Galdino, parados desde 18/07, venceram em 22/07.
 */
export function expiracaoDaUrl(url: string): number | null {
  const m = /[?&]oe=([0-9A-Fa-f]+)/.exec(url);
  if (!m) return null;
  const seg = parseInt(m[1], 16);
  return Number.isFinite(seg) && seg > 0 ? seg * 1000 : null;
}

/** Sem `oe` não dá para saber que venceu — vale (é o caso das URLs estáveis). */
export function urlAindaVale(url: string, agora = Date.now()): boolean {
  const exp = expiracaoDaUrl(url);
  return exp === null || exp > agora + MARGEM_MS;
}

export function fotoDaPagina(pageId: string): string {
  return `https://graph.facebook.com/${pageId}/picture?width=${LADO_PX}&height=${LADO_PX}`;
}

export type FonteAvatar = {
  /** `profile_picture_url` do snapshot do monitor social. */
  fotoInstagram?: string | null;
  /** Id da PÁGINA do Facebook — do vínculo de contas ou do snapshot. */
  pageId?: string | null;
};

export function avatarDoCliente(fonte: FonteAvatar, agora = Date.now()): string | null {
  const ig = fonte.fotoInstagram?.trim();
  if (ig && urlAindaVale(ig, agora)) return ig;
  const page = fonte.pageId?.trim();
  return page ? fotoDaPagina(page) : null;
}
