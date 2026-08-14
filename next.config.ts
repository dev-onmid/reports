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
};

export default nextConfig;
