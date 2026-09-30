#!/usr/bin/env bash
# Scores one implementation against the PRD: startup, persistence, API suite, UI suite, backend tests.
#
# Usage:  kanban-board/evaluate.sh <stack> <llm-name>
#         kanban-board/evaluate.sh --all <llm-name>        # every stack that has an implementation
#
# Results: kanban-board/runs/<llm-name>/eval/<stack>/{score.md,score.json,checks.json,playwright.json,html/,*.log}
# Optional env: KEEP_UP=1 leaves the stack running after evaluation (for debugging).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$SCRIPT_DIR/evaluator"
URL="http://localhost:8080"
HEALTH_TIMEOUT=120

die() { echo "error: $*" >&2; exit 1; }
log() { echo "[$(date '+%H:%M:%S')] $*"; }

[ $# -eq 2 ] || die "usage: $0 <stack>|--all <llm-name>"

if [ "$1" = "--all" ]; then
  for d in "$SCRIPT_DIR"/*/; do
    s="$(basename "$d")"
    [ -f "$d/TECH.md" ] && [ -d "$d/$2" ] && "$0" "$s" "$2" || true
  done
  exit 0
fi

STACK="$1"; LLM="$2"
IMPL="$SCRIPT_DIR/$STACK/$LLM"
[ -f "$SCRIPT_DIR/$STACK/TECH.md" ] || die "unknown stack: $STACK"
[ -d "$IMPL" ] || die "no implementation at $IMPL"
command -v node >/dev/null || die "node is required on the host (>= 20)"
docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"

case "$STACK" in
  fastapi-htmx)  TEST_CONTEXT="."        ; MIGRATION_TABLE="alembic_version" ;;
  nestjs-react)  TEST_CONTEXT="./backend"; MIGRATION_TABLE="_prisma_migrations" ;;
  gin-sveltekit) TEST_CONTEXT="./backend"; MIGRATION_TABLE="goose_db_version" ;;
  *)             TEST_CONTEXT="."        ; MIGRATION_TABLE="" ;;
esac

OUT="$SCRIPT_DIR/runs/$LLM/eval/$STACK"
rm -rf "$OUT"; mkdir -p "$OUT"
COMPOSE_LOG="$OUT/compose.log"
PROJECT="kb-eval-$(printf "%s-%s" "$LLM" "$STACK" | tr '.' '-')"
compose() { (cd "$IMPL" && docker compose -p "$PROJECT" "$@"); }

build=fail healthy=false persisted=false backend_tests=fail migrations_found="" build_seconds=0

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) body
  while [ $SECONDS -lt $deadline ]; do
    if body=$(curl -fsS --max-time 3 "$URL/api/health" 2>/dev/null) && echo "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

write_checks() {
  cat > "$OUT/checks.json" <<EOF
{
  "stack": "$STACK",
  "llm": "$LLM",
  "build": "$build",
  "build_seconds": $build_seconds,
  "healthy": $healthy,
  "persisted": $persisted,
  "migrations_table": "$migrations_found",
  "expected_migrations_table": "$MIGRATION_TABLE",
  "backend_tests": "$backend_tests"
}
EOF
}

cleanup() { if [ "${KEEP_UP:-0}" != "1" ]; then compose down -v --remove-orphans >>"$COMPOSE_LOG" 2>&1 || true; fi; }
trap cleanup EXIT

# ---- evaluator dependencies ---------------------------------------------------------------------
if [ ! -d "$EVAL_DIR/node_modules/@playwright/test" ]; then
  log "Installing evaluator dependencies"
  (cd "$EVAL_DIR" && npm ci --no-audit --no-fund >/dev/null)
fi
(cd "$EVAL_DIR" && npx playwright install chromium >/dev/null)

if curl -fsS --max-time 2 "$URL/api/health" >/dev/null 2>&1; then
  die "something is already serving $URL — stop it first"
fi

# ---- 1. build + start ---------------------------------------------------------------------------
[ -f "$IMPL/docker-compose.yaml" ] || [ -f "$IMPL/docker-compose.yml" ] || { write_checks; node "$EVAL_DIR/score.mjs" "$OUT"; die "no docker-compose.yaml"; }
log "Building and starting $STACK/$LLM (project $PROJECT)"
compose down -v --remove-orphans >>"$COMPOSE_LOG" 2>&1 || true
start=$SECONDS
if compose up --build -d >>"$COMPOSE_LOG" 2>&1; then build=ok; fi
build_seconds=$((SECONDS - start))
log "Build: $build (${build_seconds}s)"

if [ "$build" = ok ] && wait_healthy; then healthy=true; fi
log "Healthy: $healthy"

if [ "$healthy" = true ]; then
  # ---- 2. persistence across down/up ------------------------------------------------------------
  marker="persistence-check-$RANDOM$RANDOM"
  board_id=$(curl -fsS -X POST "$URL/api/boards" -H 'content-type: application/json' -d "{\"name\":\"$marker\"}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).id)}catch{console.log("")}})' || true)
  if [ -n "$board_id" ]; then
    log "Restarting (down + up, volume kept) to check persistence"
    compose down >>"$COMPOSE_LOG" 2>&1 || true
    compose up -d >>"$COMPOSE_LOG" 2>&1 || true
    if wait_healthy && curl -fsS "$URL/api/boards/$board_id" 2>/dev/null | grep -q "$marker"; then persisted=true; fi
  fi
  log "Persisted: $persisted"

  # ---- 3. Playwright suites ---------------------------------------------------------------------
  log "Running API + UI suites"
  (cd "$EVAL_DIR" && KANBAN_URL="$URL" EVAL_OUT="$OUT" npx playwright test >"$OUT/playwright.log" 2>&1) || true
  tail -n 3 "$OUT/playwright.log" || true

  # ---- 4. migration bookkeeping table in the live DB --------------------------------------------
  tmpdb="$(mktemp -d)"
  for svc in $(compose ps --services 2>/dev/null); do
    if compose cp "$svc:/data/kanban.db" "$tmpdb/kanban.db" >/dev/null 2>&1; then
      compose cp "$svc:/data/kanban.db-wal" "$tmpdb/kanban.db-wal" >/dev/null 2>&1 || true
      break
    fi
  done
  if [ -f "$tmpdb/kanban.db" ]; then
    migrations_found=$(python3 - "$tmpdb/kanban.db" <<'EOF' || true
import sqlite3, sys
names = [r[0] for r in sqlite3.connect(sys.argv[1]).execute("select name from sqlite_master where type='table'")]
known = ["alembic_version", "_prisma_migrations", "goose_db_version", "schema_migrations"]
print(next((n for n in known if n in names), ""))
EOF
)
  fi
  rm -rf "$tmpdb"
  log "Migration table: ${migrations_found:-none}"
fi

compose logs --no-color >>"$COMPOSE_LOG" 2>&1 || true
cleanup; trap - EXIT

# ---- 5. backend test target -----------------------------------------------------------------------
log "Running backend tests (docker build --target test $TEST_CONTEXT)"
test_image="$PROJECT-test"
if (cd "$IMPL" && docker build --target test -t "$test_image" "$TEST_CONTEXT") >"$OUT/backend-tests.log" 2>&1 \
   && docker run --rm "$test_image" >>"$OUT/backend-tests.log" 2>&1; then
  backend_tests=pass
fi
docker image rm "$test_image" >/dev/null 2>&1 || true
log "Backend tests: $backend_tests"

write_checks
echo
node "$EVAL_DIR/score.mjs" "$OUT"
echo
echo "HTML report: $OUT/html/index.html"
