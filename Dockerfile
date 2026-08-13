# Imagem de produção do ONMID Reports para rodar fora da Vercel (Coolify/VPS).
#
# Três estágios para que a imagem final NÃO carregue o código-fonte nem as
# dependências de build — só o servidor mínimo que o `output: 'standalone'`
# gera. Resultado típico: centenas de MB a menos e subida mais rápida.
#
# ⚠️ A construção acontece AQUI (no seu Mac ou no GitHub), nunca na VPS. A VPS
# só recebe a imagem pronta — os 2 núcleos dela continuam livres para a
# Evolution (WhatsApp), que é o risco real de colocar o sistema na mesma
# máquina.

FROM node:22-alpine AS base
# libc6-compat: o sharp (otimização de imagem do next/image) é compilado para
# glibc; sem isto ele falha em Alpine na hora de servir imagem.
RUN apk add --no-cache libc6-compat

# ---------------------------------------------------------------- dependências
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` (e não `install`): respeita o lockfile à risca — a imagem sobe com
# exatamente as versões testadas aqui.
RUN npm ci

# ---------------------------------------------------------------- construção
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ⚠️ As variáveis NEXT_PUBLIC_* são gravadas DENTRO do JavaScript do navegador
# durante o build — não são lidas ao rodar. Se faltarem aqui, o site sobe
# quebrado (o cliente Supabase estoura na importação) e nenhum ajuste de
# variável na VPS conserta: só reconstruindo.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------- execução
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# Usuário sem privilégios: se alguém escapar do processo do Node, não cai como
# root numa máquina que também hospeda o WhatsApp de todos os clientes.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# O server.js do standalone NÃO copia estes dois sozinho (documentado em
# next/dist/docs/.../output.md). Sem eles o site sobe sem CSS e sem imagem.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
