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
| `src/app/(dashboard)/otimizador/page.tsx` | UI — fila de decisão com `DecisionCard` (1 card visível por vez), modal config, aprovações |
| `src/app/(dashboard)/configuracoes/page.tsx` | Aba "Otimizador" — config WhatsApp global (admin) |

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
| `src/app/api/leadlovers/campaigns/[id]/activate/route.ts` | POST — pré-computa `next_send_at` para cada contato |
| `src/app/api/leadlovers/worker/route.ts` | POST — envia contatos com `next_send_at <= NOW()` (frontend poll + cron) |
| `src/app/(dashboard)/integracoes/leadlovers/page.tsx` | UI com 4 abas: Upload, Webhook, Cronograma, Painel |

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

---

## Instruções para o Claude

- Ao final de cada sessão, atualize este arquivo com decisões novas, tecnologias adicionadas ou mudanças importantes feitas hoje.
- Sempre use Sonnet 4.6 para raciocínio e Haiku 4.5 para tarefas simples.
