# Running the Kanban Board benchmark

This page explains how to run one local LLM through every stack in this benchmark and collect comparable results.

```
kanban-board/
├── PRD.md                      shared spec (what to build)
├── RUNNING.md                  this file
├── run-benchmark.sh            driver script: runs the LLM on each stack
├── evaluate.sh                 scoring script: tests one implementation (see §6)
├── evaluator/                  Playwright API + UI suites and the scorer
├── <stack>/TECH.md             stack-specific instructions (how to build it)
├── <stack>/<llm-name>/         one implementation per LLM (written by the LLM)
└── runs/<llm-name>/            prompts, logs, summary and eval/ results (written by the scripts)
```

## 1. Ground rules

1. **One stack per session.** Each stack runs in a **fresh agent session** with an empty context. Don't reuse a session across stacks: context bleed and context exhaustion would distort the per-stack scores.
2. **You name the model.** Pass the `<llm-name>` yourself. Don't let the model name itself, because models often misreport their own name, size or quantization.
3. **No human help.** Don't answer questions, nudge the model or fix code during a run. If a run needs intervention, note it in `runs/<llm-name>/notes.md`, and treat that run as invalid.
4. **Same harness for every model.** Keep the agent tool, its settings, the context length, the temperature and any time limit identical across the models you compare. Record them in `runs/<llm-name>/notes.md`.
5. The working directory of the agent is **the parent of `kanban-board/`**. The prompt uses paths relative to it.

## 2. Naming convention for `<llm-name>`

Use lowercase kebab-case: `<family><version>-<variant>-<size>-<quant>`. Dots are allowed in versions. Leave out the parts that don't apply.

| Model | `<llm-name>` |
|---|---|
| Qwen3 Coder 30B-A3B, Q4_K_M GGUF | `qwen3-coder-30b-a3b-q4km` |
| Devstral Small 24B, Q8_0 | `devstral-small-24b-q8` |
| Llama 3.3 70B Instruct, MLX 4-bit | `llama3.3-instruct-70b-mlx4` |
| GPT-OSS 20B, MXFP4 | `gpt-oss-20b-mxfp4` |

The script accepts `^[a-z0-9][a-z0-9.-]*[a-z0-9]$`.

## 3. The script

```bash
kanban-board/run-benchmark.sh <llm-name>
```

For every stack directory that contains a `TECH.md` (currently `fastapi-htmx`, `gin-sveltekit` and `nestjs-react`), the script does the following:

1. **Skip check:** if `<stack>/<llm-name>/` already contains files, the stack is skipped. Set `FORCE=1` to run it anyway.
2. **Prompt:** it creates the implementation directory and writes the prompt to `runs/<llm-name>/<stack>.prompt.md`.
3. **Agent run:** it runs the agent, either automatically or by waiting for you (see the two modes below).
4. **Smoke test:**
   - It runs `docker compose up --build -d` under a per-run project name (`kb-<llm-name>-<stack>`), so volumes never collide between models.
   - It waits up to 120 s for `GET http://localhost:8080/api/health` to return `"status":"ok"`.
   - It saves the compose logs, then tears everything down with `down -v`.
5. **Summary:** it appends a row to `runs/<llm-name>/summary.tsv`, and prints the table when it finishes.

### Manual mode (default)

Use this when your agent is a GUI or chat tool. With `AGENT_CMD` unset, the script:
- prints each prompt and copies it to the clipboard (on macOS)
- waits for you to paste it into a **new** agent session and press Enter once the agent is done
- then runs the smoke test

### Automated mode

Set `AGENT_CMD` to a command that runs your agent non-interactively. The script appends the prompt as the **last argument**. The agent's output is saved to `runs/<llm-name>/<stack>.agent.log`.

```bash
# aider against a model served by Ollama
AGENT_CMD='aider --yes-always --no-auto-commits --model ollama_chat/qwen3-coder:30b --message' \
  kanban-board/run-benchmark.sh qwen3-coder-30b-a3b-q4km

# opencode against a local provider
AGENT_CMD='opencode run --model ollama/devstral-small' \
  kanban-board/run-benchmark.sh devstral-small-24b-q8
```

