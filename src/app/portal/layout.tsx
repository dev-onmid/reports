import type { Metadata } from 'next';

// O portal é uma URL PÚBLICA (o token é a credencial) e mostra nome, telefone
// e conversa de lead. Sem isto, bastava o link vazar num lugar que um crawler
// alcance — um e-mail encaminhado, um grupo público — para a base do cliente
// entrar em buscador. `noindex` é a instrução que os buscadores respeitam
// mesmo quando encontram o link por fora.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
