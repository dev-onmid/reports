@AGENTS.md

## Tela do cliente — abas enxutas + modal de configuração (2026-07-22)

Reforma de densidade da tela `clientes/[id]` (pedido do Matheus: "ao clicar em clientes aparecia tudo de uma vez"). Reorganização 100% de apresentação — nenhuma rota/backend mudou.

- **Aba Integrações eliminada** e **Links & Senhas deixou de ser aba**. Todo o setup virou um botão **⚙️ Configurar** no header (ao lado de Vincular Contas) → `ClientConfigModal` (novo, em `page.tsx`) com 4 seções: Forma de cobrança, Anota Aí, Conexões (Meta/Google/GMN/Sheets — reusa `ClientIntegrationsTab` inteiro como corpo) e Links & Senhas (reusa `VaultTab`). O corpo do modal só monta com `open` (Radix desmonta content fechado) → refetcha a cada abertura.
- **Barra de abas 11 → 5 + "Mais ▾"**: `PRIMARY_TABS = [dashboard, planejamento, crm, rastreio, pagamentos]` sempre visíveis; `MORE_TABS = [lps, dna, historico, mapa]` num dropdown de overflow (fecha via backdrop `fixed inset-0`, botão fica destacado quando a aba ativa está lá dentro). `TABS`/`tabLabel` perderam `integracoes` e `links` (os render blocks `tab === 'integracoes'|'links'` foram removidos — senão viram erro de tipo, pois saíram do union `Tab`).
- **Cobrança = fonte única de verdade**: editável só no modal; a aba **Pagamentos** (`InvestmentPaymentsTab`) ganhou selinho **read-only** no topo (`Forma de cobrança: Pré-pago/Cartão` + hint "Editar em Configurar"), lendo `/api/clients/[id]/billing-mode` com cache em `CLIENT_BILLING_MODE_PREFIX` (localStorage). Não duplica o controle.
- ⚠️ **Lição do modal**: o `DialogContent` do projeto tem default `sm:max-w-sm` (responsivo) que VENCE um `max-w-5xl` base via twMerge (prefixos `sm:` não deduplicam com base) — para alargar o modal use o MESMO prefixo (`sm:max-w-4xl`). Também: a linha do header da "Forma de cobrança" precisou de `flex-wrap` + `self-start` no toggle pra não cortar "Cartão / faturado" na largura menor do modal.
- ✅ Verificado no preview (dev server de outra sessão na :3000, mesmo folder = HMR pegou as edições): botão Configurar, 5 abas + Mais (dropdown com as 4 de referência), modal com as 4 seções renderizando (conexões + Links & Senhas no fim), selinho de cobrança na aba Pagamentos, largura corrigida (896px). tsc limpo.

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

## Instâncias Evolution — popup de alerta + central de gestão (2026-07-22)

Pedido do Matheus: o banner fixo vermelho de instâncias desconectadas incomodava ("não ficar aquilo o tempo todo") + queria um lugar pra ADM gerenciar instâncias.

- **Popup em vez de banner**: `evolution-alert-banner.tsx` reescrito como card flutuante (fixed bottom-right, z-50, top bar vermelha). Dismiss por **assinatura** (`name:status` ordenado em sessionStorage `onmid-evolution-alert-dismissed-sig`) — fechou, só REAPARECE se o conjunto de problemas mudar (instância nova caiu/status mudou); situação normalizada esconde sozinho. Botão "Gerenciar instâncias" → `/configuracoes?tab=instancias`. Poll 5min mantido; só Administrador vê.
- **Aba "Instâncias" em Configurações** (`InstancesTab` em `configuracoes/page.tsx`; deep-link `?tab=` no init do `activeTab`): tabela de TODAS as instâncias da VPS Evolution (nome/status com dot/número/vínculo/toggle ativa) + ações Conectar (modal QR com o MESMO padrão fases/poll 3s/countdown 40s — 3ª cópia do padrão) e Excluir (confirm; apaga da VPS via `deleteEvolutionInstance` e DESATIVA os registros no banco — conversas preservadas).
- **API `/api/admin/instances`**: GET (fetchInstances da VPS + joins `zapi_clients`/`client_zapi_instances` → vínculos "Disparos · Cliente"/"CRM · Cliente", `active` null = órfã sem registro), POST `{instanceName, action:'connect'|'status'}` (QR/estado pro modal), PATCH activate/deactivate (seta `active`/`ativo` nas DUAS tabelas por instance_id), DELETE `?name=`.
- **Desativar = silenciar**: `filterMutedInstances()` em `evolution-instance-alerts.ts` exclui instâncias com registro inativo no banco — aplicado na rota `/api/alerts/evolution-status` (popup) E dentro de `sendInstanceAlerts` (cron WhatsApp/email). Instância morta de propósito não alerta mais em lugar nenhum.
- ✅ Verificado no preview (dev server da outra sessão na :3000; o meu caiu por conflito de porta): aba lista instâncias REAIS da VPS, popup flutuante com dismiss, deep-link funcionando, modal QR abrindo com countdown (QR mockado). Toggle ativa/vínculos precisam de DB (produção) — no dev sem DATABASE_URL tudo aparece como "órfã", degradação correta.

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

### Período de comparação escolhível + seguidores do período + UX de datas (2026-07-21)

Três melhorias no modal "Gerar Relatório" e nos builders (pedidos do Matheus):

