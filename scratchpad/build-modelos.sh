#!/usr/bin/env bash
# Compila a lib de modelos de funil para o teste rodar no Node.
# O emit mantem o alias "@/lib/x" (que o Node nao resolve) — por isso o sed.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc -p scratchpad/tsconfig-modelos.json
cd scratchpad/build
for f in crm-funil-modelos funil-etapas schema-memo; do
  [ -f "$f.js" ] && mv -f "$f.js" "$f.mjs"
done
perl -pi -e "s{from ['\"]\@/lib/([a-z-]+)['\"]}{from './\$1.mjs'}g" ./*.mjs
echo "ok — node scratchpad/test-aplicar-modelo.mjs"
