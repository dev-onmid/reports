@AGENTS.md

# ONMID Reports — Guia de Contexto

## O que é este projeto

Plataforma de inteligência de marketing para agências brasileiras (ONMID). Ingere dados de Meta Ads, Google Ads, WhatsApp, Email e CRM, gera relatórios estratégicos com narrativa via IA e gerencia campanhas de disparo.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.4 (App Router, Turbopack) |
| Linguagem | TypeScript 5 (strict mode) |
| UI | Tailwind CSS v4 + shadcn/ui (estilo `base-nova`) |
| Banco | PostgreSQL via `pg` Pool (`src/lib/server-db.ts`) |
| Auth/BaaS | Supabase v2 (`src/lib/supabase.ts`) |
| IA | Anthropic SDK v0.96 — Claude Sonnet 4.6 (raciocínio) e Haiku 4.5 (tarefas leves) |
| Gráficos | Recharts + React Grid Layout + XYFlow |
| PDF | pdf-lib |
| Excel | xlsx |
| WhatsApp | Evolution API + Z-API (abstração em `src/lib/whatsapp-provider.ts`) |
| Google | googleapis v171 (Ads, Analytics, Gmail) |
| Deploy | Vercel (Hobby — rotas API têm limite de 10 s; evite fan-out pesado) |

---

## Estrutura de pastas

```
src/
├── app/
│   ├── (dashboard)/          # Área autenticada
│   │   ├── inicio/           # Landing do painel
│   │   ├── clientes/         # Gestão de clientes
│   │   ├── crm/              # Funil, contatos, audit IA
│   │   ├── relatorios/       # Geração e templates
│   │   ├── resultados/       # Radar / métricas
│   │   ├── pagamentos/       # Investimento em mídia
│   │   ├── disparos/         # Campanhas WhatsApp
│   │   ├── agente/           # Luna IA (chat)
│   │   ├── vault/            # Cofre de credenciais
│   │   ├── automacoes/       # Automações multi-canal
│   │   ├── integracoes/      # Conexões externas
│   │   ├── logs/             # Logs de auditoria
│   │   └── configuracoes/    # Admin
│   ├── api/                  # 70+ rotas REST
│   ├── relatorio/[token]/    # Viewer público de relatório (sem auth)
│   └── r/[slug]/             # Redirecionamentos de link
├── components/
│   ├── layout/               # Shell, sidebar, auth-guard
│   ├── ui/                   # shadcn components
│   ├── report-slides/        # Blocos de template de relatório
│   └── onmid-performance-template/  # Template novo (16:9, fundo branco)
├── lib/
│   ├── server-db.ts          # Pool PostgreSQL (server-side only)
│   ├── auth-store.ts         # Sessão em localStorage ("onmid-session")
│   ├── nav-items.ts          # Fonte única de verdade da navegação
│   ├── whatsapp-provider.ts  # Abstração Evolution/Z-API
│   ├── evolution-api.ts      # Provider Evolution
│   ├── zapi.ts               # Provider Z-API
│   ├── report-builder.ts     # Pipeline de montagem de relatório
│   ├── report-pdf.ts         # Export PDF
│   ├── ai-usage-logger.ts    # Rastreamento de custo IA
│   └── db/                   # 16 arquivos SQL de migração
└── public/
    ├── brand/                # Logos ONMID
    └── report-covers/        # Capas dinâmicas de relatório
```

---

## Banco de dados

- Driver: `pg` (Pool com SSL). Conexão em `src/lib/server-db.ts`.
- Migrations em `src/lib/db/*.sql` (16 arquivos). Aplicar em ordem por nome.
- Tabelas principais: `users`, `clients`, `diagnostic_reports`, `crm_funnels`, `crm_stages`, `crm_tags`, `meta_automations`, `email_campaigns`, `balance_alerts`, `client_categories`.
- Variável de ambiente obrigatória: `DATABASE_URL`.

---

## Autenticação e permissões

- Sessão armazenada em `localStorage` sob a chave `onmid-session`.
- Roles: `Administrador`, `Usuário`, `Visualizador`.
- Teams: `onmid` | `parceiro` — usuários `parceiro` só veem recursos do próprio owner.
- 13 flags de permissão: `dashboard`, `clientes`, `crm`, `relatorios`, `radar`, `pagamentos`, `disparos`, `luna_ia`, `cofre`, `automacoes`, `integracoes`, `logs`, `configuracoes`.
- Padrão: apenas `dashboard: true`. Falha de API → fail-open (libera tudo).

---

## Design System