- **Bug do rótulo "Maio" ao analisar Julho corrigido** (mês cheio de 31 dias): o período anterior automático recuava *N dias corridos* (`calcPrevPeriod`/janela do IG), então Julho (31d) recuava de 30/jun para **31/mai** e o rótulo pegava o mês de início = Maio. Novo helper canônico `autoPreviousPeriod(from,to)` em `delivery-report-builder.ts` (exportado): se `[from,to]` é um mês-calendário CHEIO (dia 1 ao último), o anterior é o **mês-calendário anterior completo** (jul→jun, jan→dez do ano anterior); fora de mês cheio (ex.: "últimos 30 dias") mantém a janela corrida de mesma duração. Usado no branch automático do `fetchInstagramData` e no `calcPrevPeriod` do omni (que agora só delega). Validado com teste (`scratchpad/test-prev.mjs`): jul→jun, jun→mai, jan/26→dez/25, fev→jan, parcial→janela corrida.
- **Período de comparação escolhível na geração** (antes: 100% derivado no backend = janela imediatamente anterior de mesma duração, o que virava "comparativo de maio" ao gerar junho). Tipo canônico novo `CompareOverride = { from; to } | null | undefined` em `delivery-report-builder.ts`: `undefined` = automático (comportamento antigo), `null` = **não comparar**, `{from,to}` = intervalo explícito. Threadeado por `fetchInstagramData` (6º param) e pelos 3 builders (`buildDeliveryReport`/`buildSocialReport`/`buildOmniReport` ganharam `compare?`). No omni, `prev` vira `compare===null ? null : (compare ?? calcPrevPeriod(...))` e o CRM anterior não é buscado quando `null`. `run-once/route.ts` resolve `compareMode` (`previous_period`|`previous_year`|`custom`|`none`) → `resolveCompare()` → override; automações NÃO passam `compare` (continuam automáticas, de propósito). UI: bloco "Comparar com" (4 chips) + campos "Comparar de/até" só no modo custom (pré-preenchidos com a janela anterior automática ao ativar) + nota explicativa por modo. Payload só inclui `compareMode` quando ≠ `previous_period`.
- **Seguidores do período sempre visíveis** (antes: card mostrava total snapshot 18.714 e a linha de apoio colapsava em "sem comparativo anterior" quando o período anterior do metric `follower_count` era 0). `metricCard` ganhou 8º param `customCompare?` que bypassa o `compareLine`. Card de Seguidores agora usa `followersLine`: sempre "+X no período" (do `ig.followers_period` = soma do metric `follower_count`), com "· ±Y% vs anterior" anexado quando há período anterior > 0; sem ganho → "sem novos seguidores no período". ⚠️ Comparativo do **total** de seguidores histórico ainda não existe (a `social_monitor_snapshots` é 1 linha/cliente, sobrescrita — não é série temporal); só o ganho do período é mostrado.
- **UX do seletor de datas**: chips de **meses recentes** (últimos 6 meses, ex: `jun/26`) que selecionam o mês inteiro com 1 clique sem tocar no calendário nativo + **resumo legível** do período ("01/06/2026 até 30/06/2026 · 30 dias") abaixo dos inputs De/Até. Presets antigos (Mês passado/Este mês/etc.) mantidos.
- ✅ Verificado no preview (auth fail-open): modal renderiza chips de meses, resumo de dias, seletor "Comparar com" e — ao clicar "Personalizado" — pré-preenche os campos com `2026-05-02..2026-05-31` (janela de 30d anterior a junho, igual ao `calcPrevPeriod`). tsc limpo, sem erros de console. Followers card e fluxo real de dados (Graph API) exigem produção.

### PDF do relatório — métricas cortadas + peso + cards inconsistentes (2026-07-22)

Correções no export PDF (html2canvas → jsPDF em `export-report-pdf.ts`) e no slide "Todos os conteúdos" (`sInstagramTodosConteudos`), reportado pelo Matheus (PDF do Cinfel: pills de métrica cortados na metade, páginas parecendo tamanhos diferentes, arquivo 7.5 MB):

- **Métricas/caption cortados** (bug do html2canvas com `overflow:hidden` + `line-height:1`): o export já tinha um passe que libera `overflow` só de elementos com `white-space:nowrap` + `overflow:hidden` (os valores de KPI do slide principal). Os pills de "Todos os conteúdos" e "Top conteúdos" tinham `overflow:hidden` nos wrappers mas SEM `nowrap` no MESMO elemento → o passe não os pegava e o html2canvas cortava o glifo. Correção: adicionado `white-space:nowrap` aos dois wrappers com `overflow:hidden` de CADA `metricPill` (Top + Todos) + `line-height:1` → `1.4` nos textos. O caption de 1 linha do "Todos" virou `white-space:nowrap;overflow:hidden;text-overflow:ellipsis` (em vez de `-webkit-line-clamp:1`) pra também ser pego pelo passe; `truncateCaption` 92 → 72 chars pra caber na coluna. ✅ Verificado no preview: o passe de descorte casa 104 elementos (antes casava 0 pills) e o layout não quebra com `overflow:visible`.
- **Cards inconsistentes / páginas "de tamanhos diferentes"** (todas as páginas do PDF têm o MESMO MediaBox 1920×1080 — confirmado; a sensação vinha do grid): "Todos os conteúdos" usava `grid-template-rows:repeat(3,1fr)` (altura do card = 1/3 da área, variável e espremida) enquanto "Top conteúdos" (que não cortava) usa card de **altura fixa**. Trocado para `grid-auto-rows:198px` + `align-content:start` e card com `height:198px` fixo (mesmo padrão do Top). ✅ Verificado: cards a 198px consistentes tanto na página cheia (6) quanto na parcial (2 cards da última página).
- **Peso do arquivo**: html2canvas `scale` 2 → **1.6** e JPEG `0.92` → **0.85** — derruba ~40% (7-8 MB → ~4-5 MB) mantendo nitidez em tela/impressão. Ajuste global do export.
- ⚠️ O corte é específico do html2canvas — não reproduzível em render normal de browser (só o passe de descorte foi validado no preview). Regerar o PDF do Cinfel em produção pra confirmar pills inteiros.

### Slide "Top palavras-chave" (Google Ads)

