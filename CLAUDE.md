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
- `POST /api/alerts/balance-cron` — diariamente, 10h UTC.

## Alerta Webshare (proxy do WhatsApp)

Monitora a conta Webshare (proxy residencial que roteia TODAS as instâncias Evolution — ponto único de falha: se a banda estoura ou a assinatura pausa por pagamento, todo o WhatsApp cai). Arquivos:

| Arquivo | Papel |
|---|---|
| `src/lib/webshare.ts` | `getWebshareHealth()` (banda via `/api/v2/stats/aggregate/` → `bandwidth_total`; status via `/api/v2/subscription/` → `throttled`/`paused`/`renewals_enabled`/`end_date`) + `evaluateWebshareAlert()` |
| `src/app/api/alerts/webshare-cron/route.ts` | GET secret-guarded — checa saúde, dispara WhatsApp (reusa grupo do Otimizador) + e-mail (Gmail conectado), dedupe via `system_settings['webshare_alert_last']` |
| `.github/workflows/webshare-alert.yml` | Cron diário `0 11 * * *` (08h BRT) via GitHub Actions, chama a rota com `secrets.WEBSHARE_ALERT_URL` |

- **Limite de banda** não vem cru na API → env `WEBSHARE_BANDWIDTH_LIMIT_GB` (default 250, plano atual). Threshold de aviso: `WEBSHARE_WARN_PCT` (default 80).
- **Envio**: alerta em 80% (antes de cair, WhatsApp ainda funciona) + e-mail de backup (chega mesmo com proxy fora). Dia 1 do mês: lembrete de pagamento sempre (Matheus paga o Webshare todo dia 1).
- **Dedupe**: não reenvia o mesmo nível de alerta diariamente — só se mudar de nível, passar ≥3 dias, ou for dia 1.
- **Env obrigatórias**: `WEBSHARE_API_KEY` (painel Webshare → API), `WEBSHARE_ALERT_EMAIL` (destinatário), `CRON_SECRET` (já existe). GitHub secret: `WEBSHARE_ALERT_URL` (URL completa com `?secret=CRON_SECRET`).

## Alertas de instâncias Evolution desconectadas

Monitora o status de todas as instâncias na VPS Evolution e alerta quando alguma desconecta. Três camadas de alerta com redundância (se WhatsApp cair, banner + email ainda chegam).

| Arquivo | Papel |
|---|---|
| `src/lib/evolution-instance-alerts.ts` | `fetchDisconnectedInstances()` (chama VPS diretamente), `sendInstanceAlerts()` (dedup + WhatsApp + Gmail), `buildWhatsAppMessage()`, `buildEmailHtml()` |
| `src/app/api/alerts/evolution-status/route.ts` | GET — chamado pelo banner do dashboard a cada 5 min; retorna lista de instâncias desconectadas |
| `src/app/api/alerts/evolution-cron/route.ts` | GET secret-guarded — chama `sendInstanceAlerts()` com dedup por `(instance, status, alert_date)` |
| `src/components/layout/evolution-alert-banner.tsx` | Banner vermelho no topo do dashboard, polling a cada 5 min, dismiss com re-show após 30 min |
| `.github/workflows/evolution-alert.yml` | Cron `0 10 * * 1-5` (07h BRT) e `0 17 * * 1-5` (14h BRT) via GitHub Actions |

- **Dedup**: tabela `evolution_alert_log (instance TEXT, status TEXT, alert_date DATE, UNIQUE(instance, status, alert_date))` — não repete o mesmo alerta de mesma instância+status no mesmo dia.
- **Destino WhatsApp**: reutiliza instância `numero_matheus_4398835555` + grupo da tabela `optimizer_whatsapp_config`.
- **Destino Email**: Gmail conectado + env `WEBSHARE_ALERT_EMAIL` (mesma do Webshare).
- **Razões de desconexão interpretadas**: 401 → sessão revogada (reconectar QR); 403 → bloqueio; `device_removed` → aparelho removido; `connecting` → reconectando.
- **Banner**: aparece em qualquer página do dashboard. Botão de refresh manual + fechar temporariamente.
- **Secret necessário no GitHub**: `EVOLUTION_ALERT_URL` (URL completa: `/api/alerts/evolution-cron?secret=CRON_SECRET`).

## Relatórios automáticos mensais

- **Cron via GitHub Actions** (`.github/workflows/reports-cron-monthly.yml`), não Vercel — roda **todo dia** às 11h UTC (08h BRT) e chama `GET /api/reports/cron-monthly?secret=...`.
- **Motivo de não estar no `vercel.json`**: a rota filtra por `report_configs.send_day` (dia do mês configurável por cliente, ex: "Dia 1", "Dia 23"). O Vercel Hobby só permite 1x/dia por cron job, então um cron `"0 8 1 * *"` (só dia 1) nunca processava clientes com `send_day` diferente de 1 — por isso a tabela de Relatórios mostrava `RELATÓRIOS: 0` e `ENVIO: –` para quase todo mundo. Removido do `vercel.json` em 2026-07-01 e migrado para GitHub Actions (mesmo padrão do Otimizador/Leadlovers) para rodar diariamente sem custo extra e sem depender do cron-job.org externo (reservado para outra finalidade).
- **Secret necessário no GitHub**: `REPORTS_CRON_URL` (repo Settings → Secrets → Actions) — URL completa incluindo `?secret=CRON_SECRET`, mesmo padrão de `OPTIMIZER_WEEKLY_URL` e `LEADLOVERS_WORKER_URL`.
- A rota `src/app/api/reports/cron-monthly/route.ts` já filtra corretamente por `send_day = EXTRACT(DAY FROM NOW())` — só faltava ser chamada todo dia em vez de só no dia 1.

### Slide "Todos os conteúdos" + personalização de páginas (2026-07-16)

- **Slide novo `sInstagramTodosConteudos`** (`delivery-report-builder.ts`): detalhamento post a post de TODOS os posts do período (mesma linguagem visual do "Top conteúdos": badge de formato, thumb, 6 pills de métrica — Alcance/Curtidas/Coment./Salvos/Interações/Engaj.%). Cards compactos 2 col × 3 linhas, **6 posts por slide** (`TODOS_CONTEUDOS_POR_PAGINA`), paginado ("página X de Y"), ordem cronológica (`ordenarPostsPorData`). Grid usa `grid-template-rows:repeat(3,1fr)` fixo — página parcial (ex: 1 post) mantém a proporção do card em vez de esticar. Ordem do bloco Instagram nos 3 templates (pedida pelo Matheus): `sInstagram` → **calendário** → **todos os conteúdos** → top conteúdos → melhor conteúdo.
- **Personalização de páginas na geração**: catálogo em `src/lib/report-sections.ts` (`REPORT_SECTIONS` por template + `sectionEnabled`). Os 3 builders aceitam `sections?: string[] | null` (null = todas, comportamento antigo) e cada flag `has*` virou `dados && en('key')` — o `total` da paginação se ajusta sozinho. A capa nunca é selecionável. Marcado ≠ garantido: página sem dados continua oculta (data-driven como sempre).
- **UI**: modal "Gerar Relatório" ganhou bloco colapsável "Personalizar páginas" (checkboxes 2 colunas com label+descrição, badge "N oculta(s)", link "Marcar todas"; reset ao trocar template/abrir modal). O payload só inclui `sections` se o usuário desmarcou algo. `run-once/route.ts` valida (`Array.isArray` + só strings) e repassa aos 3 builders. Automações (`run/[configId]`) NÃO passam sections — relatório automático continua completo, de propósito.
- ⚠️ O gating separa flags de dados das de seção: `hasDestaques` (meta_campanhas) depende de `meta !== null`, NÃO de `hasMeta` (que agora carrega `en('meta_resumo')`) — desmarcar o resumo não pode derrubar as campanhas. Mesma lógica no Google.
- ✅ Verificado no preview: slide renderizado com 7 posts mock via bundle esbuild (página cheia + página parcial, screenshots ok) e modal com checkboxes funcionando (desmarcar → badge "1 oculta" → Marcar todas). Relatório real com dados de produção não foi gerado.

### Slide "Top palavras-chave" (Google Ads)

