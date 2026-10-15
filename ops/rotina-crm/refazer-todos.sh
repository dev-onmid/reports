#!/bin/bash
# Refaz as notas de TODOS os clientes até zerar a fila (várias passadas de 150).
BASE=/opt/onmid-rotina
while pgrep -f "refazer-hoje.sh" >/dev/null; do sleep 60; done   # espera notas+auditorias em andamento
IDS=$(python3 -c "import json;print(\" \".join(json.load(open(\"$BASE/config.json\"))[\"auditoria\"]))")
for passada in 1 2 3 4 5; do
  PEND=$(docker exec -i -w /app onmid-reports node - $IDS < $BASE/lib/notas-pendentes.cjs)
  echo "$(date -Is) passada $passada: ${PEND:-nada pendente}"
  [ -z "$PEND" ] && break
  for cid in $PEND; do $BASE/run-diario.sh notas "$cid"; done
done
echo "$(date -Is) fim"
