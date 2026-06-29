# Otimizador v2.0 — Especificação Completa

**Versão:** 2.0  
**Data:** junho/2026  
**Cadência:** 1 análise por semana por cliente, distribuída em rodízio pelos 5 dias úteis  
**Compatível com:** Meta Ads (Graph API própria) + Google Ads  
**Modos:** Diagnóstico / Recomendação com aprovação / Automático parcial / Automático total  
**Notificações:** Relatório em texto enviado para grupo WhatsApp (configurável em Configurações, acesso admin)

---

## 1. Visão Geral

O Otimizador v2.0 substitui a análise por campanha individual (v1.0) por uma **análise por conta completa**, feita uma vez por semana. A IA recebe todos os dados já coletados e organizados, interpreta, diagnostica e — dependendo do modo configurado para o cliente — executa ações diretamente nas APIs sem precisar de aprovação manual.

**Princípio central:** a IA nunca busca dados. Ela recebe o payload pronto e entrega JSON estruturado com diagnóstico + decisões.

---

## 2. Modos de Operação por Cliente

Cada cliente tem um modo configurado pelo gestor. O modo define o que acontece após a IA retornar a análise.

| Modo | O que acontece |
|---|---|
| `DIAGNOSTICO_APENAS` | IA analisa e exibe no painel. Nenhuma ação é executada ou sugerida para aprovação. |
| `RECOMENDACAO_COM_APROVACAO` | IA propõe ações. Gestor vê no painel e clica em "Aplicar", "Marcar feita" ou "Recusar". |
| `AUTOMATICO_PARCIAL` | IA executa ações que estão na lista pré-aprovada do cliente. O restante vai para aprovação manual. |
| `AUTOMATICO_TOTAL` | IA executa qualquer ação dentro dos limites globais definidos, sem precisar de aprovação. |

O modo padrão para clientes novos é `RECOMENDACAO_COM_APROVACAO`.

---

## 3. Cadência, Rodízio e Trigger

### 3.1 Rodízio pelos dias úteis

Cada cliente é atribuído a um dia da semana (1=segunda a 5=sexta). O cron roda todo dia útil às 07h BRT, mas processa apenas os clientes do dia. Resultado: todos têm análise semanal, sem concentrar tudo numa segunda-feira.

| Segunda | Terça | Quarta | Quinta | Sexta |
|---|---|---|---|---|
| Clientes do grupo 1 | Clientes do grupo 2 | Clientes do grupo 3 | Clientes do grupo 4 | Clientes do grupo 5 |

**Atribuição do dia:** feita automaticamente ao cadastrar/ativar o cliente no otimizador, distribuindo para o dia com menos clientes no momento. O gestor pode alterar manualmente em `optimizer_client_config.analise_dia_semana`.

**Cron:** `0 10 * * 1-5` (todo dia útil, 07h BRT = 10h UTC). O weekly route filtra pelo `analise_dia_semana = EXTRACT(DOW FROM NOW())` (onde 1=seg, 5=sex no padrão PostgreSQL ajustado).

### 3.2 Cache e proteção

- **Cache:** se já existe análise gerada nos últimos 7 dias e os dados não variaram mais de 10%, retorna cache sem chamar a IA.
- **Proteção contra reprocessamento:** uma análise IA por cliente por semana, mesmo em chamada manual, a não ser que o admin force (`force_ai: true`).
- **Manual:** admin pode disparar análise de qualquer cliente a qualquer momento pelo painel, ignorando o dia de rodízio.

---

## 4. Coleta de Dados (antes da IA)

O sistema monta o payload em etapas sequenciais antes de qualquer chamada à IA. Tudo via Graph API própria com `getFreshMetaToken`.

### 4.1 Dados já disponíveis (sem mudança)

| Dado | Fonte |
|---|---|
| Campanhas ativas com métricas | `GET /api/campaigns` |
| Planejamento do cliente (CPL meta, orçamento) | `GET /api/clients/[id]/planning` |
| Histórico de análises anteriores | `optimizer_ai_logs` (PostgreSQL) |

### 4.2 Dados novos a coletar

