#!/usr/bin/env bash
# Condition 8 — the web-quality audit, as the two tools the gate names, against
# the REAL rendered surface: the built client served by `src/server.ts`.
#
#   npm run build && PORT=4901 npx tsx src/server.ts &
#   bash scripts/run-web-audit.sh            # writes promotion/evidence/web-audit/
#
# Versions are pinned so a re-run measures the same thing. BASE defaults to the
# port this repo's evidence was captured on.
set -u
BASE="${BASE:-http://127.0.0.1:4901}"
OUT="${OUT:-promotion/evidence/web-audit}"
mkdir -p "$OUT"

for page in lobby:/ demo:/demo; do
  name="${page%%:*}"; path="${page#*:}"
  echo "=== lighthouse $name ($BASE$path) ==="
  npx --yes lighthouse@13.4.1 "$BASE$path" \
    --output=json --output-path="$OUT/lighthouse-$name.json" \
    --chrome-flags="--headless" --quiet
  echo "lighthouse $name exit=$?"

  echo "=== axe $name ($BASE$path) ==="
  npx --yes @axe-core/cli@4.13.0 "$BASE$path" --save "$OUT/axe-$name.json"
  echo "axe $name exit=$?"
done
