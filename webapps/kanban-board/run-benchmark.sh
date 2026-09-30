#!/usr/bin/env bash
# Kanban Board benchmark driver: one fresh run per technology stack for a single local LLM.
#
# Usage:  kanban-board/run-benchmark.sh <llm-name>
#
# Optional environment variables:
#   AGENT_CMD   Command that runs your coding agent non-interactively. The prompt is appended as
#               the final argument, e.g. AGENT_CMD='aider --yes-always --model ollama_chat/qwen3-coder:30b --message'
#               If unset, the script runs in manual mode: it prints each prompt (and copies it to the
#               clipboard when pbcopy is available) and waits for you to press Enter when the agent is done.
#   STACKS      Space-separated subset of stacks to run (default: every directory containing TECH.md).
#   SKIP_SMOKE  Set to 1 to skip the docker compose smoke test after each run.
#   FORCE       Set to 1 to run a stack even if its implementation directory already has files.
#
# See RUNNING.md for details.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BENCH="$(basename "$SCRIPT_DIR")"          # "kanban-board"
HEALTH_URL="http://localhost:8080/api/health"
HEALTH_TIMEOUT=120

die() { echo "error: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: $0 <llm-name>   (e.g. qwen3-coder-30b-a3b-q4km)"
LLM="$1"
[[ "$LLM" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]] \
  || die "llm-name must be lowercase kebab-case (a-z, 0-9, '-', '.'), e.g. qwen3-coder-30b-a3b-q4km"

if [ -n "${STACKS:-}" ]; then
  stacks="$STACKS"
else
  stacks=""
  for d in "$SCRIPT_DIR"/*/; do
    [ -f "$d/TECH.md" ] && stacks="$stacks $(basename "$d")"
  done
fi
[ -n "${stacks// /}" ] || die "no stacks found (expected $BENCH/<stack>/TECH.md)"

RUN_DIR="$SCRIPT_DIR/runs/$LLM"
mkdir -p "$RUN_DIR"
SUMMARY="$RUN_DIR/summary.tsv"
[ -f "$SUMMARY" ] || printf "timestamp\tstack\tagent_exit\tsmoke\tagent_seconds\n" > "$SUMMARY"

build_prompt() {
  local stack="$1"
  cat <<EOF
You are implementing a coding benchmark task. Work autonomously; do not ask questions.

Read these two files completely before writing any code:
  - $BENCH/PRD.md
  - $BENCH/$stack/TECH.md

Write your entire implementation inside:
  $BENCH/$stack/$LLM/

Do not create or modify files anywhere else. When finished, make sure
\`docker compose up --build -d\` from that directory brings the app up on
http://localhost:8080, and complete README.md and NOTES.md as the PRD requires.
EOF
}

# Prints one of: pass | no-compose | port-busy | build-failed | unhealthy | skipped | docker-unavailable
smoke_test() {
  local impl="$1" log="$2" project
  if [ "${SKIP_SMOKE:-0}" = "1" ]; then echo skipped; return; fi
  docker info >/dev/null 2>&1 || { echo docker-unavailable; return; }
  [ -f "$impl/docker-compose.yaml" ] || [ -f "$impl/docker-compose.yml" ] || { echo no-compose; return; }
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then echo port-busy; return; fi

  # Compose project names only allow [a-z0-9_-]; a per-run name keeps volumes separate per LLM.
  project="kb-$(printf "%s-%s" "$LLM" "$(basename "$(dirname "$impl")")" | tr '.' '-')"

  local result=unhealthy
  (cd "$impl" && docker compose -p "$project" down -v --remove-orphans) >>"$log" 2>&1 || true
  if ! (cd "$impl" && docker compose -p "$project" up --build -d) >>"$log" 2>&1; then
    result=build-failed
  else
    local deadline=$((SECONDS + HEALTH_TIMEOUT)) body
    while [ $SECONDS -lt $deadline ]; do
      if body=$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null) \
         && echo "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
        result=pass; break
      fi
      sleep 3
    done
  fi
  (cd "$impl" && docker compose -p "$project" logs --no-color) >>"$log" 2>&1 || true
  (cd "$impl" && docker compose -p "$project" down -v --remove-orphans) >>"$log" 2>&1 || true
  echo "$result"
}

agent=()
if [ -n "${AGENT_CMD:-}" ]; then
  read -r -a agent <<< "$AGENT_CMD"
  echo "Automated mode: AGENT_CMD=${AGENT_CMD}"
else
  echo "Manual mode (AGENT_CMD not set): paste each prompt into a FRESH agent session, working directory: $REPO_ROOT"
fi

cd "$REPO_ROOT"
for stack in $stacks; do
  [ -f "$SCRIPT_DIR/$stack/TECH.md" ] || { echo "skip $stack: no TECH.md"; continue; }
  impl="$SCRIPT_DIR/$stack/$LLM"
  if [ -d "$impl" ] && [ -n "$(ls -A "$impl" 2>/dev/null)" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "skip $stack: $BENCH/$stack/$LLM already has files (set FORCE=1 to run anyway)"
    continue
  fi
  mkdir -p "$impl"

  prompt="$(build_prompt "$stack")"
  printf "%s\n" "$prompt" > "$RUN_DIR/$stack.prompt.md"
  agent_log="$RUN_DIR/$stack.agent.log"
  smoke_log="$RUN_DIR/$stack.smoke.log"

  echo
  echo "=== $stack  ($(date '+%Y-%m-%d %H:%M:%S')) ==="
  start=$SECONDS
  if [ ${#agent[@]} -gt 0 ]; then
    set +e
    "${agent[@]}" "$prompt" 2>&1 | tee "$agent_log"
    agent_exit=${PIPESTATUS[0]}
    set -e
  else
    echo "----- prompt (saved to runs/$LLM/$stack.prompt.md) -----"
    echo "$prompt"
    echo "---------------------------------------------------------"
    if command -v pbcopy >/dev/null; then printf "%s" "$prompt" | pbcopy && echo "(copied to clipboard)"; fi
    read -r -p "Press Enter when the agent has finished $stack... " _ </dev/tty
    agent_exit=manual
  fi
  agent_seconds=$((SECONDS - start))

  echo "Smoke test: docker compose up --build, waiting up to ${HEALTH_TIMEOUT}s for $HEALTH_URL ..."
  smoke="$(smoke_test "$impl" "$smoke_log")"
  echo "Result: agent_exit=$agent_exit smoke=$smoke (${agent_seconds}s)"
  printf "%s\t%s\t%s\t%s\t%s\n" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$stack" "$agent_exit" "$smoke" "$agent_seconds" >> "$SUMMARY"
done

echo
echo "Summary ($BENCH/runs/$LLM/summary.tsv):"
column -t -s $'\t' "$SUMMARY" 2>/dev/null || cat "$SUMMARY"