| Dado | Endpoint Graph API | Rota interna a criar |
|---|---|---|
| Conjuntos de anúncios por campanha | `GET /{campaign-id}/adsets?fields=id,name,status,daily_budget,optimization_goal,targeting` | Inline no daily/weekly route |
| Anúncios com métricas por conjunto | `GET /{adset-id}/ads?fields=id,name,status,creative,insights` | Já existe: `/api/meta/adsets/[id]/ads` |
| Rankings de relevância por anúncio | `GET /{ad-id}?fields=quality_ranking,engagement_rate_ranking,conversion_rate_ranking` | Nova: `/api/meta/ads/[id]/relevance-rankings` |
| Opportunity Score da conta | `GET /{ad-account-id}/recommendations` | Nova: `/api/meta/accounts/[id]/opportunity-score` |

### 4.3 Dados opcionais (best-effort)

- **CTR trend dos últimos 4 dias:** calculado pelo sistema comparando métricas do período `last_4d` vs `last_7d` — sem endpoint novo, usando `/api/campaigns` com períodos diferentes.
- **Histórico de criativos vencedores/perdedores:** lido do campo `observacoes_gestor` do planejamento do cliente, que o gestor pode preencher manualmente.

---

## 5. Payload Enviado para a IA

O payload v2.0 é montado pelo sistema antes da chamada ao Claude. Estrutura:

```typescript
type OptimizerPayloadV2 = {
  // Identidade
  cliente_id: string;
  cliente_nome: string;
  nicho: OptimizerNiche;
  modo_operacao: 'DIAGNOSTICO_APENAS' | 'RECOMENDACAO_COM_APROVACAO' | 'AUTOMATICO_PARCIAL' | 'AUTOMATICO_TOTAL';
  semana_analise: string; // ex: "2026-W26"

  // Metas do cliente (do planejamento)
  metas: {
    objetivo_principal: OptimizerObjective;
    cpl_ideal: number | null;
    cpl_maximo: number | null;
    roas_minimo: number | null;
    orcamento_diario_total: number | null;
    orcamento_mensal_total: number | null;
    volume_leads_meta_mensal: number | null;
    ticket_medio: number | null;
    ciclo_venda_dias: number | null;
  };

  // Limites globais (para modos automáticos)
  limites_globais: {
    orcamento_diario_maximo_conta: number | null;
    cpr_emergencia: number | null;
    min_conjuntos_ativos: number;
    max_conjuntos_ativos: number;
    min_dias_aprendizado: number; // padrão: 7
  };

  // Ações pré-aprovadas (para AUTOMATICO_PARCIAL)
  acoes_pre_aprovadas: string[]; // ex: ['pausar_conjunto', 'pausar_anuncio', 'reduzir_orcamento']

  // Dados da conta
  periodo_analise: {
    data_inicio: string;
    data_fim: string;
    dias: number;
  };

  opportunity_score: {
    score: number | null;
    recomendacoes: Array<{
      tipo: string;
      ganho_score: number;
      descricao: string;
    }>;
  } | null;

  campanhas: Array<{
    id: string;
    nome: string;
    objetivo: string;
    status: string;
    orcamento_diario: number | null;
    gasto: number;
    impressoes: number;
    cliques: number;
    ctr: number;
    cpl: number | null;
    conversoes: number;
    roas: number | null;
    dias_rodando: number | null;

    conjuntos: Array<{
      id: string;
      nome: string;
      status: string;
      objetivo_otimizacao: string;
      tipo_publico: string;
      orcamento_diario: number | null;
      gasto: number;
      impressoes: number;
      alcance: number | null;
      frequencia: number | null;
      ctr: number;
      cpl: number | null;
      conversoes: number;
      ctr_tendencia_4d: 'SUBINDO' | 'CAINDO' | 'ESTAVEL' | null;
      dias_ativo: number | null;

      anuncios: Array<{
        id: string;
        nome: string;
        status: string;
        gasto: number;
        impressoes: number;
        ctr: number;
        cpl: number | null;
        conversoes: number;
        dias_ativo: number | null;
        quality_ranking: 'ABOVE_AVERAGE' | 'AVERAGE' | 'BELOW_AVERAGE_10' | 'BELOW_AVERAGE_20' | 'BELOW_AVERAGE_35' | null;
        engagement_ranking: 'ABOVE_AVERAGE' | 'AVERAGE' | 'BELOW_AVERAGE_10' | 'BELOW_AVERAGE_20' | 'BELOW_AVERAGE_35' | null;
        conversion_ranking: 'ABOVE_AVERAGE' | 'AVERAGE' | 'BELOW_AVERAGE_10' | 'BELOW_AVERAGE_20' | 'BELOW_AVERAGE_35' | null;
      }>;
    }>;
  }>;

  // Memória de ações anteriores (últimas 4 semanas)
  historico_decisoes: Array<{
    semana: string;
    acao_executada: string;
    resultado: string;
  }>;

  // Observações do gestor
  observacoes_gestor: string | null;
};
```