- O relatório de performance (`buildOmniReport` em `src/lib/report-builder.ts`) monta os slides de Google a partir de `fetchGoogleAdsDetailed`, que agora traz também `palavrasChave: PalavraChaveGoogle[]` (tipo em `delivery-report-builder.ts`).
- **Fonte**: GAQL `keyword_view` (palavras-chave compradas, não `search_term_view`). `segments.date` só no `WHERE` para agregar o período; agregação por `texto+match_type` no código (a mesma keyword aparece em vários grupos). Top 10 ordenado por **conversões** (desempate: cliques → investimento).
- **Slide** `sGoogleAdsPalavrasChave` (tabela: palavra-chave + badge de correspondência, impressões, cliques, **CPC**, **conversões**, custo/conv.) renderizado após `sGoogleAdsCampanhas`. Só aparece se `googleDetailed.palavrasChave.length > 0` (contas só-PMax/Display/Shopping não têm keyword → slide some sem quebrar).
- ⚠️ Não verificável no preview local (sem DB/OAuth Google) — validar com cliente Google de Pesquisa real.

---

## Radar de LP — analytics de comportamento por landing page (2026-07-22)

Camada PRÓPRIA e leve de "mapa de calor" (Etapa 1: números agregados): cadastro de LPs por cliente + script embarcável que coleta cliques/scroll/tempo da MASSA de visitantes (decisão do Matheus: sem visão individual por lead; Clarity não integra — Data Export só agrega 3d, sem heatmap via API).

| Arquivo | Papel |
|---|---|
| `src/lib/lp-analytics.ts` | `ensureLpAnalyticsSchema` (`client_landing_pages` + `lp_sessions`, padrão memoizado), `generateLpTrackingKey` (10 chars minúsculos sem ambíguos), `TRACKING_KEY_REGEX`, tipo `LpClick` |
| `src/app/api/lp/tag.js/route.ts` | **Primeiro endpoint JS do repo** — serve o IIFE (~2.5KB, zero deps, tudo em try/catch) com `Content-Type: application/javascript` + cache 1h. Snippet: `<script src="{base}/api/lp/tag.js?k=KEY" defer>` |
| `src/app/api/lp/collect/route.ts` | POST público de ingestão — body text/plain via sendBeacon (**zero preflight; o repo segue sem nenhum handler OPTIONS**), TODA saída 204 (sem oracle de keys), sanitização campo a campo, upsert fire-and-forget |
| `src/app/api/clients/[id]/landing-pages/route.ts` | GET (lista + sessions_30d + last_session_at + `base` via `webhookOrigin`), POST (retry 3x no 23505), DELETE `?lpId=` |
| `.../landing-pages/[lpId]/stats/route.ts` | Promise.all: totais + funil de scroll (COUNT FILTER ≥25/50/75/100) + top cliques (`jsonb_array_elements`) + device/campanha/origem + série diária; days clamp 1-90 |
| `clientes/[id]/landing-pages-tab.tsx` | Aba "Landing Pages" (`TABS` id `'lps'`): lista com status de coleta (<24h = verde), modal Nova LP, snippet com copiar, painel com KPIs + **funil de scroll** (herói) + ranking "onde mais clicam" + device/campanha/série |

- **Anti-firehose (Vercel Hobby)**: 1 LINHA POR SESSÃO em `lp_sessions` — o script acumula no browser e manda snapshot (primeiro ~3s, flush 20s com dedupe, visibilitychange/pagehide); collect faz `ON CONFLICT (lp_id, session_key) DO UPDATE` com `GREATEST` em scroll/duration (beacons fora de ordem) e substitui `clicks` (snapshot é superconjunto). Cap 50 cliques/32KB.
- **Descritor de elemento** (agrupamento estável entre sessões): sobe ≤3 níveis até ancestral interativo (clique no `<span>` agrupa com o botão) → `tag#id` > `tag.classeEstável` (regex filtra hash/utility) > `tag`. **LGPD**: input/textarea/select nunca carregam texto; só cliques+scroll, nada digitado sai da página.
- **Etapa 2 destravada** (overlay visual de heatmap, não construída): coords absolutas E normalizadas (`xp`/`yp`) + viewport/doc_height já persistidos em `clicks` JSONB.
- **Lições do tag**: (1) medir scroll também DENTRO do `send()` — scroll programático nem sempre dispara evento; (2) viewport lida na hora do envio com memoização da última medida não-zero (`vwNow`/`vhNow` — aba em background lê `innerWidth=0` e derrubava o device pra "mobile"); (3) forçar 100% a ≤2px do fundo (arredondamento nunca fechava a faixa).
- **`.env.local` ganhou placeholders** `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` — sem eles a página `/clientes/[id]` nem renderiza no dev local (supabase.ts exige a env; crash pré-existente que bloqueava qualquer verificação de preview das abas).
- ✅ Verificado no preview: tag.js real numa página de origem diferente (localhost:8787→3000) — beacons POST 204 **sem OPTIONS**, payload conferido interceptando sendBeacon (agrupamento, LGPD, UTMs, sp=100, device desktop); UI com fetch mockado (lista, status, snippet com base canônica, funil, ranking, modal). ⚠️ Persistência real (upsert/stats com DB) só em produção: cadastrar LP de teste, instalar snippet e conferir stats.

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
| **Cron do follow-up worker** (worker existia, nada o chamava — follow-up com delay/sequência/expiração só saía pelo botão manual) | `.github/workflows/crm-followup-worker.yml` (`*/5 10-23 * * *` = 07h-20h BRT; secret GitHub `CRM_FOLLOWUP_URL` = URL completa com `?secret=<valor de REPORTS_CRON_SECRET>`). ⚠️ O `CRON_SECRET` da Vercel é *Sensitive* (write-only, ninguém lê o valor de volta) — por isso a rota aceita também `REPORTS_CRON_SECRET`/`CRM_CRON_SECRET` (legíveis). Validado em produção 2026-07-17: HTTP 200 `{"ok":true}` |
| **Mídia recebida renderiza** (antes só áudio era baixado; foto/vídeo/doc viravam texto "[Imagem]") | webhook `[instanceId]`: `mediaKind` audio/imagem/video/documento (sticker→imagem), caption vira 2ª mensagem `external_id:caption` +1s; `maxDuration=60` na rota; `extFromMimetype` ganhou pdf/docx/xlsx/webp/zip |
| **Rename/delete de etapa migra leads** (status é TEXTO; antes renomear coluna orfanava leads → sumiam do Kanban) | `crm/stages/[id]/route.ts` PUT/DELETE reescritos: UPDATE `crm_leads.status` antigo→novo no funil; delete move pra primeira etapa restante |
| **PUT de lead restrito ao id** (match extra por telefone cascateava edição/drag pra leads homônimos de OUTROS funis) | `crm/[id]/route.ts` — WHERE client_id+id apenas |
| **Lead manual não some mais** (filtro `numero ~ '^[0-9]{10,15}$'` cru escondia número formatado/vazio) | `crm/route.ts`: POST normaliza número (só dígitos→NULL se vazio); GET aceita sem número OU normalizado 8-15 dígitos |
| **Não-lidas de verdade** (era COUNT(*) histórico de 'in', nunca zerava) | coluna `crm_leads.chat_read_at` (ensureCrmConversationSchema); GET de messages marca lido (conversa na tela); inbox conta só `created_at > chat_read_at` |
| **Luna lê o CRM** (query usava colunas inexistentes name/phone/email → falha silenciosa desde sempre) | `agent/chat/route.ts` get_crm_data: `nome AS name, numero AS phone, email, origin, campaign_name, regiao_uf` + fallback sem colunas de rastreio |
| **Webhook canônico** (URL usava origin da request — acesso via preview/localhost re-apontava o webhook e matava o inbound) | `webhookOrigin()` em `evolution-api.ts` (env `APP_URL` ou `NEXT_PUBLIC_APP_URL`, fallback origin) aplicado nos 6 call sites de `setEvolutionWebhook`/`linkInstanceToClient`. **Configurar `APP_URL=https://reports.onmid.app` na Vercel** |
| **IA que muda status dispara conversões** (antes só o PUT manual chamava dispararEventosPorStatus — gap de atribuição) | `crm-ai-analysis.ts` após mover status: busca ctwa/valor e chama `dispararEventosPorStatus` (dedup interno evita duplicado) |

