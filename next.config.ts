import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Gera .next/standalone: o servidor mínimo + só os node_modules realmente
  // usados. É o que permite construir aqui (ou no GitHub) e enviar pronto pra
  // VPS — a VPS nunca roda `npm install` nem o build, então os 2 núcleos dela
  // continuam livres pra Evolution (WhatsApp).
  //
  // ⚠️ O server.js gerado NÃO copia `public` nem `.next/static` sozinho — o
  // Dockerfile faz essa cópia. Sem ela o site sobe sem CSS e sem imagem.
  output: 'standalone',
  // Cabeçalhos de segurança (auditoria 2026-10-10): antes a resposta não
  // trazia nenhum. HSTS sem includeSubDomains de propósito — as landing pages
  // *.onmid.app ficam no Cloudflare Pages e não são deste servidor.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