---

## 6. Saída da IA (JSON)

A IA retorna um JSON com 7 campos raiz:

```typescript
type OptimizerOutputV2 = {
  estado_da_conta: 'SAUDAVEL' | 'ATENCAO' | 'CRISE';
  resumo_executivo: string; // 3-5 linhas diretas para o gestor

  cruzamento_com_metas: {
    cpl_atual: number | null;
    cpl_ideal: number | null;
    cpl_maximo: number | null;
    status_cpl: 'DENTRO' | 'ATENCAO' | 'CRITICO' | 'NAO_APLICAVEL';
    volume_conversoes_atual: number;
    volume_meta_projetada: number | null;
    status_volume: 'NO_RITMO' | 'ABAIXO' | 'CRITICO' | 'NAO_APLICAVEL';
    gasto_total: number;
    orcamento_periodo: number | null;
    status_orcamento: 'OK' | 'ESTOURANDO' | 'SUBENTREGANDO';
  };

  conjuntos: Array<{
    id: string;
    nome: string;
    classificacao: 'SAUDAVEL' | 'ATENCAO' | 'URGENTE';
    diagnostico: string;
    acao_recomendada: string;
  }>;

  anuncios: Array<{
    id: string;
    nome: string;
    conjunto_nome: string;
    problema: 'QUALIDADE' | 'ENGAJAMENTO' | 'CONVERSAO' | 'FADIGA' | 'OK';
    diagnostico: string;
    acao_recomendada: string;
  }>;

  recomendacoes: Array<{
    titulo: string;
    urgencia: 'FAZER_AGORA' | 'PROXIMA_SEMANA' | 'QUANDO_POSSIVEL';
    impacto_estimado: string;
    como_fazer: string;
    risco: string;
  }>;

  acoes_automaticas: Array<{
    acao: 'PAUSAR' | 'ATIVAR' | 'AJUSTAR_ORCAMENTO';
    objeto_tipo: 'campaign' | 'adset' | 'ad';
    objeto_id: string;
    objeto_nome: string;
    parametros: Record<string, unknown>; // ex: { novo_orcamento_diario: 150 }
    justificativa: string;
    status_execucao: 'EXECUTAR_AGORA' | 'AGUARDAR_APROVACAO';
  }>;

  confianca: 'alta' | 'media' | 'baixa';
  observacao: string | null;
};
```

**Regra da IA:** ela só coloca `EXECUTAR_AGORA` em `status_execucao` se a ação estiver na lista `acoes_pre_aprovadas` do payload. Caso contrário, coloca `AGUARDAR_APROVACAO` independente do modo.

---

## 7. Pós-análise — O que o sistema faz com o JSON

```
IA retorna JSON
       │
       ▼
modo == DIAGNOSTICO_APENAS?
  → Salva no banco → Exibe no painel → Fim
       │
       ▼
modo == RECOMENDACAO_COM_APROVACAO?
  → Salva no banco → Exibe recomendações no painel com botões → Gestor decide → Fim
       │
       ▼
modo == AUTOMATICO_PARCIAL ou AUTOMATICO_TOTAL?
  → Para cada acao em acoes_automaticas:
      se status_execucao == EXECUTAR_AGORA:
        → Chama rota interna de execução
        → Registra em optimizer_execucoes_automaticas
      se status_execucao == AGUARDAR_APROVACAO:
        → Salva como pendente → Exibe no painel para aprovação manual
  → Envia resumo executivo por notificação (futuro)
```