### IA do Kanban + chat "tempo real" (2026-07-17)

Os dois maiores incômodos históricos do CRM, corrigidos juntos:

| Correção | Onde |
|---|---|
| **IA não move mais lead pra etapa inexistente** (a lista oferecida à IA injetava etapas inventadas 'Novo'/'Proposta'/'Negociação'/'Perdido', e `normalizeStatus` tinha fallback `?? mapped` que aplicava QUALQUER texto alucinado → lead ganhava status órfão e sumia do Kanban) | `crm-ai-analysis.ts`: `loadStatusOptions` só etapas reais do funil + status atual; `normalizeStatus` retorna `null` se não casar (status atual mantido) |
| **UPDATEs da IA restritos ao id** (mesmo bug de match por telefone da Fase A, que sobrou no caminho da IA — contaminava leads homônimos de outros funis) | `crm-ai-analysis.ts`: 3 UPDATEs com `WHERE client_id AND id` apenas; `leadIdentityValues` sem numero |
| **Toda conversa aberta atualiza (3s)** — fim do corte de 3 dias (conversa antiga abria e congelava; lead respondia e a mensagem nunca aparecia) | `chat-view.tsx`: poll sempre ativo, 3s; badge "Arquivado" removido (tudo é "Ao vivo") |
| **Busca incremental** — poll usa `?after=<created_at da última>` e só traz mensagens novas; a cada 10 ticks (~30s) um refresh completo atualiza os checks ✓✓ das já exibidas (status muda em linha existente, o incremental não vê) | `messages/route.ts` GET aceita `after`; `loadMessages(leadId, initial, {incremental})` com merge dedup por id |
| **Envio otimista** — bolha aparece na hora com reloginho (pending); reload completo pós-resposta troca pela real; falha remove a bolha e mostra o erro | `chat-view.tsx` `doSend` |

- ⚠️ Sem preview local (chat exige DB+instância). Validado por tsc+build; a lógica de merge remove bolhas `temp-` quando a real chega pelo incremental (dedup por texto+direction). Validar em produção: abrir conversa antiga (>3d) e ver chegar mensagem sozinha; enviar e ver bolha instantânea.

Pendências conhecidas (Fases B/C futuras): rotas do CRM sem validação server-side (34 rotas — por isso o acesso do cliente é via portal por token, NUNCA login Visualizador); escala (DDL+full-scan de `ensureCrmMessagesSchema` em todo GET/poll de 8s, GET de leads sem paginação, pool novo por request); limite diário de IA é só aviso; código morto (`crm_contacts`+rotas, `ClientCrmTab` nunca montado, `crm/tags/[id]/assign`, branch `?since=`); polling 5s/8s e conversas >3d sem poll.

### Luna IA — agente completo: execução, cérebro do sistema, CRM profundo e agendamento (2026-07-20)

Reforma grande em 4 pacotes (aprovada pelo Matheus: "ela tem que ser possível agendar coisas"). **Arquitetura: as ferramentas saíram da rota pra `src/lib/luna-tools.ts`** (schemas em `systemTools` + executores em `execSystemTool`, ~2300 linhas) — a rota `agent/chat/route.ts` virou casca fina (241 linhas) e o agendador headless importa da mesma lib. Ferramenta nova = SEMPRE na lib, nunca na rota.

