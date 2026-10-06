#!/usr/bin/env bash
# Rotina diária: Kanban dos clientes sem integração + nota de atendimento de toda
# a lista. Um Claude por cliente (contexto limpo), em sequência. Cron na VPS.
set -uo pipefail
BASE=/opt/onmid-rotina
DIA=$(TZ=America/Sao_Paulo date +%F)
LOG=/var/log/onmid-rotina/$DIA
mkdir -p "$LOG" "$BASE/work/$DIA"
exec 9>"$BASE/.lock"; flock -n 9 || { echo "já rodando"; exit 0; }
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN   # só assinatura, nunca API paga
set -a; . "$BASE/.token"; set +a   # CLAUDE_CODE_OAUTH_TOKEN
CLAUDE=${CLAUDE_BIN:-/root/.local/bin/claude}
MODELO=$(python3 -c "import json;print(json.load(open('$BASE/config.json')).get('modelo','sonnet'))")
SO=${1:-tudo}   # tudo | kanban | notas | auditoria
SO_CLIENTE=${2:-}

roda() { # tipo cliente
  local tipo=$1 cid=$2 prompt
  prompt=$(sed -e "s/{{CLIENTE}}/$cid/g" -e "s/{{DIA}}/$DIA/g" "$BASE/prompt-$tipo.md")
  cd "$BASE/work/$DIA"
  timeout 30m "$CLAUDE" -p "$prompt" --model "$MODELO" --max-turns 120 --output-format json \
    --allowedTools "Bash(/opt/onmid-rotina/bin/rotina:*)" "Read(//opt/onmid-rotina/work/**)" "Write(//opt/onmid-rotina/work/**)" "Edit(//opt/onmid-rotina/work/**)" \
    > "$LOG/$tipo-$cid.json" 2> "$LOG/$tipo-$cid.err"
  echo "$(date -Is) $tipo $cid exit=$?" >> "$LOG/resumo.txt"
}
lista() { python3 -c "import json;print(' '.join(json.load(open('$BASE/config.json'))['$1']))"; }

if [[ $SO == tudo || $SO == kanban ]]; then
  for cid in ${SO_CLIENTE:-$(lista kanban)}; do roda kanban "$cid"; done
fi
if [[ $SO == tudo || $SO == notas ]]; then
  for cid in ${SO_CLIENTE:-$(lista auditoria)}; do roda notas "$cid"; done
fi
if [[ $SO == tudo || $SO == auditoria ]]; then
  for cid in ${SO_CLIENTE:-$(lista auditoria)}; do roda auditoria "$cid"; done
fi
find "$BASE/work" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +   # guarda 2 semanas de trabalho
find /var/log/onmid-rotina -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