Check your agent's documentation for its exact non-interactive flags. The command must run the whole task and exit when it is done. The script does not enforce a time limit. If you want one, wrap the command, e.g. `AGENT_CMD='gtimeout 2h aider ...'` using `coreutils` on macOS.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `AGENT_CMD` | unset (manual mode) | Agent command; the prompt is appended as its final argument |
| `STACKS` | every stack that has a `TECH.md` | Space-separated subset, e.g. `STACKS="fastapi-htmx"` |
| `SKIP_SMOKE` | `0` | `1` skips the Docker smoke test |
| `FORCE` | `0` | `1` runs a stack even if its implementation directory is not empty |

### Smoke results

| Value | Meaning |
|---|---|
| `pass` | Built, started, and `/api/health` returned ok within 120 s |
| `build-failed` | `docker compose up --build` exited non-zero (see `<stack>.smoke.log`) |
| `unhealthy` | Started, but the health check never passed in time |
| `no-compose` | No `docker-compose.yaml` in the implementation directory |
| `port-busy` | Something was already answering on `localhost:8080`, so the test was not run |
| `docker-unavailable` | The Docker daemon is not reachable |
| `skipped` | `SKIP_SMOKE=1` |

The smoke test is only a gate: it corresponds to the first row of the scoring table in PRD §11. The full score comes from the black-box API suite, the Playwright UI suite and the code review described in PRD §11.

## 4. The prompt

The script generates this prompt, with `<stack>` and `<llm-name>` filled in. The script is the source of truth. If you run a model entirely by hand, use exactly this text:

```
You are implementing a coding benchmark task. Work autonomously; do not ask questions.

Read these two files completely before writing any code:
  - kanban-board/PRD.md
  - kanban-board/<stack>/TECH.md

Write your entire implementation inside:
  kanban-board/<stack>/<llm-name>/

Do not create or modify files anywhere else. When finished, make sure
`docker compose up --build -d` from that directory brings the app up on
http://localhost:8080, and complete README.md and NOTES.md as the PRD requires.
```

## 5. After a run

- Check that the agent stayed inside `kanban-board/<stack>/<llm-name>/`. If the folder is under git, run `git status`. Writes outside that folder violate the rules and should be noted.
- Keep `runs/<llm-name>/` alongside the implementation. It records the prompt, the agent transcript, the smoke log and the timings.
- Re-running a single stack: delete the implementation directory, or use `FORCE=1 STACKS="<stack>"`. `FORCE` keeps the existing files, so the model would start from its previous attempt. That is usually not what you want for a clean score.

## 6. Scoring

Once the runs are done, score each implementation:

```bash
kanban-board/evaluate.sh fastapi-htmx qwen3-coder-30b-a3b-q4km   # one stack
kanban-board/evaluate.sh --all qwen3-coder-30b-a3b-q4km          # every stack this LLM has an implementation for
```

**Host requirements:** a running Docker daemon, Node ≥ 20, `python3` and `curl`. On first use the script installs the evaluator's npm dependencies and Chromium.

For each implementation, the script does the following. Port 8080 must be free.
1. **Build and start:** `docker compose up --build -d` under the project name `kb-eval-<llm-name>-<stack>`, then it waits up to 120 s for `/api/health`.
2. **Persistence:** it creates a marker board, runs `docker compose down` and then `up -d` (the volume is kept), and reads the board back.
3. **Test suites:** it runs the Playwright API and UI suites from `evaluator/` against `http://localhost:8080`.
4. **Migrations:** it copies `/data/kanban.db` out of the container and looks for the migration tool's bookkeeping table.
5. **Backend tests:** it tears the stack down (`down -v`), then runs the backend's Docker `test` target.
6. **Score:** it writes `score.md` and `score.json`.

All output goes to `runs/<llm-name>/eval/<stack>/`:

| File | Content |
|---|---|
| `score.md` / `score.json` | Scripted score out of 85, with per-area points, failed tests and caps |
| `checks.json` | Build, health, persistence, migration table and backend-test results |
| `playwright.json`, `html/` | Full test report. Open with `npx playwright show-report runs/<llm>/eval/<stack>/html` |
| `compose.log`, `playwright.log`, `backend-tests.log` | Raw logs |

Add the 15 review points (TECH.md adherence, code clarity, lint, docs) by hand after reading the code. Set `KEEP_UP=1` to leave the stack running after evaluation so you can inspect it.

See `evaluator/README.md` for how the suites are organised and what they assume.