- **Pacote A (execução Meta+Google)**: `get_meta_structure` (conjuntos+anúncios com status/orçamento/gasto/leads canônicos — usar antes de agir), `execute_ad_action` (pausar/ativar/ajustar orçamento em campaign/adset/ad nos DOIS canais; reusa `executeOptimizerAction` de `optimizer-execucao.ts`; caso especial Meta CBO = orçamento na campanha via Graph direto; Google resolve MCC testando `listAccessibleCustomers` como `login-customer-id` e busca `campaign.campaign_budget` via GAQL pro mutate de budget), `duplicate_meta_campaign` (`/copies` deep_copy, cópia nasce PAUSADA).
- **Pacote C (cérebro)**: `get_optimizer_analysis` (última análise por plataforma de `optimizer_ai_logs`), `get_client_goals` (`client_goals`+`client_planning`), `get_lead_attribution`/`get_demographics` (HTTP interno pras rotas de tracking), `get_social_monitor` (snapshots), `get_ai_costs` (`ia_uso_mensal`).
- **Pacote B (CRM)**: `search_crm_leads` (nome/telefone/etapa/período), `get_lead_conversation` (mensagens de `crm_messages` por lead_id ou telefone), `move_crm_lead` (valida etiqueta REAL do funil — mesma lição da IA do Kanban — e dispara `dispararEventosPorStatus`), `get_crm_stats` (etapas reais + contagens + evolução 6m).
- **Pacote D (agendamento)**: tabela `luna_tasks` (once/daily/weekly/monthly, horários BRT, `next_run_at` UTC, `permitir_acoes`), tools `schedule_luna_task`/`list_luna_tasks`/`cancel_luna_task`, rota **`GET /api/agent/scheduler?secret=`** (aceita CRON_SECRET/REPORTS_CRON_SECRET/CRM_CRON_SECRET, `maxDuration=60`, máx 3 tarefas/tick com orçamento de 45s, falha recorrente adia +1h) que roda a Luna HEADLESS (loop próprio não-streaming, sonnet-4-6, 8 iterações, prompt "sem perguntas, formato WhatsApp") e entrega via Z-API (`zapi_clients` provider≠evolution). Allowlist headless: leitura+relatórios sempre; `execute_ad_action`/`update_meta_campaign_status`/`duplicate_meta_campaign`/`move_crm_lead` SÓ se `permitir_acoes=true`; usuários/pagamentos/cofre NUNCA. Cron: `.github/workflows/luna-scheduler.yml` a cada 15min — **secret GitHub necessário: `LUNA_SCHEDULER_URL`** (URL completa com `?secret=`, mesmo padrão dos demais). `computeNextRun` é pura e exportada — 20 asserts em teste transpilado (BRT fixo UTC-3, viradas de mês/ano, clamp dia 28).
- Prompt do chat ganhou 3 blocos: execução (orçamento/duplicar exigem confirmação; pausar/ativar direto), visão do sistema, agendamento (instrução autossuficiente + confirmar destino WhatsApp + regra do permitir_acoes).
- **Conexões Google sem filtro (2026-07-20, 3ª causa)**: mesmo com dev-token, o Google da Luna seguia mudo porque `lunaGoogleSearch` delegava ao `resolveGoogleToken` do optimizer-execucao, cujo fallback filtra `account_type='google_ads' OR scope ILIKE '%adwords%'` — as linhas reais de `google_connections` em produção não casam com esse filtro (token voltava nulo). O Radar funciona porque itera TODAS as conexões `status='connected'` SEM filtro. `lunaGoogleSearch` reescrita autossuficiente: `SELECT ... WHERE status='connected' ORDER BY connected_at DESC LIMIT 5` (sem filtro), refresh cru por conexão (`refreshGoogleTokenRaw`, expiry 5min, fallback pro access_token existente), e por token tenta login null → própria conta → acessíveis como MCC. ⚠️ O mesmo filtro suspeito segue no `resolveGoogleToken` do Otimizador (execução Google de lá pode ter o mesmo bug latente — conferir se a execução automática Google um dia falhar com "Token Google Ads não encontrado").
- **Developer token do Google (2026-07-20, causa raiz final)**: `lunaGoogleSearch` usava `GOOGLE_ADS_DEVELOPER_TOKEN ?? ''` — a env NÃO existe na Vercel, então a Luna mandava `developer-token` VAZIO e o Google recusava tudo (por isso o Google dela nunca funcionou, mesmo antes do refactor). Radar/Otimizador funcionam porque têm fallback embutido `?? '1vR8GhAk4UMZoPaqo7Qq8Q'` — aplicado o MESMO fallback na Luna. Regra: qualquer código novo que fale com Google Ads deve usar esse fallback (ou definir a env na Vercel de uma vez).
- **Google Ads da Luna consertado (2026-07-20)**: as ferramentas Google da Luna não retornavam nada mesmo com conta vinculada — usavam `googleapis.refreshAccessToken` (falha silenciosa, ver memória do projeto) e NUNCA mandavam `login-customer-id` (conta de agência sob MCC → PERMISSION_DENIED engolido). Correção: helper único `lunaGoogleSearch(customerId, query)` em `luna-tools.ts` — token via `resolveGoogleToken` (fetch cru + fallback, exportado de `optimizer-execucao`), tenta login null → própria conta → cada conta acessível como MCC (cache por processo em `gLoginCache`), retorna `{results, login}`. Usado por `get_google_campaigns`, `get_monthly_history` e o probe do `execute_ad_action` (que herda o `login` pro mutate). Filtros de vínculo aceitam `platform IN ('google_ads','google')`. Falha de acesso agora vira mensagem explícita pra Luna ("token/permissão MCC") em vez de "nenhuma campanha".
- **Relógio da Luna (2026-07-20)**: o prompt injetava só a DATA — pra "daqui a 30 minutos" a Luna chutava a hora pelo relógio UTC do servidor e errava o agendamento. Correção dupla: (1) prompt do chat E do scheduler agora injetam data+hora completas em America/Sao_Paulo (placeholder `{{AGORA}}`, com `replaceAll` — aparece 2x no prompt); (2) `schedule_luna_task` ganhou `em_minutos` (tempo RELATIVO calculado pelo SERVIDOR via `Date.now()+N*60_000`, clamp 30 dias — imune a erro de fuso da IA; prompt manda preferir em_minutos pra relativo e run_at só pra absoluto, avisando que o cron de 15min pode atrasar a execução).
- **Instância de envio ENGESSADA (2026-07-20, urgente)**: o agendador caía em "primeira instância Z-API ativa" e mandou mensagem pelo número errado. Agora TODO WhatsApp agendado sai por UMA instância fixa: `system_settings['luna_zapi_client_id']` (delegável no modal Agendamentos → "Instância de envio", PUT em `/api/agent/tasks`), com fallback pra instância de TESTE (`name ILIKE '%test%'`, provider≠evolution) quando não configurada, e **sem config nenhuma = NÃO envia** (nunca outra instância). `getLunaSendInstance()` em luna-tools é a fonte única; o `zapi_client_id` da tarefa é ignorado de propósito e saiu do schema do `schedule_luna_task` (prompt manda a Luna não perguntar instância, só o número). `schedule_luna_task` recusa agendar envio WhatsApp se não houver instância resolvível.
- **UI de agendamentos (2026-07-20)**: botão "Agendamentos" no header da Luna (`agente/page.tsx` → `TasksModal`) — lista tarefas com chips Ativa/Concluída/Cancelada + badge "Executa ações", expandir mostra instrução + histórico de execuções, botões Cancelar/Reativar/Excluir. API `/api/agent/tasks` (GET lista+runs, PATCH cancel/reactivate, DELETE apaga). Histórico persistente em `luna_task_runs` (task_id/ran_at/ok/result, CASCADE) gravado pelo scheduler a cada rodada — o `last_result` da tarefa só guarda a última. ⚠️ Lição: linha expansível NÃO pode ser `<button>` com botões de ação dentro (HTML inválido → hydration error) — usar `div role="button"`. UI verificada no preview com fetch mockado (3 estados + histórico + resultado expandido).
- ⚠️ Não verificável no preview (sem DB/OAuth/Anthropic) — tsc+build+teste de unidade ok. Validar em produção: perguntar estrutura de campanha, agendar tarefa de teste pra daqui 20min com WhatsApp e conferir a chegada.