- O relatório de performance (`buildOmniReport` em `src/lib/report-builder.ts`) monta os slides de Google a partir de `fetchGoogleAdsDetailed`, que agora traz também `palavrasChave: PalavraChaveGoogle[]` (tipo em `delivery-report-builder.ts`).
- **Fonte**: GAQL `keyword_view` (palavras-chave compradas, não `search_term_view`). `segments.date` só no `WHERE` para agregar o período; agregação por `texto+match_type` no código (a mesma keyword aparece em vários grupos). Top 10 ordenado por **conversões** (desempate: cliques → investimento).
- **Slide** `sGoogleAdsPalavrasChave` (tabela: palavra-chave + badge de correspondência, impressões, cliques, **CPC**, **conversões**, custo/conv.) renderizado após `sGoogleAdsCampanhas`. Só aparece se `googleDetailed.palavrasChave.length > 0` (contas só-PMax/Display/Shopping não têm keyword → slide some sem quebrar).
- ⚠️ Não verificável no preview local (sem DB/OAuth Google) — validar com cliente Google de Pesquisa real.

---

## Monitor de Redes Sociais (2026-07-18)

Aba dentro do Radar (`/resultados/redes-sociais`, tab-nav "Radar | Redes Sociais" via `src/components/results-tabs.tsx`) que lista TODOS os clientes com **dias sem post no Instagram** (régua de alerta configurável por cliente) + insights (seguidores, posts 30d, alcance 28d, engajamento médio/post). Padrão "sala de guerra": cron diário grava snapshot no banco; a tela lê tudo numa query só.

| Arquivo | Papel |
|---|---|
| `src/lib/instagram-monitor.ts` | Lib canônica de resolução cliente→conta IG (`getIgAccount`/`resolvePageIdFromAds`/`pageToIgResult`, movidas do ig-posts + suporte a link direto `platform='instagram'` via `directIgId`) + `ensureSocialMonitorSchema` (tabela `social_monitor_snapshots`, 1 linha por cliente) + `fetchClientSnapshot` (nunca lança; erro vira campo `error`) + `upsertSnapshot` (NÃO toca `red_after_days`) |
| `src/app/api/meta/ig-posts/route.ts` | Refatorado para importar a resolução da lib (zero mudança de comportamento; `followers_count` extra no fields) |
| `src/app/api/social-monitor/route.ts` | GET (snapshots + lastRunAt; join com nome/categoria é client-side via `useClients`) e PATCH `{clientId, redAfterDays}` (1–90; INSERT ON CONFLICT — funciona antes da 1ª coleta) |
| `src/app/api/social-monitor/refresh/route.ts` | GET secret-guarded (cron, todos os ativos) + POST `{clientIds?}` (UI, 1 ou todos). `maxDuration=300`, deadline 280s, concorrência 4, dedupe por chave `connId\|accountId\|directIgId` (clientes que compartilham conta não repetem chamadas Graph), token renovado 1x por conexão |
| `src/app/(dashboard)/resultados/redes-sociais/page.tsx` | Tela: cards de resumo, filtros (busca/severidade/categoria/sort), lista com badge de dias sem post, input inline da régua (PATCH no blur), thumb do último post, refresh por linha, empty state "Rodar primeira coleta" |
| `.github/workflows/social-monitor-daily.yml` | Cron diário `0 9 * * *` (06h BRT) + `workflow_dispatch` |

- **Severidade** (calculada na UI de `last_post_at` × `red_after_days` da linha): vermelho ≥ `red_after_days` (default **2**), amarelo = 1 dia antes do vermelho, verde abaixo; cinza = sem conta IG/erro/nunca coletado (linha nunca some — clientes ativos sem snapshot aparecem como "Nunca coletado"). Default pedido pelo Matheus: 1 dia sem post = amarelo, 2+ = vermelho.
- **Ocultar cliente do monitor** (`monitored BOOLEAN DEFAULT TRUE` na mesma tabela): cliente só de tráfego pago (postagem não é da agência) sai da lista, dos cards E do cron/"atualizar todos" (não gasta chamada Graph; refresh explícito por `clientIds` ignora o filtro). Botão de olho por linha; chip "Ocultos (N)" nos filtros alterna pra visão de ocultos com botão de reativar. PATCH aceita `monitored` além de `redAfterDays` (cada um em upsert próprio — um não sobrescreve o outro).
- **Aviso diário no WhatsApp via Z-API** (`src/lib/social-monitor-alert.ts` + `api/social-monitor/alert-config/route.ts`): depois da coleta do cron (GET do refresh), envia no grupo configurado as contas **visíveis** (monitored=TRUE, ocultas nunca entram) com ≥ `minDays` dias sem post (default 2) + insights de cada uma. Config no botão "Aviso WhatsApp" da própria tela (modal: toggle ativo, instância de `zapi_clients` provider≠evolution, grupo via `GET /api/disparos/extract/chats?type=groups` com picker+busca, minDays, "Salvar e enviar teste"). Guardada em `system_settings` (chaves `social_alert_*`, padrão otimizador). Envio via `sendText` de `@/lib/zapi` (creds `instance_id`/`token`/`security_token`); best-effort no cron (falha de WhatsApp não derruba o cron); sem ofensores = não envia (teste manual envia "tudo em dia" pra validar o canal).
- **Custo por cliente**: ~3 chamadas Graph (resolução de página, `{ig_id}/media?since=30d&limit=50`, `{ig_id}/insights?metric=reach&period=day` 28d). Se 0 posts em 30d, busca `media?limit=1` sem `since` para achar o último post histórico. Cortados da v1 (existem no delivery-report-builder p/ drill-down): insights por post, profile_views, website_clicks, accounts_engaged.
- **Permissão**: herda a flag `radar` pelo match por prefixo do auth-guard — nenhuma flag nova criada.
- **Secret necessário no GitHub**: `SOCIAL_MONITOR_URL` (URL completa `/api/social-monitor/refresh?secret=CRON_SECRET`, mesmo padrão dos demais).
- ⚠️ Não verificável no preview local (sem DATABASE_URL) — UI validada com `window.fetch` mockado (faixas/régua/filtros/refresh, screenshots ok) e `tsc` limpo; rota real retornou 500 gracioso sem DB. Validar em produção: refresh de 1 cliente, "Atualizar todos" com a carteira (medir `tookMs`), `workflow_dispatch` manual.

---

## CRM — Fase A de correções (2026-07-16)

Auditoria completa do CRM (4 varreduras paralelas: núcleo, chat, instâncias, auxiliares+acesso) encontrou 8 P0; Fase A corrigiu todos os aplicáveis. **Regra de arquitetura: instância de CRM de cliente é SEMPRE Evolution; Z-API é só uso interno da agência** — gaps Z-API (webhook manual, sem alerta proativo, mídia→texto) são baixa prioridade por decisão do Matheus.

| Correção | Onde |
|---|---|
| **Cron do follow-up worker** (worker existia, nada o chamava — follow-up com delay/sequência/expiração só saía pelo botão manual) | `.github/workflows/crm-followup-worker.yml` (`*/5 10-23 * * *` = 07h-20h BRT; secret GitHub `CRM_FOLLOWUP_URL` = URL completa com `?secret=CRON_SECRET`) |
| **Mídia recebida renderiza** (antes só áudio era baixado; foto/vídeo/doc viravam texto "[Imagem]") | webhook `[instanceId]`: `mediaKind` audio/imagem/video/documento (sticker→imagem), caption vira 2ª mensagem `external_id:caption` +1s; `maxDuration=60` na rota; `extFromMimetype` ganhou pdf/docx/xlsx/webp/zip |
| **Rename/delete de etapa migra leads** (status é TEXTO; antes renomear coluna orfanava leads → sumiam do Kanban) | `crm/stages/[id]/route.ts` PUT/DELETE reescritos: UPDATE `crm_leads.status` antigo→novo no funil; delete move pra primeira etapa restante |
| **PUT de lead restrito ao id** (match extra por telefone cascateava edição/drag pra leads homônimos de OUTROS funis) | `crm/[id]/route.ts` — WHERE client_id+id apenas |
| **Lead manual não some mais** (filtro `numero ~ '^[0-9]{10,15}$'` cru escondia número formatado/vazio) | `crm/route.ts`: POST normaliza número (só dígitos→NULL se vazio); GET aceita sem número OU normalizado 8-15 dígitos |
| **Não-lidas de verdade** (era COUNT(*) histórico de 'in', nunca zerava) | coluna `crm_leads.chat_read_at` (ensureCrmConversationSchema); GET de messages marca lido (conversa na tela); inbox conta só `created_at > chat_read_at` |
| **Luna lê o CRM** (query usava colunas inexistentes name/phone/email → falha silenciosa desde sempre) | `agent/chat/route.ts` get_crm_data: `nome AS name, numero AS phone, email, origin, campaign_name, regiao_uf` + fallback sem colunas de rastreio |
| **Webhook canônico** (URL usava origin da request — acesso via preview/localhost re-apontava o webhook e matava o inbound) | `webhookOrigin()` em `evolution-api.ts` (env `APP_URL` ou `NEXT_PUBLIC_APP_URL`, fallback origin) aplicado nos 6 call sites de `setEvolutionWebhook`/`linkInstanceToClient`. **Configurar `APP_URL=https://reports.onmid.app` na Vercel** |
| **IA que muda status dispara conversões** (antes só o PUT manual chamava dispararEventosPorStatus — gap de atribuição) | `crm-ai-analysis.ts` após mover status: busca ctwa/valor e chama `dispararEventosPorStatus` (dedup interno evita duplicado) |