- **Paleta dark-first** — fundo `#0e0f14`, card `#1a1a1a`.
- **Cor primária (CTA):** `#55f52f` (Verde Onmid). Só UMA cor de CTA.
- **Cor secundária:** `#7b2cff` (purple editorial).
- **Tipografia:** `Bebas Neue` (headings, variável `--font-bebas`) + `Inter` (corpo, `--font-sans`).
- Estilo angular, sem sombras orgânicas, sem bordas arredondadas pesadas.
- Detalhes completos em `DESIGN_SYSTEM.md`.

---

## Como rodar localmente

```bash
npm install
# Copie .env.example → .env.local e preencha as variáveis
npm run dev          # Turbopack, porta 3000
```

Variáveis mínimas para rodar:
```
DATABASE_URL=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
```

---

## Cron jobs (Vercel)

Definidos em `vercel.json`:
- `POST /api/reports/cron-monthly` — dia 1 de cada mês, 08h UTC.
- `POST /api/alerts/balance-cron` — diariamente, 10h UTC.

---

## Regras e convenções

1. **Limite de 10 s nas rotas API** (Vercel Hobby) — não fazer fan-out pesado em uma única rota.
2. `"use client"` só quando necessário; preferir Server Components.
3. Alias `@/*` → `src/*` configurado no tsconfig.
4. Banco de dados acessado **somente server-side** via `src/lib/server-db.ts`.
5. Navegação centralizada em `src/lib/nav-items.ts` — alterar lá para refletir em toda a sidebar.
6. Provedores WhatsApp abstraídos — usar `whatsapp-provider.ts` em vez de chamar Evolution/Z-API diretamente.
7. Claude Sonnet 4.6 para raciocínio; Haiku 4.5 para tarefas leves. Custos logados via `ai-usage-logger.ts`.
8. Moeda padrão: BRL. Formatação de moeda nos utilitários em `src/lib/utils.ts`.
9. Relatórios públicos em `/relatorio/[token]` não exigem autenticação.
10. **Antes de escrever código Next.js, leia os guias em `node_modules/next/dist/docs/`** — esta versão (16.x) tem breaking changes.

---

## Integrações externas

| Serviço | Lib/Arquivo |
|---|---|
| Meta Ads | `src/lib/meta-connections-store.ts`, `src/lib/meta-ads-store.ts` |
| Google Ads / Analytics | `src/lib/google-connections-store.ts`, `src/lib/google-ads-store.ts` |
| Gmail | `src/lib/gmail.ts` |
| WhatsApp (Evolution) | `src/lib/evolution-api.ts` — URL via variável de ambiente `EVOLUTION_API_URL` |
| WhatsApp (Z-API) | `src/lib/zapi.ts` |
| Instagram DM | `src/lib/instagram-dm.ts` |
| Anthropic / Claude | `@anthropic-ai/sdk` — chave via `ANTHROPIC_API_KEY` |

---

## Otimizador de Campanhas

Módulo de análise automática de performance — arquivos principais:

| Arquivo | Papel |
|---|---|
| `src/lib/optimizer.ts` | Tipos, payload builder, Camada 1, system prompt do Claude |
| `src/app/api/otimizador/analisar/route.ts` | POST análise (Camada 1 → cache → IA), GET fila, PATCH log de decisão |
| `src/app/api/otimizador/daily/route.ts` | Cron/manual — busca campanhas e dispara análises em lote |
| `src/app/(dashboard)/otimizador/page.tsx` | UI da fila de decisões |

### Decisões arquiteturais do Otimizador