### Luna IA — histórico mês a mês + datas custom (2026-07-20)

A Luna não conseguia responder "investimento/leads/CPL mês a mês de janeiro a julho" (as ferramentas só tinham presets de período; ela chamava 7x o mesmo tool e recebia o acumulado 7 vezes). Reforma em `agent/chat/route.ts`:

- **`get_monthly_history` (tool novo)**: `client_id + date_from + date_to` → UMA chamada devolve POR MÊS: Meta (investimento/leads/CPL/impressões/cliques via `time_increment=monthly` no insights level=account — 1 chamada Graph por conta pro intervalo inteiro), Google (GAQL `segments.month FROM customer`), e `crm_leads_novos` (COUNT de crm_leads por `date_trunc('month', created_at)`). Merge por mês com `investimento_total`/`cpl_geral` + campo `avisos` quando alguma fonte falha (best-effort, nunca 500).
- **`get_meta_campaigns`/`get_google_campaigns`**: ganharam `period='custom'` + `date_from`/`date_to` (os resolvers de `period-utils.ts` JÁ suportavam custom — só não era exposto no schema do tool).
- **Contagem de leads corrigida**: a Luna ainda usava a lista antiga `META_LEAD_ACTIONS` que SOMA aliases da mesma família (inflava leads 2-3x e derrubava o CPL — mesmo bug do countMetaResults já corrigido no resto do app). Trocada por `countMetaResults` (canônico: formulário + conversa iniciada, 1 por família).
- **Prompt de sistema**: bloco "Períodos e histórico mês a mês" (nunca dizer que não dá pra separar por mês; usar get_monthly_history; data de hoje em America/Sao_Paulo injetada pra interpretar meses relativos).
- ⚠️ Não verificável no preview local (sem DB/OAuth/Anthropic) — tsc+build ok. Validar em produção repetindo a pergunta da Monique First (Jan–Jul 2026 mês a mês).

### Modal do QR Code de conexão (2026-07-20)

⚠️ **Existem DOIS modais de QR no app** — reformar um não reforma o outro (o Matheus escaneou pelo segundo e viu o layout antigo sem confirmação):
1. **Disparos → Instâncias** (`disparos/page.tsx`) — status via `POST /api/disparos/clients/test` `{clientId}` → `{connected}`.
2. **Clientes → [id] → aba Rastreamento** (`clientes/[id]/tracking-tab.tsx`) — status via `GET /api/clients/[id]/tracking/instances/[instId]/status` → `{state}` (`'open'` = conectado; poll também atualiza `statuses` da lista). É o caminho apontado pelo chat do CRM quando a instância cai. Reformado em 2026-07-20 com o MESMO padrão (fases/poll 3s/countdown 40s/auto-close); caso extra: instância já conectada → connect não devolve base64 → cai direto na fase `success` se `statuses[inst.id]==='open'`.

Reforma do modal "Conectar WhatsApp" em Disparos → Instâncias (`disparos/page.tsx`) — antes o QR ficava aberto pra sempre sem detectar a leitura ("fica confuso e não sei", Matheus):

- **Detecção de conexão**: enquanto o QR está na tela, poll de 3s em `POST /api/disparos/clients/test` (rota já existia, nunca era consultada pelo modal). Conectou → fase `success` (check verde + "CONECTADO!" + nome da instância), atualiza `testResult` da lista (linha vira Online sem refresh) e **fecha sozinho em 2,5s**.
- **Erro** (QR não veio da Evolution): fase `error` com a mensagem real da API, botão "Tentar de novo" e fechamento automático em 5s.
- **Renovação automática**: countdown de 40s visível ("renova em Xs"); ao zerar, busca QR novo sozinho (QR da Evolution expira ~45s — antes exigia clique manual em "Atualizar QR", que foi removido).
- **Visual no design system**: faixa verde no topo, título Bebas uppercase, QR em moldura branca com 4 cantoneiras verdes angulares, dot pulsante "Aguardando leitura", passo a passo numerado (1-2-3) e nota "a tela fecha sozinha".
- Máquina de fases: `qrPhase: 'loading'|'qr'|'success'|'error'` + `qrSeconds`; um único `useEffect([qrClient, qrPhase])` gerencia poll/countdown/auto-close com cleanup. `qrLoading` foi removido.
- ✅ Verificado no preview com fetch mockado (3 fases + lista atualizando pra Online). A tela de sucesso dura 2,5s — screenshot remoto não pega; capturada via MutationObserver + reabertura com poll já conectado.