Pendências conhecidas (Fases B/C futuras): rotas do CRM sem validação server-side (34 rotas — por isso o acesso do cliente é via portal por token, NUNCA login Visualizador); escala (DDL+full-scan de `ensureCrmMessagesSchema` em todo GET/poll de 8s, GET de leads sem paginação, pool novo por request); limite diário de IA é só aviso; código morto (`crm_contacts`+rotas, `ClientCrmTab` nunca montado, `crm/tags/[id]/assign`, branch `?since=`); polling 5s/8s e conversas >3d sem poll.

### Fase D: Portal read-only do cliente (2026-07-16)

Link público por token pro cliente final acompanhar o próprio funil — padrão `/relatorio/[token]` (a decisão de NÃO dar login no app vem da auditoria: permissão é só client-side).

| Arquivo | Papel |
|---|---|
| `src/lib/crm-portal.ts` | `crm_portal_tokens` (token→client_id, enabled, last_access_at), `getOrCreatePortalToken` (reusa ativo), `revokePortalTokens` (mata todos), `resolvePortalToken` (marca last_access) |
| `src/app/api/portal/[token]/route.ts` | GET público: KPIs (total/fechados/valor/% com origem), funil (etapas×contagem, agrupado por label como o Kanban), leads (300, `?days=`) — **sem `observacao`, sem `time_interno`**, SELECT-only |
| `src/app/api/portal/[token]/messages/[leadId]/route.ts` | Conversa read-only; lead precisa pertencer ao client_id do token (404 senão) |
| `src/app/api/clients/[id]/portal/route.ts` | Interno: GET (token atual+last_access), POST (gera/retorna), DELETE (revoga) |
| `src/app/portal/[token]/page.tsx` | Página pública dark ONMID, mobile-first: KPIs, funil em barras, cards de lead (status/origem/fechado+valor/região/campanha), conversa fullscreen somente-leitura |
| `crm/portal-link-modal.tsx` + botão "Portal do cliente" em `crm/page.tsx` (ao lado de "Editar funil") | Gerar/copiar/“ver como o cliente”/revogar; mostra último acesso |

- ✅ Verificado no preview com fetch mockado (desktop+mobile: KPIs, funil, badges, conversa read-only). SQL real exige produção.
- ⚠️ Nota: ao testar navegação SPA pra rota nova no dev, o mock de `window.fetch` se perde (Next faz MPA navigation em rota fora do router cache) — reinjetar após a página carregar.

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

## Otimizador de Campanhas v2.0

Módulo de análise automática de performance — arquivos principais:

| Arquivo | Papel |
|---|---|
| `src/lib/optimizer.ts` | Tipos v1+v2, payload builder, Camada 1, system prompts, `buildRecomendacoes`, `pareceMultiAcao` |
| `src/lib/optimizer-whatsapp.ts` | Envio do relatório de análise via Evolution API (fire-and-forget) |
| `src/app/api/otimizador/analisar/route.ts` | POST análise (v1 Camada 1→IA / v2 semanal), PATCH log |
| `src/app/api/otimizador/fila/route.ts` | GET fila global de decisões — cada análise em try/catch isolado (falha em uma não derruba fila toda) |
| `src/app/api/otimizador/weekly/route.ts` | Cron semanal Mon-Fri com rodízio por `analise_dia_semana` |
| `src/app/api/otimizador/executar/route.ts` | POST execução de ação automática na Meta API |
| `src/app/api/otimizador/config/[clientId]/route.ts` | GET/POST config por cliente (modo, dia rodízio, limites) |
| `src/app/api/otimizador/whatsapp-config/route.ts` | GET/POST config global de WhatsApp do otimizador |
| `src/app/api/otimizador/whatsapp-groups/route.ts` | GET grupos Evolution disponíveis |
| `src/app/(dashboard)/otimizador/page.tsx` | UI — **orquestrador fino** (estado + fetch/polling + handlers); ~470 linhas (era 1.950). Toda a UI vive em `src/components/otimizador/*` |
| `src/lib/optimizer-ui.ts` | Camada de UI compartilhada — tipos de tela, constantes (SEV/CATEGORIA_META/NÍVEL/ESTADO) e helpers PUROS (`categoriaDoNode`, `computeAccountScore`, `agruparPorObjetivo`, `resumoDoObjetivo`, `deliveryDisplay`, `parseNumeroBR`…). Sem JSX |
| `src/components/otimizador/*` | `account-rail`, `account-health-hero`, `decision-strip`, `campaign-tree`, `decision-panel`, `config-modal`, `creative-thumb`, `confirm-toast`, `objective-highlight-card`, `briefing-card`, `benchmarks-modal` |
| `src/app/(dashboard)/otimizador/visao-geral/page.tsx` | **Sala de guerra** — visão de supervisão: todas as contas agrupadas por urgência (Precisa de você agora / De olho / Tudo certo), ordenadas por gasto/pendências. Reusa `/api/otimizador/fila`. Botões "Começar briefing" e "Benchmarks" (admin) |
| `src/app/(dashboard)/otimizador/briefing/page.tsx` | **Briefing do dia** — co-piloto: uma decisão por vez (reusa `/api/otimizador/fila`), aplicar→`executar` / não fazer→`ignorar` / pular avançam a fila. Escopo opcional por `?clientId=` |
| `src/app/(dashboard)/otimizador/apresentacao/page.tsx` | Modo apresentação — visão read-only, limpa (hero + cards por objetivo + ganhos/alertas), reusa `/api/otimizador/arvore` (zero backend novo). Link "Apresentação" na tela principal |
| `src/lib/optimizer-benchmarks.ts` | Benchmarks de custo por nicho (custo-alvo/teto por lead-conversa) — defaults do arquivo + override do banco (`loadNicheBenchmarks`). Régua usada só quando o cliente NÃO tem meta cadastrada |
| `src/app/api/otimizador/benchmarks/route.ts` | GET/POST dos benchmarks por nicho (upsert em `optimizer_niche_benchmarks`) |
| `src/app/(dashboard)/configuracoes/page.tsx` | Aba "Otimizador" — config WhatsApp global (admin) |

### Decisões arquiteturais da reforma de UI (2026-07)

