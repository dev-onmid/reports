@AGENTS.md

# ONMID Reports — Guia de Contexto

Plataforma de inteligência de marketing da agência ONMID: ingere Meta Ads, Google Ads, WhatsApp, e-mail e CRM, gera relatórios com IA e opera CRM, disparos e automações dos clientes.

## Histórico por setor — LEIA ANTES DE MEXER NO ASSUNTO

O histórico completo de decisões, bugs e armadilhas (antes neste arquivo) está em `docs/historico/`. **Antes de trabalhar num setor, leia o arquivo dele** — é lá que está o "por que é assim" e o que já deu errado. Na dúvida sobre um detalhe, procure com `grep -ri "<termo>" docs/historico/`.

| Vai mexer em… | Leia |
|---|---|
| CRM: chat, Kanban, IA que move etapa, follow-up, tags, lembretes, discador, acessos/perfis do cliente (crm.onmid.app), aba Atendimento, rotina de avaliação do atendimento (VPS `/opt/onmid-rotina`) | `docs/historico/crm.md` |
| Dashboard, Funil de Performance, Mídia paga, faturamento por canal, metas, planejamento, tipo de dashboard, food/delivery, editor de modelo, Início | `docs/historico/dashboard-funil.md` |
| Agendor, Datalytics, SULTS, importação de planilha e Google Sheets (de-para de colunas), cruzamento/identidade de lead, ClickUp, Leadlovers | `docs/historico/integracoes-crm.md` |
| Rastreio de leads (UTM, gclid, CTWA, `/r/`), conversões Meta/Google, formulários Meta (leadgen), aviso de lead no grupo do cliente, seção Landing page/GA4, Radar e Mapa de Calor de LP, Bibliotecas de Criativos/Anúncios | `docs/historico/rastreio-atribuicao.md` |
| WhatsApp/Evolution/Z-API, Disparos, etiquetas, Fidelidade, alertas de instância e Webshare | `docs/historico/whatsapp-disparos.md` |
| Luna IA, custo/cache de IA, Histórico de otimizações, resumo diário das contas (Otimizador foi removido) | `docs/historico/luna-ia-otimizacao.md` |
| Mexer direto em conta Google/Meta de cliente (CondoStore, Romanza, Sorrifácil, Incorpast, Londrigifts, Odonto First, Empas, Adriano…), rotina de termos do Google | `docs/historico/campanhas-clientes.md` + a ficha do cliente na memória |
| Pagamentos, alerta de saldo | `docs/historico/pagamentos-alertas.md` |
| Relatórios (gerador, PDF, mensal, período longo), Radar, Monitor de Redes Sociais | `docs/historico/relatorios-radar.md` |
| Publicações IG/FB, Sorteador, Biblioteca Meta, Formatos de Criativos, assets do cliente | `docs/historico/publicacoes-ferramentas.md` |
| Deploy/VPS, autenticação, tema claro, responsividade, mobile, tela do cliente, Reuniões/TLDV, Painel de Rotinas, quedas do sistema | `docs/historico/app-infra-clientes.md` |

**Ao terminar um trabalho, registre a decisão/armadilha nova no arquivo do setor** (no topo, com data), NUNCA neste arquivo. Este arquivo só muda para regra que vale para o sistema inteiro — mantê-lo curto é o que deixa toda sessão barata.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript strict · Tailwind v4 + shadcn/ui (`base-nova`) · PostgreSQL via `pg` (`src/lib/server-db.ts`) · Anthropic SDK · Recharts / React Grid Layout · pdf-lib / html2canvas · xlsx · Evolution API (principal) + Z-API (interno) · googleapis.

⚠️ **Esta versão do Next tem breaking changes** — leia o guia em `node_modules/next/dist/docs/` antes de escrever código Next. Ex.: o middleware se chama **`src/proxy.ts`** (arquivo `middleware.ts` é ignorado em silêncio).

## Produção, deploy e cron

- **Produção é a VPS** (`root@2.25.144.71`, container docker `onmid-reports`, compose em `/opt/onmid-reports/`, Traefik do Coolify). Saímos da Vercel em 13/08/2026 — referências a "Vercel Hobby 10 s" no código/histórico são legado.
- **Banco também está na VPS** (container `onmid-reports-db`, desde 17/09/2026). Diagnóstico: `ssh root@2.25.144.71 'docker exec -i -w /app onmid-reports node -' < script.cjs` (o `-w /app` é obrigatório para o `pg` resolver).
- Deploy: build no GitHub Actions (`build-image.yml`) → imagem na VPS. O workflow só publica sozinho a partir de `main`. Sessões paralelas podem sobrescrever o deploy uma da outra.
- **Cron mora na crontab da VPS** (linhas marcadas `# onmid-cron`). O GitHub Actions throttleia os crons deste repo — não confiar nele para cadência. Cron novo: (1) linha na crontab da VPS com `flock`, (2) prefixo da rota em `CRON_PREFIXES` do `proxy.ts`, senão toma 401 do proxy.
- Rota chamada por cron **nunca roda DDL sem memoização** (`ALTER TABLE ... IF NOT EXISTS` pede lock exclusivo mesmo no-op e já derrubou o CRM).