### Chat "cara de WhatsApp" — Fase 1 (2026-07-21)

Pedido do Matheus: replicar a experiência do WhatsApp no chat do CRM (contatos apareciam como número cru, sem foto, prévias vazando código PIX). Fase 1 entregue; Fases 2 (resposta citada, lightbox, player refinado — o check azul de lida JÁ existia) e 3 (digitando/online via presença, reações, fixar, busca na conversa) pendentes.

| Arquivo | Papel |
|---|---|
| `src/lib/evolution-api.ts` | `fetchEvolutionContacts` (POST `/chat/findContacts/{inst}` `{where:{}}` → number/pushName/profilePicUrl, grupos `@g.us` filtrados) + `fetchEvolutionProfilePic` (POST `/chat/fetchProfilePictureUrl`) |
| `src/app/api/crm/avatars/route.ts` | POST `{clientId}`: resolve instâncias Evolution do cliente (`client_zapi_instances`), puxa contatos e aplica nos leads — **nome só quando o lead está SEM nome real** (null/vazio/igual ao número; nunca sobrescreve nome digitado), **foto sempre atualiza** (URL da Meta expira; refresh a cada abertura = cache). Match por dígitos exatos + fallback sufixo de 8 (9º dígito BR). Retorna mapa `avatars` |
| `src/app/api/crm/inbox/route.ts` | Última mensagem agora traz `tipo` (`last_tipo` na resposta; fallback sem a coluna) pra prévia estilo WhatsApp |
| `chat-view.tsx` | `timeFmt` WhatsApp (hoje=HH:MM, "Ontem", dia da semana <7d, data), `formatPhoneBR` (+55 (43) 99177-9645 — usado como nome quando não há nome e no header), `inboxPreview` (📷 Foto/🎥/🎤 Mensagem de voz/📄 arquivo/📍/💳 Código PIX — regex `br.gov.bcb.pix` ou ≥25 dígitos), cartão de documento na bolha (ícone PDF + nome + ext; placeholder `[Doc] x.pdf` sem arquivo = "indisponível", com URL = clicável c/ Download), backfill automático no mount (POST `/api/crm/avatars` → merge avatares + reload do inbox se renomeou) |

- Separadores de data (Hoje/Ontem/data) e check azul de lida JÁ existiam — não recriar.
- ✅ Verificado no preview com fetch mockado: prévias, telefones formatados, horários, cartões de doc (com e sem arquivo), separadores, backfill disparando no mount. findContacts real exige produção — validar abrindo o chat de um cliente e conferindo nomes/fotos preenchidos.

**Inbox que anda sozinho — cura de webhook + sync de reserva (2026-07-22):**
- Sintoma em produção (Sorrifácil ingleses): inbox só atualizava clicando "Carregar mais conversas" e horários presos em "quinta" — o webhook da instância estava apontado pra URL antiga (preview), então NADA chegava via push; o botão funciona porque puxa direto da Evolution (`POST /api/crm/inbox`).
- **`/api/crm/webhook-heal`** (POST `{clientId}`): pra cada instância Evolution ativa do cliente, `getEvolutionWebhook` (GET `/webhook/find/{inst}`, novo em evolution-api.ts) compara a URL configurada com a canônica `${webhookOrigin()}/api/webhook/whatsapp/{row.id}` e reaponta via `setEvolutionWebhook` quando diferente/desabilitada. Skip se origin não canônica/localhost (dev não pode "curar" pra URL errada). Chamado pelo chat-view ao abrir o chat — mesma ideia do re-set que a aba Rastreamento já fazia no poll de status, agora no caminho que o usuário realmente usa.
- **Sync de RESERVA no chat-view**: com a aba visível, a cada 60s (primeira em 5s + ao voltar pra aba via `visibilitychange`) faz `POST /api/crm/inbox {limit:60}` (import silencioso da Evolution) + `loadInbox()` — o inbox anda sozinho MESMO se o webhook cair de novo entre curas. Guard `document.visibilityState === 'visible'` (⚠️ no preview o browser pane reporta `hidden` — forçar com `Object.defineProperty(document,'visibilityState',{get:()=>'visible'})` pra testar).
- ✅ Verificado no preview mockado: heal dispara no mount, sync dispara e a mensagem nova aparece sozinha na lista. Em produção, abrir o chat do cliente afetado já deve reapontar o webhook (conferir log `[chat] webhook reapontado`).