- **Rebuild por componentes.** `page.tsx` (era um monólito de 1.950 linhas) virou orquestrador; toda a UI foi extraída pra `src/components/otimizador/*` e os helpers puros pra `src/lib/optimizer-ui.ts`. A lógica de dados/rotas (`buildCampaignTree`/`buildRecomendacoes`/`objetivoInfo` no servidor) NÃO mudou — foi refatoração de apresentação.
- **`AccountRail`** substitui o dropdown de conta: chips sempre visíveis com dot de saúde + busca + scroll → troca instantânea (dor "trocar de cliente na Meta/Google é lento").
- **Colunas por objetivo com UNIÃO entre nós** (`rotulosDoGrupo`): antes o cabeçalho quebrava quando o 1º nó vinha sem métrica. Accordion dos objetivos persiste em `localStorage`. `CreativeThumb` cai pro placeholder no `onError` (URLs da Meta expiram).
- **Modo apresentação** (`/otimizador/apresentacao?clientId=`): read-only, sem botões/jargão, pra reunião/PDF. Usa `useSearchParams` dentro de `<Suspense>`.
- **Conceito "pré-gestor de tráfego" (3 espaços + 2 personas).** O Otimizador vira uma ferramenta que eleva qualquer gestor: (1) **Sala de guerra** (`/otimizador/visao-geral`, supervisão — todas as contas por urgência), (2) **Conta + boards por objetivo** (`/otimizador`, operação), (3) **Briefing do dia** (`/otimizador/briefing`, co-piloto guiado decisão a decisão). Personas: dono (supervisão) + gestor (operação). Escopo travado com o Matheus: o otimizador foca em TRÁFEGO com os dados que tem; feedback do cliente/venda é decisão HUMANA, não entra como input que condiciona a IA. Motor (busca/IA/execução) reaproveitado — foi reforma de experiência + cérebro, não do motor.
- **Cérebro: benchmarks por nicho + sinais Google.** Quando o cliente NÃO tem meta cadastrada, a régua de custo cai no benchmark do nicho (`src/lib/optimizer-benchmarks.ts`; meta do cliente sempre tem prioridade; injeta observação honesta de que é estimativa de mercado). Editável pela tela (BenchmarksModal → `optimizer_niche_benchmarks`), com fallback nos defaults do arquivo. `weekly` carrega os benchmarks 1x e passa aos construtores Meta+Google. Sinais próprios do Google (parcela de impressões perdida por orçamento = escalar; impression share baixa = ganhar presença) injetados como contexto no payload Google.
- **Bug de round-trip da config corrigido.** Havia 3 vocabulários divergentes pras ações pré-aprovadas; o único que a auto-execução aceita (`sanitizeOptimizerOutputV2`) é `pausar` | `ativar` | `ajustar_orcamento_reduzir` — a UI (`ACOES_PRE_APROVADAS_OPCOES`) e a rota `config/[clientId]` (`ACOES_VALIDAS`) foram alinhadas a ele. Orçamento máximo: a UI usava `orcamento_diario_maximo_conta`, a rota/DB usam `orcamento_diario_maximo` → renomeado na UI. Antes, orçamento e ações pré-aprovadas NUNCA salvavam. Config de autonomia por cliente (4 modos + ações pré-aprovadas + limites) agora faz round-trip completo.
- **Google Ads na análise (aditivo — Meta intocado).** `weekly/route.ts` ganhou `loadGoogleConnections` (`client_account_links` platform `google_ads` → `google_connections`), `resolveGoogleToken`, `fetchGoogleAdGroups` (GAQL `ad_group`+`ad_group_ad`, `segments.date` só no WHERE pra agregar) e `buildGooglePayloadForClient` (mesmo shape `OptimizerPayloadV2`; Google sem retenção de vídeo/imagem → `eh_video=false`, taxas/`imagem_url` null). `processClient` roda análise Google SEPARADA após a Meta. `analisar/route.ts` ganhou `canal?: 'meta'|'google'` (+`login_customer_id`): `saveLogV2` grava `conta_plataforma='google_ads'` e `processAutoActions` executa via Google. O objetivo Google já cai nos boards certos (`normalizeGoogleChannelType` → `objetivoInfo`). **Conta MISTA Meta+Google:** `arvore/route.ts` aceita `?canal=meta|google` (filtra por `conta_plataforma`) e devolve `canais` (quais têm análise recente); a UI (`page.tsx`) mostra um toggle Meta/Google só quando há os dois e recarrega a árvore no canal escolhido. Cliente só-Google e cliente misto já funcionam ponta a ponta. ⚠️ Não verificável no preview local (sem DB/OAuth Google) — validar com cliente Google real via `?dryRun=1`→`?forceAi=1`.

### Decisões arquiteturais do Otimizador v2