---

## 8. Banco de Dados

### 8.0 Configurações globais do otimizador (WhatsApp + sistema)

Armazenadas na tabela `system_settings` (existente ou nova), chave-valor, acessível apenas por admins.

```sql
-- Chaves relevantes para o otimizador:
-- otimizador_whatsapp_zapi_client_id  → ID do registro em public.zapi_clients (provider = 'evolution')
-- otimizador_whatsapp_group_jid       → JID do grupo (ex: "120363XXXXXXXX@g.us")
-- otimizador_whatsapp_ativo           → "true" | "false"
-- otimizador_notificar_crise_apenas   → "true" = só envia se estado_da_conta = CRISE
```

**Infraestrutura usada:**
- Instâncias: `SELECT id, name, instance_id FROM public.zapi_clients WHERE provider = 'evolution'`
- `instance_id` é o `instanceName` usado nas chamadas `sendEvolutionText(instanceName, groupJid, text)`
- Grupos disponíveis: `GET /group/fetchAllGroups/{instanceName}` direto na Evolution API (nova rota interna: `GET /api/otimizador/whatsapp-groups?zapiClientId=...`)
- Envio: `sendEvolutionText` de `src/lib/evolution-api.ts` — já aceita JID de grupo como `number`

**Fluxo de configuração (admin em Configurações):**
1. Admin seleciona a instância Evolution (dropdown filtrado por `provider = 'evolution'`)
2. Sistema lista os grupos dessa instância via Evolution API
3. Admin seleciona o grupo destino
4. Salva JID do grupo + ID da instância nas `system_settings`

### 8.1 Tabelas novas

**`optimizer_client_config`** — configuração por cliente
```sql
CREATE TABLE IF NOT EXISTS public.optimizer_client_config (
  client_id TEXT PRIMARY KEY,
  modo_operacao TEXT NOT NULL DEFAULT 'RECOMENDACAO_COM_APROVACAO',
  acoes_pre_aprovadas TEXT[] NOT NULL DEFAULT '{}',
  orcamento_diario_maximo NUMERIC,
  cpr_emergencia NUMERIC,
  min_conjuntos_ativos INTEGER NOT NULL DEFAULT 1,
  max_conjuntos_ativos INTEGER NOT NULL DEFAULT 20,
  min_dias_aprendizado INTEGER NOT NULL DEFAULT 7,
  analise_dia_semana INTEGER NOT NULL DEFAULT 1, -- 1=seg, 2=ter, 3=qua, 4=qui, 5=sex
  ativo BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
```

**`optimizer_execucoes_automaticas`** — log de ações executadas pelo sistema
```sql
CREATE TABLE IF NOT EXISTS public.optimizer_execucoes_automaticas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analise_id UUID NOT NULL,            -- FK para optimizer_ai_logs.id
  client_id TEXT NOT NULL,
  objeto_tipo TEXT NOT NULL,           -- campaign | adset | ad
  objeto_id TEXT NOT NULL,
  objeto_nome TEXT,
  acao TEXT NOT NULL,                  -- PAUSAR | ATIVAR | AJUSTAR_ORCAMENTO
  parametros JSONB,
  justificativa TEXT,
  modo_operacao TEXT NOT NULL,
  resultado TEXT NOT NULL DEFAULT 'pendente', -- pendente | sucesso | erro
  erro_detalhe TEXT,
  executado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON public.optimizer_execucoes_automaticas (client_id, created_at DESC);
CREATE INDEX ON public.optimizer_execucoes_automaticas (analise_id);
```

### 8.2 Colunas novas em tabelas existentes

**`optimizer_ai_logs`** — adicionar:
```sql
ALTER TABLE public.optimizer_ai_logs
  ADD COLUMN IF NOT EXISTS semana_analise TEXT,        -- ex: "2026-W26"
  ADD COLUMN IF NOT EXISTS modo_operacao TEXT,
  ADD COLUMN IF NOT EXISTS estado_da_conta TEXT,       -- SAUDAVEL | ATENCAO | CRISE
  ADD COLUMN IF NOT EXISTS acoes_automaticas_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acoes_executadas_count INTEGER DEFAULT 0;
```

