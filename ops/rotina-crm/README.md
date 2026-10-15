# Rotina diária do CRM (Claude Code na VPS)

Todo dia, de madrugada, o Claude Code roda na VPS com a assinatura do Matheus (sem custo de API):

1. **Kanban** — para cada cliente de `config.json > kanban` (só quem não recebe etapa por planilha ou integração), lê as conversas com mensagem nova desde a última análise e move etapa, temperatura, valor do negócio e motivo de perda. **Sem efeitos externos**: não dispara follow-up nem evento de conversão (UPDATE direto).
2. **Atendimento** — para cada cliente de `config.json > auditoria`, lê as métricas de 30 dias + uma amostra de até 28 conversas da semana e grava a nota na aba Atendimento (uma por dia; a do dia é substituída se rodar de novo).

## Peças
| Arquivo | Papel |
|---|---|
| `bin/rotina` | Única porta do Claude para o banco: subcomandos fixos que rodam scripts dentro do container `onmid-reports`. |
| `lib/kanban-pull.cjs` / `kanban-aplica.cjs` | Lê conversas novas / aplica decisões com travas (etapa existente, sem recuo exceto perda, perda exige motivo, conflito com mudança humana posterior vence o humano). |
| `lib/metricas.cjs` / `amostra.cjs` / `auditoria-grava.cjs` | Métricas, amostra e gravação validada da nota (recalcula pela régua 25/30/30/10/5). |
| `lib/formata.py` | JSON → texto com data e dia da semana já calculados (o host não tem node). |
| `prompt-*.md` | Instruções que o Claude segue. |
| `run-diario.sh` | Um Claude por cliente, em sequência, com só as ferramentas acima liberadas. |

## Rastro
- `crm_rotina_log`: cada campo mudado, de → para, com a frase do porquê; recusas e conflitos também.
- `crm_rotina_analise`: até onde cada lead já foi lido (só volta com mensagem nova).
- `/var/log/onmid-rotina/<dia>/`: saída de cada execução. `/opt/onmid-rotina/work/<dia>/`: arquivos lidos e decisões (guarda 14 dias).

## Instalação na VPS
Arquivos em `/opt/onmid-rotina/`, Claude Code em `/root/.local/bin/claude`, token em `/opt/onmid-rotina/.token` (`CLAUDE_CODE_OAUTH_TOKEN=...`, gerado com `claude setup-token`, chmod 600). Rodar à mão: `/opt/onmid-rotina/run-diario.sh [tudo|kanban|auditoria] [clientId]`.