- **Análise manual é assíncrona (anti-504)** — o botão "Analisar esta conta" faz `POST /api/otimizador/weekly?...&async=1`, que agenda o trabalho com `after()` (de `next/server`) e responde **202 na hora**. A análise (busca de dados + IA) roda em segundo plano dentro do `maxDuration=60`; o resultado é gravado em `optimizer_ai_logs` pela rota `analisar`. A UI faz **polling** em `GET /api/otimizador/analisar?clientId=X&hours=1` até aparecer um resultado mais novo que o anterior (compara `created_at` do servidor — imune a clock skew). Antes era um request síncrono que somava busca (até 24s) + chamada IA aninhada (15-30s) e estourava o limite do Vercel → 504 com corpo vazio. O cron (GET) continua síncrono. Helpers no route: `parseRunOptions` → `executeWeekly(opts)` (retorna objeto puro) → `startInBackground(opts)`.
- **Uma análise por cliente por semana** — cadência semanal, não por campanha/dia. Custo ~$0.043/análise × 50 clientes/semana = ~$9/mês.
- **Rodízio por dia útil** — `analise_dia_semana` (1=Seg...5=Sex) em `optimizer_client_config`. O cron `weekly/route.ts` filtra `WHERE analise_dia_semana = EXTRACT(DOW FROM NOW())`. Auto-atribuição ao dia menos carregado no config POST.
- **4 modos de operação por cliente**: `DIAGNOSTICO_APENAS` | `RECOMENDACAO_COM_APROVACAO` | `AUTOMATICO_PARCIAL` | `AUTOMATICO_TOTAL`. Controlam se ações são sugeridas ou executadas automaticamente.
- **`acoes_automaticas`** no output v2: status `EXECUTAR_AGORA` (auto-mode) ou `AGUARDAR_APROVACAO` (manual). Máximo 2 ações auto por ciclo. `sanitizeOptimizerOutputV2` downgrade para AGUARDAR_APROVACAO se modo não permite.
- **Proteção de aprendizado**: `executar/route.ts` recusa PAUSAR se `dias_ativo < min_dias_aprendizado` (default 7). Retorna 422 com `bloqueado: true`.
- **Resolução de token no executar**: tenta connection_id → fallback primeiro ativo em `meta_connections` → fallback `meta_integration` global. Permite aprovação manual sem connection_id explícito.
- **WhatsApp pós-análise**: Evolution API (não Z-API). Instância + JID de grupo configurados em Configurações > Otimizador. Relatório enviado fire-and-forget via `sendOptimizerReport()` em `optimizer-whatsapp.ts`.
- **DB para v2**: `conjunto_id` = `cliente_id` (análise da conta inteira). `semana_analise` = `"2026-W26"`. `estado_da_conta` = `SAUDAVEL | ATENCAO | CRISE`. `resumo_executivo` = texto 3-5 frases.
- **GET /analisar**: lookback 200h (8 dias) para capturar análises semanais. Retorna `semana_analise`, `modo_operacao`, `estado_da_conta`, `resumo_executivo` além das colunas v1.
- **UI detecta v2**: `isV2Result()` checa presença de `estado_da_conta` no resultado. v2 renderiza `V2DetailPanel`; v1 renderiza `V1DetailPanel` (backward compat).
- **Fila de decisão (`/api/otimizador/fila`)**: rota separada da `/analisar`. Cada análise é montada em try/catch próprio — uma análise com dado corrompido (ex: `motivos=undefined` em registros antigos) some da fila com log de aviso, nunca derruba a fila global. `buildRecomendacoes` usa `Array.isArray(o.motivos)` antes de acessar `.length` (bug que zerава a fila global foi corrigido em 24c8a85).
- **Bússola por campanha, não por conta** (prompt v2.9): o PASSO 1 manda julgar cada campanha pelo SEU próprio `objetivo` — o bloco `metas` (planejamento mensal) fornece apenas cpl_ideal/cpl_maximo (vale para formulário E conversa iniciada), volume e orçamento. `objetivo_principal`/`ticket_medio` são contexto de negócio: é PROIBIDO à IA apontar "campanha rastreia conversas mas objetivo da conta é vendas" como problema (era a alucinação clássica — cliente com meta de faturamento capta via leads/conversas; o fechamento acontece fora do anúncio). Ordem de análise explícita no prompt: criativo → conjunto → campanha.
- **Tráfego mede-se por CLIQUE, não por conversão (bug Cão Véio, 2026-07-14)**: campanha de tráfego (`OUTCOME_TRAFFIC`) mostrava "Custo por clique R$351,48" = gasto ÷ 2 conversas incidentais (`countMetaResults`), quando o real é R$0,28 = gasto ÷ 2.674 cliques. Os rótulos já eram corretos (`objetivoInfo` → "Cliques"/"Custo por clique"), mas os VALORES vinham de `conversoes`/`cpl`. Correção: (1) `objetivoMedidoPorClique(objetivo)` (exportado de `optimizer.ts`) é a fonte única do eixo de medição — true p/ tráfego; (2) tipos `OptimizerAdV2`/`OptimizerAdsetV2` ganharam `cliques?`/`cpc?` (campanha já tinha `cliques`; ganhou `cpc?`), as três `OptimizerAnalise*` ganharam `cliques`/`cpc` (obrigatórios, populados em `buildAnaliseCampanhas`); (3) `weekly/route.ts` preenche `cliques` em adset/ad (Meta+Google) e passa cada campanha por `comMetricaDeClique()` — que, p/ objetivos de clique, **zera o `cpl` enganoso e injeta `cpc = gasto/cliques`** em TODA a subárvore ANTES de mandar pra IA (payload honesto = some o gatilho da alucinação "objetivo VENDAS/CRISE") e de montar a árvore; (4) as DUAS montagens de árvore (`buildRecomendacoes` + a `arvore` interna) exibem `cliques`/`cpc` p/ objetivos de clique via `resDe`/`custoDe`; (5) `sanitizeOptimizerOutputV2` agora agrega o hero/`cruzamento_com_metas` só das campanhas de lead/conversa (tráfego fora da régua de CPL, senão o volume de cliques mascara o CPL real das de conversão) — conta 100% tráfego mostra cliques + CPC e `status_cpl=NAO_APLICAVEL`. ⚠️ Não verificável no preview (sem DB/OAuth) — validado por teste de unidade transpilado (payload Cão Véio → card "Cliques 2.674 · Custo por clique R$0,26"). Regressão de conta MISTA lead+tráfego coberta: CPL agora soma só conversão.
- **Saúde da conta = ENTREGA ATIVA; estado da conta é DETERMINÍSTICO (bug Cão Véio parte 2, 2026-07-14)**: mesmo com as métricas certas, a conta de tráfego (CPC −93% abaixo da meta) aparecia como "crítica" porque a IA marcava 5 criativos PAUSADOS (gasto R$0, sazonais) como URGENTE — o pior nó pintava o grupo de "Crítico", subia "Prioridade/Risco alto" e a IA punha `estado_da_conta=ATENCAO/CRISE`. Correção em `optimizer.ts`: (1) `capSeveridadePausado()` rebaixa QUALQUER objeto pausado/arquivado (`status_entrega` fora de ACTIVE/ENABLED/IN_PROCESS/WITH_ISSUES) para `SAUDAVEL` em `buildAnaliseCampanhas` — pausado não gasta, logo não é urgência; housekeeping (arquivar sazonal) sai da fila pela trava `ehOportunidade` (SAUDÁVEL só entra na fila se carregar ATIVAR/AJUSTAR_ORCAMENTO, então "reativar bom pausado" sobrevive). (2) `estado_da_conta` deixou de ser ecoado da IA (`estadoIa` vira `void`) e passou a ser DERIVADO em `sanitizeOptimizerOutputV2`: pior severidade da árvore (pausados já em SAUDÁVEL) cruzada com `status_cpl`/`status_volume` → CRISE se algo ativo é URGENTE ou régua CRITICO; ATENCAO se ativo em ATENCAO ou volume ABAIXO; senão SAUDÁVEL. Assim o estado bate com a árvore visível (mesma filosofia do `status_cpl` "sempre calculado aqui"). (3) `cpcDe()` em `buildAnaliseCampanhas` calcula `cpc=gasto/cliques` como fallback quando o payload não passou por `comMetricaDeClique` (display robusto). (4) prompt ganhou bloco "SAUDE DA CONTA = ENTREGA ATIVA": pausado=housekeeping=SAUDÁVEL, campanha ativa dentro/abaixo da meta é SAUDÁVEL (não rebaixar só pra sugerir teste de criativo). ⚠️ Não verificável no preview — validado por teste transpilado (`scratchpad/test-cao-veio.js`): payload Cão Véio (campanha tráfego SAUDÁVEL + criativo pausado URGENTE) → `estado_da_conta=SAUDAVEL`, ad pausado rebaixado, hero 3164/R$0,22, ad fora da fila; com campanha ativa=ATENCAO → estado=ATENCAO (não esconde problema ativo real).
- **Panorama multi-janela 30/14/7/3 dias (2026-07-18)**: analisar uma janela única "emburrecia" a decisão (pausava campanha com turbulência de 7d que performou o mês; não via recuperação recente). Toda análise agora envia, POR NÓ (campanha/conjunto/criativo), o bloco aditivo `janelas {d30,d14,d7,d3}` (gasto/conversoes/cpl/cliques/cpc/ctr; datas uma vez na raiz em `janelas_referencia`) + `tendencia` DETERMINÍSTICA (`RECUPERANDO|PIORANDO|ESTAVEL|DADO_INSUFICIENTE`, custo d3 vs d30 no eixo do objetivo, gasto <R$1 = dado insuficiente) calculada em `src/lib/optimizer-windows.ts` (lógica pura: ranges, `buildMetaWindowFields` com aliasing `.as(ins_dX)`, `parseMetaWindowInsights`, `aggregateGoogleDailyRows`, `janelasComMetricaDeClique`, `calcularTendencia`). Coleta SEM 4× chamadas: Meta = aliases extras nas MESMAS chamadas `/adsets` e `/ads` (fallback 1× sem aliases se der 400) + 1 batch `?ids=` pro nível campanha; Google = seleção top-N inalterada + queries diárias (`segments.date` no SELECT, sem LIMIT, filtradas por `IN (ids)`) agregadas em código. A janela primária (`?period=`) continua nos campos de topo/hero/réguas — backward compat total; `sanitizeOptimizerOutputV2` inalterado; `buildAnaliseCampanhas` copia `janelas`/`tendencia` do payload (UI futura; badge visual adiado de propósito — decisão do Matheus, só a IA usa por ora). Regra Cão Véio vale DENTRO das janelas (`janelasComMetricaDeClique` zera cpl e injeta cpc em tráfego). Prompt `otimizador-v3.1`: PASSO 3.6 "leia o filme, não a foto" (recuperação/turbulência/deterioração consistente, anti-alucinação: só números existentes, janelas se sobrepõem, DADO_INSUFICIENTE → julgar só pela primária). Output da IA inalterado (sem risco novo de truncamento); cache invalida sozinho via payload_hash. ⚠️ Validado por teste transpilado (54 asserts, `scratchpad/test-janelas.js`); Graph/GAQL reais exigem produção — validar com análise manual e conferir `janelas` no `resultado` salvo.
- **WhatsApp ≠ engajamento**: campanhas de conversa na Meta vêm como `OUTCOME_ENGAGEMENT` com adsets otimizando `CONVERSATIONS`. `objetivoEfetivoCampanha()` em `optimizer.ts` reclassifica para `CONVERSAS_WHATSAPP` na árvore (rótulos determinísticos: "Conversas", "Custo por conversa") e o prompt instrui a IA a tratar como campanha de conversas. Análises antigas no banco mantêm o rótulo velho até a próxima análise.
- **Hierarquia por nome no card**: `OptimizerRecomendacao.conjunto_nome` + linha de identificação no `DecisionCard` (badge do nível + objetivo + "Campanha › Conjunto › Criativo") — o gestor identifica o objeto sem abrir o Gerenciador.
- **Granularidade 1-nó-1-ação** (prompt V2.8+): regra no PASSO 3.4 — 1 nó = 1 objeto = 1 ação. Múltiplos objetos geram nós separados com `depende_de`. Trava de código `pareceMultiAcao` (detecta 2+ verbos de ação no texto) força `confianca_item="baixa"` + `acao_tipo=VERIFICAR_MANUAL` mesmo se IA ignorar a regra.
- **Campo `motivos: string[]`**: cada nó tem 2-4 tópicos já interpretados (fato + comparação, ex: "Custava R$9,20 — meta é R$20"). Fallback determinístico a partir de `fatos` para análises antigas sem o campo.
- **`DecisionCard` (UI)**: mostra 1 card por vez (a próxima decisão da fila). Título como pergunta direta, motivos como lista de tópicos. Botões dinâmicos: "Reativar/Pausar/Ajustar agora" + "Não fazer nada". Rodapé mostra quantas decisões restam para a mesma campanha.
- **Cron**: GitHub Actions `0 10 * * 1-5` é o primário. Vercel cron como backup (Hobby só 1x/dia, mas horário coincide).

### Decisões arquiteturais do Otimizador v1 (ainda em uso para backward compat)

- **`objetivo_campanha`** é o campo mais crítico do payload. CPL só é avaliado em `leads` ou `vendas`.
- **Meta**: objetivo via `normalizeMetaObjective()` em `campaigns/route.ts`. **Google**: via `normalizeGoogleChannelType()`.
- **Campanhas pausadas são ignoradas** no daily route — filtro `['ACTIVE','ENABLED','IN_PROCESS','WITH_ISSUES']`.
- **Tom do prompt**: imperativo e direto, como gestor falando com gestor.
- **Camada 1** (regras sem IA): CPL crítico e aprendizado só disparam para `isLeadsOrSales`.
- **Cache v1**: Hash do payload + drift < 5%. Limite 10 chamadas IA/cliente/dia.
- **IS metrics (Google)**: apenas `FROM campaign` no GAQL — nunca misturar com `segments.date` no `FROM customer`.
- **MCC map**: `buildMccMap` cacheado por `connectionId` com TTL de 4h em `api-cache.ts`.

---

## Rastreio de Leads — Fase 1: fundação de captura (2026-07-15)