---

## 9. Rotas API

### 9.1 Rotas novas

| Rota | Método | Descrição |
|---|---|---|
| `/api/otimizador/config/[clientId]` | GET | Retorna configuração de modo do cliente |
| `/api/otimizador/config/[clientId]` | POST/PUT | Salva modo + ações pré-aprovadas + limites |
| `/api/otimizador/executar` | POST | Executa uma ação automática (pausa, ativa, orçamento) |
| `/api/otimizador/pendentes` | GET | Lista ações aguardando aprovação |
| `/api/meta/adsets/[id]/budget` | POST | Ajusta orçamento diário de um conjunto |
| `/api/meta/ads/[id]/relevance-rankings` | GET | Busca quality/engagement/conversion ranking |
| `/api/meta/accounts/[id]/opportunity-score` | GET | Busca Opportunity Score + recomendações da conta |

### 9.2 Rotas modificadas

| Rota | Mudança |
|---|---|
| `/api/otimizador/analisar` POST | Aceita e salva schema v2.0; processa `acoes_automaticas` após IA retornar; dispara notificação WhatsApp |
| `/api/otimizador/analisar` GET | Retorna campos novos: `estado_da_conta`, `resumo_executivo`, `acoes_automaticas` |
| `/api/otimizador/daily` → renomear para `/api/otimizador/weekly` | Cadência semanal com rodízio; filtra clientes pelo dia da semana atual |

### 9.3 Rota de execução (`/api/otimizador/executar`)

Centraliza toda execução automática. Não chama APIs Meta diretamente — delega para as rotas de ação existentes.

```typescript
// POST /api/otimizador/executar
type ExecutarBody = {
  analise_id: string;
  client_id: string;
  connection_id: string;
  acao: 'PAUSAR' | 'ATIVAR' | 'AJUSTAR_ORCAMENTO';
  objeto_tipo: 'campaign' | 'adset' | 'ad';
  objeto_id: string;
  objeto_nome: string;
  parametros?: { novo_orcamento_diario?: number };
  justificativa: string;
  modo_operacao: string;
};
```

---

## 10. Relatório WhatsApp

### 10.1 Quando enviar

Após cada análise concluída (IA ou camada 1), o sistema verifica as `system_settings`:
- Se `otimizador_whatsapp_ativo = true` E grupo configurado → envia
- Se `otimizador_notificar_crise_apenas = true` → envia apenas quando `estado_da_conta = CRISE`
- Falha no envio WhatsApp não bloqueia nem reverte a análise — é fire-and-forget com log de erro

### 10.2 Formato do relatório (texto puro)

```
📊 *Otimizador ONMID — [NOME DO CLIENTE]*
📅 Semana [W26] · [Seg-Sex datas]

Estado: 🔴 CRISE | ⚠️ ATENÇÃO | ✅ SAUDÁVEL

[resumo_executivo do JSON da IA]

━━━ Destaques ━━━
• [recomendacao 1 — titulo + urgencia]
• [recomendacao 2 — titulo + urgencia]
• [recomendacao 3 — titulo + urgencia]

━━━ Ações automáticas ━━━
✅ [acao executada com sucesso]
⏳ [acao aguardando aprovação]

🔗 Ver no painel: [URL do painel/otimizador?client=ID]
```

- Máximo 3 recomendações no relatório (as de maior urgência)
- Ações automáticas só aparecem se existirem
- Link direto para o painel (URL configurada via env `NEXT_PUBLIC_APP_URL`)

### 10.3 Função de envio

Nova função em `src/lib/optimizer-whatsapp.ts`:

```typescript
export async function sendOptimizerReport(
  analysis: OptimizerAnalysisResult,
  clientName: string,
): Promise<void>
```

Responsabilidades:
1. Lê `system_settings` do banco para pegar `zapi_client_id` e `group_jid`
2. Busca `instance_id` em `zapi_clients` pelo `zapi_client_id`
3. Monta o texto formatado
4. Chama `sendEvolutionText(instanceName, groupJid, text)`
5. Loga resultado (sem lançar exceção)