- **`objetivo_campanha`** é o campo mais crítico do payload. Antes de qualquer análise, o Claude identifica o objetivo (`leads | trafego | vendas | engajamento | reconhecimento`) e adapta as métricas avaliadas. CPL só é problema em campanhas de `leads` ou `vendas`. Nunca mencionar CPL em `trafego`, `engajamento` ou `reconhecimento`.
- **Meta**: objetivo vem de `campaign.objective` (campo `OUTCOME_LEADS`, `OUTCOME_TRAFFIC`, etc.) — normalizado por `normalizeMetaObjective()` em `campaigns/route.ts`.
- **Google**: objetivo vem de `campaign.advertising_channel_type` no GAQL — normalizado por `normalizeGoogleChannelType()`. `SEARCH` → `trafego`, `SHOPPING/PERFORMANCE_MAX` → `vendas`, `DISPLAY/VIDEO` → `reconhecimento`.
- **Campanhas pausadas são ignoradas** no daily route — filtro `['ACTIVE','ENABLED','IN_PROCESS','WITH_ISSUES']` aplicado antes de enviar para análise.
- **Tom do prompt**: imperativo e direto, como gestor falando com gestor. Sem linguagem de relatório formal. Ex: "Pausa esse criativo agora — CTR de 0,4% com frequência baixa." (não "Recomenda-se a revisão do criativo.")
- **Camada 1** (regras automáticas sem IA): CPL crítico e regra de aprendizado só disparam para `isLeadsOrSales`. `estimateCriticalLevel` também respeita o objetivo.
- **Cache**: resultados de análise em `optimizer_ai_logs` (PostgreSQL). Hash do payload + drift < 5% → usa cache. Limite de 10 chamadas IA/cliente/dia.
- **Fallback de métricas Google no Dashboard**: quando a API de métricas retorna `google: null`, o dashboard agrega spend/leads/impressions/clicks diretamente do estado `campaigns` (que usa endpoint separado que funciona). Ver `googleCampaignsTotals` em `dashboard/page.tsx`.
- **IS metrics (Google)**: `search_impression_share`, `search_budget_lost_impression_share`, `search_absolute_top_impression_share` — disponíveis apenas no `FROM campaign` (GAQL), **não** no `FROM customer`. Nunca misturar IS com `segments.date` no `FROM customer` — quebra a query.
- **MCC map**: `buildMccMap` cacheado por `connectionId` com TTL de 4h em `api-cache.ts`. Necessário para o header `login-customer-id` nas chamadas Google Ads.

---

## Integração Leadlovers

Módulo de envio de contatos para o Leadlovers via webhook com cronograma inteligente — arquivos principais:

| Arquivo | Papel |
|---|---|
| `src/lib/db/migration_leadlovers.sql` | 5 tabelas: config, campaigns, schedule_rules, contacts, dispatch_log |
| `src/app/api/leadlovers/config/route.ts` | GET/POST/PUT (test) do webhook |
| `src/app/api/leadlovers/contacts/route.ts` | GET/POST/DELETE contatos (parse JSON do xlsx feito no cliente) |
| `src/app/api/leadlovers/campaigns/route.ts` | GET/POST campanhas (com rules inline via JOIN) |
| `src/app/api/leadlovers/campaigns/[id]/route.ts` | GET/PATCH/DELETE campanha |
| `src/app/api/leadlovers/campaigns/[id]/rules/route.ts` | GET/POST/DELETE regras de cronograma |
| `src/app/api/leadlovers/campaigns/[id]/activate/route.ts` | POST — pré-computa `next_send_at` para cada contato |
| `src/app/api/leadlovers/worker/route.ts` | POST — envia contatos com `next_send_at <= NOW()` (frontend poll + cron) |
| `src/app/(dashboard)/integracoes/leadlovers/page.tsx` | UI com 4 abas: Upload, Webhook, Cronograma, Painel |

### Decisões arquiteturais do Leadlovers

- **xlsx parse no cliente**: a planilha é lida no browser com `XLSX.read()` e enviada como JSON para `/api/leadlovers/contacts`. Evita upload binário e mantém dentro do limite de 10s.
- **Agendamento pré-computado**: ao ativar a campanha (`/activate`), o backend distribui contatos nos dias úteis com `next_send_at` já calculado. O worker não precisa de lógica de scheduling — só busca `WHERE next_send_at <= NOW()`.
- **Apenas dias úteis**: `businessDaysBetween()` em `activate/route.ts` pula sábado (6) e domingo (0).
- **Intervalo opcional**: se `interval_minutes` é `NULL`, todos os contatos do dia recebem o mesmo `next_send_at` (horário de envio). Se preenchido, cada contato é escalonado em +N minutos.
- **Worker**: chamado pelo frontend (polling na aba Painel, 1x/min quando monitorando) e pelo Vercel cron `0 9 * * 1-5` (só dias úteis). Limite de 50 contatos por chamada para respeitar timeout de 10s.
- **Não usa Supabase**: todas as tabelas são PostgreSQL via `server-db.ts`. O erro `supabaseUrl is required` na página `/integracoes` é pré-existente (env var faltando no dev), não relacionado a esta feature.
- **Card na página de integrações**: Leadlovers aparece na categoria "Automação" e navega para `/integracoes/leadlovers` ao clicar. `IntegrationId` union type foi extendido.
- **Cron Vercel adicionado**: `"0 9 * * 1-5"` em `vercel.json` para processar envios matinais sem depender do browser aberto.

---

## Instruções para o Claude

- Ao final de cada sessão, atualize este arquivo com decisões novas, tecnologias adicionadas ou mudanças importantes feitas hoje.
- Sempre use Sonnet 4.6 para raciocínio e Haiku 4.5 para tarefas simples.