Objetivo do módulo (4 fases): saber de TODO lead o canal, campanha, conjunto, criativo, posicionamento, palavra-chave e região — em tempo real e permanente (só some se o lead for deletado), para alimentar relatórios/análises de campanha com IA. Fase 1 entregue; Fases 2 (formulários: Meta Lead Ads nativo + landing + terceiros), 3 (demografia agregada por campanha + UI rica lendo `crm_leads`/eventos em vez da legada `whatsapp_leads`) e 4 (Google offline conversions com o gclid capturado + conserto do GA4 client_id + unificação do CAPI Meta duplicado) pendentes.

| Arquivo | Papel |
|---|---|
| `src/lib/lead-tracking.ts` | Núcleo: schema (ALTERs + `lead_tracking_events`), `generateClickCode`/`extractClickCode`, `extractTrackingFromText` (fallback URL no texto), `matchClickByCode`, `mergeTracking`, `applyLeadAttribution`, `linkClickToLead`, `recordTrackingEvent`, `geoFromHeaders` |
| `src/lib/ddd-regioes.ts` | Mapa estático DDD→UF/região + `regiaoFromPhone` (sem API externa) |
| `src/app/r/[slug]/route.ts` | Captura completa no clique: utm_*, gclid/wbraid/gbraid/fbclid/ttclid/msclkid, ValueTrack (keyword/matchtype/device/network/placement/loc), geo via headers `x-vercel-ip-*`, params desconhecidos em `extra_params` JSONB; gera `click_code` |
| `src/app/api/webhook/whatsapp/[instanceId]/route.ts` | Casa `Cód: XXXXXX` com o clique, herda atribuição server-side, deriva região (IP do clique > DDD), grava evento imutável |
| `capture-links-tab.tsx` | Templates de UTM atualizados (Meta: macros por NOME + placement + site_source_name; Google: ValueTrack completo) + snippet JS pra landing repassar params ao botão `/r/` |

### Decisões arquiteturais

- **Ponte clique↔lead por código curto, não por URL no texto.** O `/r/[slug]` grava o clique com TODOS os parâmetros server-side e injeta `Cód: A7X2K9` (6 chars, alfabeto sem 0/O/1/I/L) na mensagem — substituiu a linha `Origem: <URL>` (spam visual e frágil). O webhook extrai o código (`extractClickCode`, regex `c[óo]d(igo)?[.:]`), casa via `matchClickByCode` (janela 90 dias) e a atribuição do clique **vence** a do texto (`mergeTracking`). `extractTrackingFromText` continua como fallback para links antigos/URLs coladas. Depois do casamento, `linkClickToLead` grava `lead_id`/`matched_at` no clique — clique e lead deixam de ser mundos separados.
- **`lead_tracking_events` = histórico IMUTÁVEL de toques** (não de mensagens): grava o primeiro contato (snapshot completo) + qualquer mensagem posterior com identificador novo (ctwa/link_click/utm_texto). `event_type`: `ctwa | link_click | utm_texto | contexto | organico` (Fase 2 adiciona `formulario`). FK `ON DELETE CASCADE` p/ `crm_leads` (some só com o lead). Dedup de retry por índice único parcial `(lead_id, external_id)` + `ON CONFLICT DO NOTHING`.
- **First-touch protegido em `crm_leads`**: colunas novas (gclid/wbraid/gbraid/fbclid/ttclid, keyword/matchtype/device/network/placement, click_code, ddd/regiao_uf/regiao_cidade/regiao_fonte) preenchidas via `applyLeadAttribution` com `COALESCE(NULLIF(col,''), novo)` — UPDATE separado do upsert gigante de `crm-conversation-sync.ts` (de propósito: não mexer nos 26 params posicionais).
- **Região sem API externa**: geo do clique via headers `x-vercel-ip-country/-region/-city` (prioridade, localização real) com fallback DDD do telefone (`regiao_fonte='ip'|'ddd'`). Idade/gênero por lead NÃO existe via WhatsApp — virá de formulário (Fase 2) ou agregado da campanha (Fase 3).
- **`detectOrigin` agora entende click IDs**: gclid/wbraid/gbraid → google (ANTES do utm_source), fbclid → meta, ttclid → tiktok; `adwords` também mapeia p/ google. Antes, lead do Google com auto-tagging puro caía como `organic`.
- **keyword NUNCA cai de `utm_term`**: o template Meta usa `utm_term={{adset.name}}` — fallback keyword←utm_term poluiria a coluna com nome de conjunto. O template Google envia `keyword={keyword}` explícito.
- **Schema via `ensureLeadTrackingSchema`** (memoizada por processo, padrão CREATE/ALTER IF NOT EXISTS inline do projeto — não tem .sql). FK da events table via DO $$ block (Postgres não tem ADD CONSTRAINT IF NOT EXISTS).
- ⚠️ Não verificável no preview local (sem DB/instância Evolution) — funções puras validadas por teste transpilado (27 asserts: round-trip do código, extração de texto, merge, DDD). Validar em produção: clicar num `/r/` com `?utm_source=google&gclid=X&keyword=Y`, mandar a mensagem com o código e conferir `crm_leads` + `lead_tracking_events`.

### Fase 2: formulários (2026-07-15)

| Arquivo | Papel |
|---|---|
| `src/lib/meta-leadgen.ts` | `processLeadgenEvent`: busca o lead na Graph (`/{leadgen_id}` — o nó Lead já traz `campaign_name`/`adset_name`/`ad_name` direto), resolve o cliente, upsert no CRM + evento `formulario`. `parseLeadgenFields` normaliza field_data (full_name/first+last, phone/whatsapp, email, city/state, date_of_birth; custom → extras) |
| `src/app/api/meta/webhook/route.ts` | Branch `object=page, field=leadgen` → `processLeadgenEvent` (page token via `getPageToken`), log em `meta_automation_logs` (event_type `leadgen`) |
| `src/app/api/webhooks/[token]/route.ts` | `lead.create` aceita utm_*/gclid/wbraid/gbraid/fbclid/ttclid/keyword/matchtype/device/network/placement/email/cidade/estado OU só `page_url` (extrai tudo da URL via `extractTrackingFromText`); grava atribuição + evento `formulario` |

- **Resolução página→cliente** (leadgen): 1º `meta_leadgen_page_map` (page_id→client_id, criada em `meta-leadgen.ts`; cadastrar manualmente p/ leads orgânicos de form); 2º via `ad_id` → `GET /{ad_id}?fields=account_id` → `client_account_links` (platform meta_ads/meta, aceita `act_` prefixado ou não) — e memoriza no mapa. Não resolvido → log de erro em `meta_automation_logs` com a page_id.
- **Dedup leadgen**: `external_id = 'leadgen:{id}'` em `lead_tracking_events` — checado ANTES de buscar na Graph (Meta reenvia webhooks).
- **Lead sem telefone** (form só-email): INSERT direto em `crm_leads` (upsert exige phone/lid). Com telefone: upsert — junta com a conversa futura do mesmo número no WhatsApp.
- **`crm_leads.email`** (coluna nova) + `regiao_fonte='form'`: cidade/UF declaradas no formulário têm prioridade sobre DDD. Respostas custom viram `observacao` legível + raw completo no evento (é a única fonte de demografia POR LEAD — idade/cidade declaradas).
- **`originFromTracking`** (lead-tracking.ts): helper único de origem por identificadores (gclid→google, fbclid→meta, ttclid→tiktok, utm_source mapeado) — usado pelo webhook WhatsApp (via `detectOrigin`), leadgen e webhook genérico.
- ⚠️ Setup necessário no app Meta p/ Lead Ads nativo: permissão `leads_retrieval` + subscrever o campo `leadgen` no webhook do app + página assinada (`/{page_id}/subscribed_apps`). Sem isso a Meta não manda o evento.
- ⚠️ Validado por teste transpilado (19 asserts: parseLeadgenFields + originFromTracking); fluxo completo precisa de produção (Graph API + DB). Testar com o Lead Ads Testing Tool da Meta (developers.facebook.com/tools/lead-ads-testing).

### Fase 3: demografia agregada + UI rica (2026-07-15)