---

## 11. System Prompt da IA

O system prompt do v2.0 mantém o mesmo tom imperativo do v1.0 (gestor falando com gestor), mas adiciona:

1. **Passo 0 obrigatório:** lê o `modo_operacao` e o `acoes_pre_aprovadas`. Só marca `EXECUTAR_AGORA` em ações que estejam na lista pré-aprovada.
2. **Passo 1:** identifica o objetivo da campanha (igual ao v1.0, mantido).
3. **Passo 2:** cruza métricas com metas (CPL, volume, orçamento).
4. **Passo 3:** diagnóstico por conjunto — classifica cada um.
5. **Passo 4:** diagnóstico por anúncio — só os que têm problema.
6. **Passo 5:** recomendações priorizadas com urgência e risco.
7. **Passo 6:** monta `acoes_automaticas` respeitando as pré-aprovações.
8. **Passo 7:** escreve `resumo_executivo` em 3–5 linhas.

**Regras de segurança embutidas no prompt:**
- Nunca marcar `EXECUTAR_AGORA` em conjunto com menos de `min_dias_aprendizado` dias.
- Nunca marcar `EXECUTAR_AGORA` em mais de 2 conjuntos por ciclo.
- Se `estado_da_conta = CRISE`, prioriza pausas — nunca aumentos de orçamento.

---

## 11. UI — Mudanças no Painel

### 11.1 Nova sub-aba: Configuração de modo (por cliente)

Dentro da área do cliente ou numa sub-aba do otimizador:
- Select de modo de operação
- Checkboxes de ações pré-aprovadas (aparece só nos modos automáticos)
- Campos de limites globais (orçamento máx, CPR emergência)
- Botão "Salvar"

### 11.2 Painel principal — mudanças

**Card de estado da conta (novo):**
- Badge grande: `SAUDÁVEL` / `ATENÇÃO` / `CRISE` com cor
- Resumo executivo abaixo do badge

**Lista de itens:**
- Mantém a estrutura atual (vermelho/amarelo/verde, filtros)
- Adiciona coluna "Modo" mostrando se o cliente é Diagnóstico / Aprovação / Auto

**Painel lateral (detalhe):**
- Resumo executivo no topo
- Seções: Conjuntos, Anúncios com problema, Recomendações
- Seção "Ações automáticas executadas" (com status sucesso/erro)
- Seção "Aguardando aprovação" com botões Aprovar / Recusar

### 11.3 Fluxo manual (modo RECOMENDACAO_COM_APROVACAO)

Cada ação recomendada continua tendo 3 botões:
- **Aplicar** — chama `/api/otimizador/executar` e executa via API Meta agora
- **Marcar feita** — registra como feita manualmente sem chamar API
- **Recusar** — registra recusa com motivo opcional

---

## 12. Custo com Cadência Semanal

| Métrica | Valor |
|---|---|
| Input por análise | ~4.500 tokens |
| Output por análise | ~2.000 tokens |
| Custo por análise (Sonnet 4.6) | ~$0,043 |
| 50 clientes × 1/semana | 50 análises/semana |
| **Custo mensal total** | **~$9/mês** |

Com cache (análises repetidas intraweek): custo real fica abaixo de $5/mês.

---

## 13. Segurança das Ações Automáticas

- **Log imutável:** toda ação executada automaticamente vai para `optimizer_execucoes_automaticas` com timestamp, objeto afetado, valor anterior inferido, justificativa e resultado.
- **Limite de ações por ciclo:** máximo de 2 ações `EXECUTAR_AGORA` por cliente por semana, mesmo em `AUTOMATICO_TOTAL`.
- **Proteção de aprendizado:** conjuntos com menos de `min_dias_aprendizado` dias (padrão: 7) nunca são pausados automaticamente.
- **CPR emergência:** se `cpl_atual > cpr_emergencia`, o sistema para todo o processamento automático daquele cliente e envia para aprovação manual independente do modo.
- **Orçamento máximo:** `novo_orcamento_diario` nunca pode ultrapassar `orcamento_diario_maximo_conta` da configuração.
- **"Desfazer" manual:** na UI, ações automáticas executadas exibem botão "Reverter" que chama a ação inversa (ex: pausou → reativa).

