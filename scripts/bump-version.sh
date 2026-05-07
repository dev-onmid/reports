#!/bin/bash
# Incrementa automaticamente a versão do app a cada commit
VERSION_FILE="src/lib/app-version.ts"

CURRENT=$(grep -o "[0-9]*\.[0-9]*" "$VERSION_FILE" | head -1)
MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
NEW_MINOR=$((MINOR + 1))
NEW_VERSION="$MAJOR.$NEW_MINOR"

sed -i '' "s/'$CURRENT'/'$NEW_VERSION'/" "$VERSION_FILE"
echo "✔ Versão: $CURRENT → $NEW_VERSION"
git add "$VERSION_FILE"