| Arquivo | Papel |
|---|---|
| `src/app/api/tracking/leads/route.ts` | GET consolidado (`clientId?`, `days`, `limit`) — lê a atribuição REAL de `crm_leads` (origem, campanha/conjunto/anúncio, keyword, placement, região, flags has_ctwa/has_gclid/click_code) + summary (porOrigem/porCampanha/porRegiao/porKeyword/porPlacement, % com atribuição/região). Substitui a leitura da legada `whatsapp_leads` nas telas |
| `src/app/api/tracking/demografia/route.ts` | GET `clientId` — breakdowns agregados últimos 30d: Meta insights `breakdowns=age,gender` + `region` (level=account, mesmos action_types do metrics — nunca somar famílias); Google GAQL `age_range_view`/`gender_view` + `geographic_view` com resolução de nomes via `geo_target_constant` em lote. Cache 4h (reusa `mccmap:{connId}` do metrics). Tudo best-effort: resultado parcial > 500 |
| `rastreamento/page.tsx` | Seção "Rastreio WhatsApp → Meta Ads" virou **"Leads Rastreados"**: KPIs (total/% atribuição/% região), 4 cards de breakdown, painel de demografia (só com cliente selecionado — precisa da conta de anúncio), tabela rica (Lead, Origem+badges CTWA/gclid/link, Campanha›Conjunto›Anúncio, Keyword/Posição, Região c/ fonte) |
| `clientes/[id]/tracking-tab.tsx` | Tabela de leads da sub-aba WhatsApp agora lê `/api/tracking/leads?clientId=` com as mesmas colunas ricas; status de envio de conversão continua na sub-aba Log (`conversion_log`) |

- **Demografia é AGREGADO, não por lead** — o painel deixa isso explícito no texto. Idade por lead só via formulário (Fase 2).
- **Rotas legadas (`/api/whatsapp-leads`, `/api/clients/[id]/tracking/leads`) não foram removidas** — a tabela `whatsapp_leads` ainda alimenta a dedup do CAPI legado no webhook. Só as TELAS migraram de fonte.
- ✅ Verificado no preview com `window.fetch` mockado (screenshots: KPIs, breakdowns, badges, tabela, hierarquia de campanha, região com fonte ddd/ip) + degradação graciosa confirmada (API 500 → estado vazio, sem crash). SQL real e chamadas Meta/Google não verificáveis localmente (sem DB) — validar em produção.

### Fase 4: feedback loop pra Meta/Google (2026-07-15)

| Arquivo | Papel |
|---|---|
| `src/lib/google-offline-conversions.ts` | `resolveGoogleAdsAccess` (config `google_customer_id` > `client_account_links`; token cru via OAuth fetch com fallback — espelha report-builder, NUNCA googleapis refreshAccessToken), `resolveConversionAction` (aceita resource name, ID numérico ou NOME da ação — resolve via GAQL c/ cache 4h), `uploadClickConversion` (`:uploadClickConversions`, só UM click id por conversão, `partialFailure:true` — 200 c/ `partialFailureError` conta como falha) |
| `src/lib/conversions.ts` | `enviarEventoGoogle` reescrito: caminho 1 = **offline click conversion** (lead com gclid/wbraid/gbraid da Fase 1 → credita campanha/keyword exata, alimenta Smart Bidding); caminho 2 = fallback GA4 MP com `client_id` sintético determinístico no formato `_ga` (`{int32}.{int32}` do hash do telefone — o hash cru de antes nem era client_id válido; GA4 = contagem, não atribuição). `enviarEventoMeta` ganhou fallback pra `client_tracking_config` (pixel/token legados) quando não há `client_conversion_config`. `hasSuccessfulConversion` exportado |
| `webhook/whatsapp/[instanceId]/route.ts` | **CAPI legado removido** (`sendMetaEvent` com `action_source:'other'` — duplicava Purchase e a Meta não atribuía). FLOW 1 não reenvia Lead (o CAPI novo já mandou no 1º inbound; `whatsapp_leads.evento_lead_enviado` lido do `conversion_log`); FLOW 2 envia Purchase UMA vez pelo caminho novo |
| `tracking-tab.tsx` | Card Google renomeado ("Google — Conversões"): campo Customer ID (opcional), campos de ação de conversão agora pedem NOME ou ID (não mais o gtag label), Measurement ID/API Secret rebaixados a "fallback GA4" |

- **Config semântica mudou**: `google_conversion_label_*` deixou de ser o gtag label e passou a ser NOME ou ID da ação de conversão do Google Ads (necessário pro upload via API). Configs antigas com label gtag caem no log com "ação não encontrada" + fallback GA4 — reconfigurar pelos nomes.
- **Dedup**: continua nos callers (`dispararEventos*`/`dispararEventoFechamento` via `hasSuccessfulConversion`; webhook gate por 1º/2º inbound e `evento_compra_enviado`).
- ⚠️ Validado por teste transpilado (19 asserts: endpoint/headers/payload do upload, precedência gclid>wbraid>gbraid, formato conversionDateTime, partialFailureError, resolução de ação por nome/ID/cache). Chamada real ao Google Ads exige produção — testar com lead real com gclid e conferir `conversion_log` (`[offline_click_conversion]`) + Google Ads → Metas → Conversões (aparece em ~3h).

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
| `src/app/api/leadlovers/campaigns/[id]/rules/route.ts` | GET/POST/PATCH/DELETE regras de cronograma |
| `src/app/api/leadlovers/campaigns/[id]/activate/route.ts` | POST — pré-computa `next_send_at` por contato (regras) OU `?mode=now` (tudo pra NOW()) |
| `src/app/api/leadlovers/worker/route.ts` | POST/GET — envia contatos due (fino: delega pra `dispatchBatch`) |
| `src/lib/leadlovers-worker.ts` | `dispatchBatch()` compartilhado — faz o POST no webhook + grava log/contadores; parametrizado por `selection: {mode:'due'} \| {mode:'day', day}` |
| `src/app/api/leadlovers/contacts/[id]/route.ts` | PATCH/DELETE de um contato individual (nome/email/telefone/empresa) |
| `src/app/api/leadlovers/connections/route.ts` | GET (lista, opcional `?client_id=`) / POST — credenciais reaproveitáveis vinculadas a um cliente |
| `src/app/api/leadlovers/connections/[id]/route.ts` | DELETE de uma conexão |
| `src/app/api/leadlovers/campaigns/[id]/schedule/route.ts` | GET — cronograma dia-a-dia (total/enviado/pendente/erro por `DATE(next_send_at)` em America/Sao_Paulo) |
| `src/app/api/leadlovers/campaigns/[id]/dispatch-day/route.ts` | POST `{date}` — dispara AGORA todos os pendentes daquele dia, ignorando `send_time`/`next_send_at <= NOW()` ("antecipar") |
| `src/app/(dashboard)/integracoes/leadlovers/page.tsx` | UI com 2 abas: **Campanhas** (lista + wizard de criação + gerenciar) e **Painel** (acompanhar + testar webhook no rodapé) |

### Decisões arquiteturais do Leadlovers

- **xlsx parse no cliente**: a planilha é lida no browser com `XLSX.read()` e enviada como JSON para `/api/leadlovers/contacts`. Evita upload binário e mantém dentro do limite de 10s.
- **Agendamento pré-computado**: ao ativar a campanha (`/activate`), o backend distribui contatos nos dias úteis com `next_send_at` já calculado. O worker não precisa de lógica de scheduling — só busca `WHERE next_send_at <= NOW()`.
- **Apenas dias úteis**: `businessDaysBetween()` em `activate/route.ts` pula sábado (6) e domingo (0).
- **Fuso horário**: `send_time` é interpretado como BRT (UTC-3). O activate usa `setUTCHours(sh + 3, sm)` para converter. Nunca usar `setHours` (usa fuso do servidor = UTC).
- **Intervalo opcional**: se `interval_minutes` é `NULL`, todos os contatos do dia recebem o mesmo `next_send_at` (horário de envio). Se preenchido, cada contato é escalonado em +N minutos.
- **Reagendamento**: `POST /activate?reschedule=1` recalcula `next_send_at` dos pendentes mesmo com campanha ativa. Distribui só a partir de hoje pra frente. Se o horário de hoje já passou, `sendAt = now` (envia na próxima rodada). Botão "Reagendar pendentes" na aba Campanhas.
- **Worker (GET)**: chamado pelo GitHub Actions a cada 5 min (`.github/workflows/leadlovers-worker.yml`). Envia lote de 5 por chamada — seguro dentro do limite 10s do Vercel (cada webhook ~0.5-1s). O GET autentica via `?secret=CRON_SECRET` e chama `processContacts()` diretamente (não cria `new Request()` — isso crashava silenciosamente no Next.js 16).
- **Worker (POST)**: chamado pelo frontend (polling na aba Painel). Autentica via `x-onmid-user-id` (usuário) ou `Authorization: Bearer <CRON_SECRET>` (cron).
- **`leadlovers_dispatch_log` criada no worker**: a tabela pode não existir se a migration não foi rodada. O worker faz `CREATE TABLE IF NOT EXISTS` na primeira chamada.
- **Credenciais por campanha**: cada campanha tem `webhook_url`, `machine_code`, `email_sequence_code`, `sequence_level_code`, `auth_key` próprios — permite apontar para fluxos de email diferentes no Leadlovers.
- **Editar campanha**: botão "Editar credenciais" na aba Campanhas. Inclui botão "Testar conexão" que usa os valores do form (chama `PUT /api/leadlovers/config`).
- **Editar send_time de regra existente**: coluna HORÁRIO da tabela mostra `<input type="time">` editável. Salva via `PATCH /api/leadlovers/campaigns/[id]/rules?rule_id=...` (endpoint PATCH adicionado em `rules/route.ts`). Alterar o horário da regra **não** reagenda automaticamente — precisa clicar "Reagendar pendentes".
- **Cron Vercel**: mantido como backup diário (`0 12 * * 1-5`) em `vercel.json`. Plano Hobby só permite 1x/dia. GitHub Actions é o primário.
- **Não usa Supabase**: todas as tabelas são PostgreSQL via `server-db.ts`.
- **Manipulação individual de contatos (2026-07-13)**: aba Painel ganhou gestão completa por contato (além do upload em massa via xlsx) — botão "Adicionar contato" (form inline, reusa `POST /api/leadlovers/contacts` com array de 1), edição inline (lápis → PATCH `/api/leadlovers/contacts/[id]`) e exclusão individual (lixeira → DELETE `/api/leadlovers/contacts/[id]`, com aviso extra no `confirm()` se o contato já foi enviado, pois `leadlovers_dispatch_log` tem `ON DELETE CASCADE` e perde o histórico de disparo dele). Endpoint novo `contacts/[id]/route.ts` — o `DELETE /api/leadlovers/contacts` (bulk, por `campaign_id`) só apagava pendentes; o individual não tem essa restrição de status, é intencional (o usuário pode querer remover um contato mesmo já enviado).