---

## 14. Proximidade com o Prompt Enviado

| Bloco do prompt | Status no v2.0 |
|---|---|
| Bloco 1 — Identidade e contexto do cliente | ✅ Coberto pelo payload (metas, nicho, histórico) |
| Bloco 2 — Dados Meta (opportunity score, conjuntos, anúncios, rankings) | ✅ Coberto — via Graph API própria |
| Bloco 2B — Dados Google Ads | ⏳ Estrutura prevista, implementação futura |
| Bloco 3 — Modo de operação + ações pré-aprovadas + limites | ✅ Coberto pela config por cliente |
| Etapa 1 — Cruzamento com planejamento | ✅ No payload + instrução no system prompt |
| Etapa 2 — Diagnóstico por conjunto | ✅ Campo `conjuntos[]` na saída |
| Etapa 3 — Diagnóstico por criativo/anúncio | ✅ Campo `anuncios[]` na saída |
| Etapa 4 — Recomendações priorizadas | ✅ Campo `recomendacoes[]` na saída |
| Etapa 5 — Plano de ações automáticas | ✅ Campo `acoes_automaticas[]` na saída |
| Etapa 6 — Resumo executivo | ✅ Campo `resumo_executivo` na saída |
| Formato de saída JSON | ✅ Estrutura adaptada (termos em pt-BR, campos ajustados) |
| Critérios de diagnóstico (fadiga, fragmentação, CTR, CPR) | ✅ Embutidos no system prompt |
| Endpoints de ação (pausar, ajustar orçamento, duplicar) | ✅ Pausar e ajustar via API própria. Duplicar: não previsto no v2.0 (complexidade alta, pouco ganho). |

**Fidelidade ao prompt original:** ~88%. Os desvios são intencionais:
- Termos traduzidos para pt-BR (padrão do sistema)
- `EXECUTAR_AGORA` controlado pelo sistema, não só pela IA
- Duplicação de conjunto removida do escopo (risco alto, requer criativo e público)
- Google Ads adiado para uma segunda fase

---

## 16. Ordem de Implementação

| Fase | O que fazer | Arquivos principais |
|---|---|---|
| 1 | Migration: novas tabelas + colunas + `system_settings` | `src/lib/db/migration_optimizer_v2.sql` |
| 2 | API de config por cliente (modo + rodízio + limites) | `src/app/api/otimizador/config/[clientId]/route.ts` |
| 3 | API de config global do WhatsApp (instância + grupo) | `src/app/api/otimizador/whatsapp-config/route.ts` |
| 4 | Rota para listar grupos Evolution | `src/app/api/otimizador/whatsapp-groups/route.ts` |
| 5 | UI de Configurações: seção admin do Otimizador | `src/app/(dashboard)/configuracoes/page.tsx` |
| 6 | UI de config por cliente (modo + dia de rodízio) | `src/app/(dashboard)/otimizador/page.tsx` |
| 7 | Novas rotas Graph API (rankings, opportunity score, budget) | `src/app/api/meta/ads/[id]/relevance-rankings/route.ts` etc. |
| 8 | Weekly route com rodízio por dia da semana | `src/app/api/otimizador/weekly/route.ts` |
| 9 | Novo system prompt + schema v2.0 | `src/lib/optimizer.ts` |
| 10 | Rota de execução automática | `src/app/api/otimizador/executar/route.ts` |
| 11 | Pós-processamento na `/analisar` (executar ações + WhatsApp) | `src/app/api/otimizador/analisar/route.ts` |
| 12 | Lib de envio WhatsApp do otimizador | `src/lib/optimizer-whatsapp.ts` |
| 13 | UI do painel: resumo executivo, ações automáticas, aprovações | `src/app/(dashboard)/otimizador/page.tsx` |
| 14 | Cron semanal (Mon-Fri) no `vercel.json` + GitHub Actions | `vercel.json`, `.github/workflows/` |