## Autenticação

- Sessão = cookie assinado `onmid_session` (HMAC com `SESSION_SECRET`), validado em `src/proxy.ts`, que nega `/api/*` por padrão e **sobrescreve `x-onmid-user-id`/`x-onmid-role`** a partir do cookie.
- `PUBLIC_PREFIXES` (rotas sem login) é decisão de segurança. Chamada servidor→servidor precisa de `internalHeaders()`.
- Roles `Administrador`/`Usuário`/`Visualizador`; teams `onmid`/`parceiro` (parceiro só vê o que é do próprio owner, via `getCallerScope`). Flags de permissão por tela; falha de permissão fecha (não libera).

## Regras que valem sempre

**Código**
- Banco só server-side (`server-db.ts`). Navegação só em `src/lib/nav-items.ts`. Alias `@/*` → `src/*`. Moeda BRL.
- WhatsApp: instância de cliente é **Evolution**; Z-API é só interno. Enviar por `src/lib/whatsapp-send.ts` (ramifica por `zapi_clients.provider`), nunca `zapi.sendText` cru.
- Datas/horários de negócio em **America/Sao_Paulo**. Data `YYYY-MM-DD` vira data LOCAL, nunca `new Date('YYYY-MM-DD')` (UTC joga um dia para trás).
- Métrica sem denominador mostra `—`, nunca `0%`/`R$ 0,00`.
- Texto/JSON que vai para o banco passa por `sanitizeJsonValue` (surrogate órfão de emoji derruba o INSERT); truncar texto por code point (`Array.from`), não por `slice`.
- Antes de criar rota/componente, conferir se o histórico (`git log`, `docs/historico/`) já tem a feature.
- Ler o histórico do setor e conferir no DADO real antes de afirmar causa — vários diagnósticos registrados estavam errados por presumir.

**Meta Ads**
- Nunca somar `action_types` de resultado: usar `countMetaResults` (1 canônico por família). Somar infla 2–3×.
- Campanha de tráfego se mede por clique/CPC, não por conversão.
- Erro de lead ads "Termos não aceitos" (1815089) via API = conferir escopo `pages_manage_ads` antes de culpar a Página.

**Google Ads**
- Token: fetch cru do OAuth com fallback (espelhar `report-builder`), nunca `googleapis.refreshAccessToken`. Developer token tem fallback embutido no código; contas de cliente via `login-customer-id` do MCC `9453880405`.
- **Negativas são literais: deduplicar só por texto EXATO, nunca normalizando acento** (já apagou negativas em silêncio 3 vezes). Só a checagem de conflito negativa × keyword ignora acento — e ela é obrigatória antes de negativar.
- Ler `policy_summary` do anúncio ANTES de trocar URL/texto (trocar reabre a revisão e apaga o motivo). Reescrever com o mesmo texto não limpa reprovação.
- UTMs pelo `final_url_suffix`, nunca `tracking_url_template` com `{_param}`.
- Keyword de saúde costuma exigir isenção `HEALTH_IN_PERSONALIZED_ADS` — enviar 1 operação por vez para pegar a `policyViolationDetails.key`.
- Verba: teto diário = saldo ÷ dias até o próximo aporte; nunca aumentar sem esse cruzamento.

**Dados de lead/CRM**
- Rastreio/origem é soberano (só preenche vazio); estado (status, valor) segue a fonte mais nova; booleanos de funil só avançam. Identidade de lead pela régua única `src/lib/lead-identity.ts`.
- Receita só de negócio GANHO, no mês do ganho. `valor_negocio` (estimativa) nunca vira receita.
- Telefone BR: normalizar com e sem o nono dígito; LID (`@lid`) nunca vira telefone.
- Retroativo (backfill, lote de IA, recuperação de lead) **nunca dispara follow-up nem conversão** para Meta/Google.
- Mudar critério de filtro de integração exige refazer o backfill.

**IA**
- Modelos: o mais capaz para raciocínio, o leve para tarefa simples; custo logado em `ai-usage-logger.ts`. Nada dinâmico (data/hora) dentro do bloco de prompt cacheado.

## Estrutura

`src/app/(dashboard)/*` telas autenticadas · `src/app/api/*` rotas · `src/app/relatorio/[token]` e `src/app/portal/[token]` públicos por token · `src/app/r/[slug]` redirecionador com rastreio · `src/components/*` · `src/lib/*` (lógica; libs puras são testáveis com esbuild + node em `scratchpad/`).

## Design System

Dark-first (fundo `#0e0f14`), CTA único verde `#55f52f`, secundária `#7b2cff`, Bebas Neue (títulos) + Inter. Detalhes em `DESIGN_SYSTEM.md` — mas o dashboard real (cards `#0d1519`, `rounded-[14px]`) é a referência quando divergir.

## Verificação

- Sem banco local, a UI se testa no Browser pane com `fetch` mockado (login mockado nas rotas de auth) ou bundle esbuild isolado; ver a receita em `docs/historico/app-infra-clientes.md` e na memória.
- Só afirmar "funciona em produção" com prova de produção.