### Credenciais por cliente + cronograma dia-a-dia (2026-07-13)

Redesenho grande: antes cada campanha guardava suas próprias credenciais cruas, sem nenhum vínculo com o cadastro de clientes do app. Agora:

- **`leadlovers_connections`** (nova tabela, análoga a `meta_connections`/`google_connections`): `id, owner_id, client_id, name, webhook_url, machine_code, email_sequence_code, sequence_level_code, auth_key`. Vinculada a `clients.id` (TEXT, sem FK — mesmo padrão solto de `client_account_links.client_id`, não `meta_client_links`). Um cliente pode ter várias conexões nomeadas (ex: fluxos diferentes no Leadlovers).
- **`leadlovers_campaigns` ganhou `client_id` e `connection_id`** (FK `ON DELETE SET NULL`). Ao criar a campanha, as credenciais são **copiadas** (snapshot) da conexão pra dentro da campanha — o worker (`dispatchBatch`) continua lendo direto de `leadlovers_campaigns`, sem JOIN extra e sem quebrar se a conexão for editada/apagada depois.
- **Fluxo de criação** (`POST /api/leadlovers/campaigns`): agora exige `client_id` + (`connection_id` de uma conexão existente **OU** `new_connection {...}` pra criar e já linkar uma nova). Campanhas antigas (pré-migração) continuam funcionando com `client_id`/`connection_id` `NULL` — GET faz `LEFT JOIN clients`/`LEFT JOIN leadlovers_connections`, então só deixam de mostrar "Cliente: X • Conexão: Y" no header.
- **Cronograma dia-a-dia + disparo manual ("antecipar")**: depois de ativar (`/activate`, que já distribuía `next_send_at` por contato), a tabela "Disparos por dia" (`GET .../schedule`, agrupa por `DATE(next_send_at AT TIME ZONE 'America/Sao_Paulo')`) mostra total/enviados/pendentes/erros por data e um botão "Disparar agora" por linha. O botão chama `POST .../dispatch-day {date}` em loop (a cada resposta, se `remaining > 0` chama de novo) até zerar os pendentes daquele dia — cobre tanto **antecipar um dia futuro** quanto **zerar pendências que sobraram** de um dia já passado, sem precisar esperar o `send_time` da regra nem ligar o "Envio automático".
- **`dispatchBatch` (lib compartilhada)** extraído de `worker/route.ts`: mesma função atende o worker normal (`selection: {mode:'due'}`, `next_send_at <= NOW()`, só campanha `ativa`) e o disparo manual (`selection: {mode:'day', day}`, ignora o horário, aceita campanha `ativa` OU `pausada` — clique manual é decisão explícita do usuário, pausar não deve bloquear). **Cuidado ao mexer aqui**: o filtro de status da campanha é condicional ao `mode` de propósito — nunca deixar `'pausada'` vazar pro modo `'due'`, senão o cron/monitor automático volta a disparar campanha pausada.
- **`dispatch-day` roda síncrono com `maxDuration = 60`** (mesmo padrão do `otimizador/weekly`: função longa em vez de fila assíncrona com `after()` — esse padrão de `after()` citado em notas antigas não existe mais no código atual, foi abandonado). Loop interno em lotes de 8 contatos, orçamento de ~50s; se um dia tiver uma leva grande demais pra caber numa chamada, devolve `remaining > 0` e o frontend continua chamando.
- ⚠️ Não verificável no preview local (sem DB) — testado no browser com `window.fetch` mockado simulando `clients`/`connections`/`campaigns`/`contacts`/`schedule`/`dispatch-day`; validar o fluxo completo com dados reais em produção.

### Redesign da UI: 2 abas + wizard (2026-07-13)

Reforma total da tela (a versão anterior — 4 abas Upload/Webhook/Cronograma/Painel — estava confusa: upload solto sem saber pra onde ia, Campanhas e Painel sobrepostos, Testar Webhook em destaque à toa, sem excluir campanha). `page.tsx` foi reescrito. Decisões validadas com o usuário via perguntas antes de codar:

- **Duas abas só: Campanhas e Painel** (linha divisória clara pra não sobrepor). **Campanhas** = criar (wizard) + gerenciar (pausar/retomar, excluir, duplicar, editar credencial). **Painel** = acompanhar (stats, progresso, envio automático, "Disparos por dia" com "Disparar agora", gestão de contatos, alertas de erro). Abas Upload e "Testar Webhook" sumiram do topo.
- **Wizard `NewCampaignWizard` — 3 passos: Cliente → Contatos → Disparo.** (1) Cliente: escolhe o cliente; se já tem credencial vinculada, ela vem automática, senão cadastra na hora (form `+ Nova credencial`). (2) Contatos: upload xlsx (parse no cliente via `parseSheet`) — a base vai anexada na criação, não é mais aba separada. (3) Disparo: nome + escolha "Tudo de uma vez" (⚡ `activate?mode=now`) OU "Distribuir por dia" (input qty/dia + data início + horário + intervalo, com preview "N ÷ X/dia = Y dias úteis, de … até …" calculado por `nthBusinessDay`). Ao concluir: cria campanha → sobe contatos → (se por dia) cria a regra + activate, (se tudo agora) `activate?mode=now` → cai direto no Painel da campanha. No modo "tudo agora", o Painel auto-dispara o dia de hoje (`autoDispatchDate` → `dispatchDay(today)`).
- **`activate?mode=now`** (novo no `activate/route.ts`): seta `next_send_at = NOW()` em todos os pendentes e `status='ativa'`, sem cronograma nem dias úteis. O drain fica com o `dispatch-day` de hoje (loop no frontend) + worker automático. Evita o edge case de "hoje é fim de semana → nada agendado" que o caminho por regras teria.
- **Duplicar campanha**: abre o wizard já com o `client_id` da origem pré-selecionado (credencial vem automática) e você escolhe **contatos novos** — não herda mais os contatos da original (era a reclamação).
- **Excluir campanha**: `DELETE /campaigns/[id]` (já existia) agora exposto no card, com `confirm()` avisando que contatos + histórico vão junto.
- **Testar webhook**: virou um bloco colapsável discreto no rodapé do Painel (`WebhookTester`), não mais uma aba de destaque.
- ⚠️ Verificado no browser com `window.fetch` mockado (wizard completo Cliente→Contatos→Disparo com 120 contatos → distribuição 50/50/20 por dia → "Disparar agora" → card na aba Campanhas → excluir). Como `/api/clients` precisa de DB, no preview local os clientes só carregam forçando um remount (o mock não existe no mount inicial). Validar com dados reais em produção.

---

## Instruções para o Claude

- Ao final de cada sessão, atualize este arquivo com decisões novas, tecnologias adicionadas ou mudanças importantes feitas hoje.
- Sempre use Sonnet 4.6 para raciocínio e Haiku 4.5 para tarefas simples.