**Fase 2 (2026-07-21) — resposta citada, lightbox, ✓✓ na prévia:**
- **Resposta citada**: `NormalizedMessage` ganhou `quotedText` — Evolution extrai de `contextInfo.quotedMessage` (o contextInfo mora DENTRO do tipo de mensagem — extendedTextMessage/imageMessage/… — ou na raiz; busca no primeiro que tiver; o quotedMessage tem o shape de mensagem normal, então reusa `extractEvolutionText` → "[Imagem]" etc.); Z-API lê `referenceMessage.message`. Coluna `crm_messages.reply_to_text` (ensure schema; webhook grava `.slice(0,500)` nos dois INSERTs), GET de messages retorna no tier principal (fallback sem a coluna fica sem citação, gracioso). Bolha renderiza bloco com borda esquerda primary acima do conteúdo. Só RECEBIMENTO — enviar citando fica pra depois.
- **Lightbox**: clique em imagem da conversa abre overlay fullscreen (z-[60], fechar no X/backdrop, botão de abrir original). `MessageBubble` ganhou prop `onImageClick`.
- **✓✓ na prévia do inbox**: rota inbox devolve `last_status` (whatsapp_status da última mensagem) e a lista mostra CheckCheck antes da prévia quando a última é `out` (azul #53BDEB se read, cinza senão) — substituiu o prefixo "Você:".
- ✅ Verificado no preview mockado: citação nos dois lados, lightbox abre/fecha, checks azul/cinza na lista. Citação REAL depende do webhook em produção (mandar uma resposta citada no WhatsApp e conferir o bloco).

### Kanban denso + visão padrão (2026-07-19)

Reforma de densidade do funil (reclamação do Matheus: "box grandes demais, pouco espaço para ver o lead") em `crm/page.tsx`:

- **Kanban é SEMPRE a visão padrão** ao entrar no CRM: `viewMode` inicia `'kanban'` fixo; a persistência em `localStorage('crm:view-mode')` foi removida (toggle pra Lista vale só na sessão).
- **Stats viraram uma faixa única** (leads no funil / comprou / faturamento + frio/morno/quente com dots coloridos, ~48px) no lugar dos DOIS grids de cards de 92px — o espaço vertical é do funil.
- **Card compacto (~73px, era ~150px)**: linha 1 nome+valor, linha 2 número+data, linha 3 pills mínimas (canal, rastreio Meta/UTM, tag IA, Interno/follow-up/Fechou em text-[8px]). **Temperatura = borda esquerda colorida de 3px** (frio azul/morno âmbar/quente vermelho, title no hover) em vez de pill. Ações (time interno + menu ⋮) viraram overlay absoluto que só aparece no hover — não gastam altura.
- **Colunas 232px** (era 255px) com cabeçalho de UMA linha (label+count+R$ total inline) e corpo `flex-1` com scroll interno: o wrapper do Kanban é `overflow-hidden` e o `KanbanView` `h-full items-stretch` — as colunas esticam até o fim da viewport (antes: `maxHeight: calc(100vh-400px)` fixo). Scroll vertical é POR COLUNA; horizontal no board.
- DnD (dnd-kit) intocado — só classes/estrutura visual.
- ✅ Verificado no preview com fetch mockado (24 leads, 6 etapas): densidade ~2x, colunas cheias, lista intacta, stats corretos. ⚠️ No preview, mock de `window.fetch` no mundo isolado quebra o fetch RSC do Next (`input.url` undefined → "Falling back to browser navigation") — navegação SPA vira MPA e derruba o mock; validar sempre re-injetando após o load e disparando `window.dispatchEvent(new Event('clients-updated'))` pra recarregar clientes sem remount.

### Histórico mensal de custo de IA (2026-07-19)

Aba "Uso IA" em Configurações reformada pra virar histórico navegável por mês — feita pra REPASSAR o custo ao cliente (pedido do Matheus: "ver até de meses anteriores").

- **Fonte de dados inalterada**: `GET /api/crm/ai/usage` já devolvia TODOS os meses de `ia_uso_mensal` (client_id, mes_ano 'YYYY-MM', chamadas, tokens, custo USD) — o problema era só a UI, que somava tudo misturado e não mostrava R$.
- **UI nova** (bloco IIFE dentro da aba `'ia'` em `configuracoes/page.tsx`; estado `aiMonth`, '' = mês mais recente): card "Evolução mensal" com barras clicáveis por mês (valor em R$ embaixo de cada barra), 3 KPIs do mês selecionado (chamadas / tokens / custo em **R$** com US$ entre parênteses), tabela "Custo por cliente · mês" ordenada por custo desc com colunas Custo US$ + **Custo R$** e linha "Total do mês", seletor `<select>` de mês, botão **Exportar CSV** (client-side blob, separador `;`, BOM UTF-8, decimal com vírgula — abre direto no Excel BR, nome `custo-ia-YYYY-MM.csv`).
- Conversão pelo `USD_TO_BRL` de `@/lib/ai-usage-config` (módulo puro, importável no client). Câmbio de referência exibido no card.
- Card "Saldo e alertas das IAs" (billing) ficou intocado acima do histórico.
- ✅ Verificado no preview com fetch mockado multi-mês (mai/jun/jul): barras com totais certos, troca de mês pelo select e pela barra, cliente que só existe num mês aparece só nele, totais batem. Obs: a área de conteúdo do shell rola num container interno (`div.flex-1.min-h-0`), não no window — scripts de scroll no preview precisam mirar esse elemento.

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

## Radar — tabela com cabeçalho fixo (2026-07-20)

Tabela principal de `/resultados` (`resultados/page.tsx`) ganhou header fixo (pedido do Matheus: em prints da tela, o nome das colunas sumia ao rolar e as métricas ficavam soltas).

- **Scroll interno único** (`max-h-[65vh] overflow-auto` num só div) em vez do antigo `overflow-x-auto` isolado envolvendo a tabela. **Motivo**: por spec do CSS, `overflow-x:auto` força `overflow-y` a computar como `auto` também mesmo sem declarar — isso faz esse div virar seu próprio scroll container vertical (mesmo nunca precisando rolar, já que sua altura é intrínseca ao conteúdo), e o `position:sticky` do thead passa a resolver contra ESSE container (que nunca rola de fato) em vez do scroll real da página → o header "sticky" simplesmente não gruda em nada. Unificar x+y num único `overflow-auto` com altura limitada elimina a ambiguidade: o mesmo div é o scroll container de verdade, então o sticky funciona.
- **`sticky top-0 z-10 bg-card`** em cada `<th>` (não no `<thead>` — sticky em `thead`/`tr` como grupo tem suporte inconsistente entre navegadores; em `<th>` individual é universal). Fundo **opaco** (`bg-card`, mesma cor do container) é obrigatório — um fundo translúcido tipo `bg-muted/20` deixaria as linhas por baixo "vazando" por trás do header ao rolar.
- Borda inferior do header via pseudo-elemento `after:absolute after:inset-x-0 after:bottom-0 after:border-b` (sticky conta como "positioned" pro CSS, então o `after:absolute` resolve contra o próprio `<th>` sem precisar de `relative` extra).
- Tabela agora tem scroll interno limitado a 65% da viewport em vez de esticar a página inteira — nada abaixo dela (não há paginação/rodapé na tabela), então não escondeu nada.
- ✅ Verificado no preview com 25 clientes mockados: rolando o container interno, o header (CLIENTE/META/RESULTADO/...) permanece fixo no topo enquanto as linhas (ex: "Jato Moto", "Kali Estúdio") passam por baixo.

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
