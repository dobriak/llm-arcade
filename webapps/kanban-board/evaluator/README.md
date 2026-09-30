# Kanban Board evaluator

These are black-box test suites for the scripted part of the PRD §11 score. They run against any implementation on `http://localhost:8080` and never look at its source code.

```
evaluator/
├── playwright.config.ts   projects: api (HTTP only) and ui (Chromium); reporters: list + JSON + HTML
├── lib/api.ts             typed API client, PRD §6.2 shape checks, error-envelope checks
├── lib/ui.ts              test-hook locators, pointer-driven drag helper, select/confirm helpers
├── tests/api/*.spec.ts    tagged @api (66 tests) and @moves (15 tests)
├── tests/ui/*.spec.ts     tagged @ui (21 tests); xss.spec.ts is also tagged @xss (critical)
└── score.mjs              turns checks.json + playwright.json into score.json / score.md
```

## Usage

The normal entry point is `../evaluate.sh <stack> <llm-name>` (see `../RUNNING.md`). It builds and starts the stack, checks persistence, runs these suites, checks for a migration table, runs the backend `test` target and computes the score.

To run the suites by hand against something already listening:

```bash
cd kanban-board/evaluator
npm ci && npx playwright install chromium
KANBAN_URL=http://localhost:8080 EVAL_OUT=results/manual npx playwright test   # all
npx playwright test --project=api                                             # API only
npx playwright test --project=ui --headed                                     # watch the browser
npx playwright show-report results/manual/html
```

Passing `--reporter=...` on the command line replaces the configured reporters, so no JSON report is written and `score.mjs` has nothing to read.

## What gets scored

| Area | Weight | Source |
|---|---:|---|
| Build + healthy within 120 s | 10 | evaluate.sh |
| Data survives `down` / `up` | 5 | evaluate.sh (creates a marker board, restarts, reads it back) |
| API contract | 25 | share of `@api` tests passed |
| Moves / positions / WIP | 15 | share of `@moves` tests passed (includes seeded random move sequences checked against a model) |
| UI flows | 20 | share of `@ui` tests passed (a flaky pass after 1 retry counts) |
| Backend tests | 10 | `docker build --target test` + `docker run` exits 0 |

Caps and penalties:
- The app does not start → the score is capped at 10.
- Any `@xss` failure → capped at 40.
- The persistence check fails → capped at 50.
- No `alembic_version`, `_prisma_migrations` or `goose_db_version` table in the live DB → −10.

The remaining 15 points (TECH.md adherence, code clarity, lint, docs) are awarded in manual review.

## Assumptions about implementations

The UI tests rely only on the `data-testid` hooks and conventions in PRD §7.4. The suites create their own data through the API, each on a fresh board, so they are independent of each other and of the demo seed. The one exception is the seed test, which looks for "Demo Board". Tests run serially (`workers: 1`) because the apps use a single SQLite writer.

## Validation status

The suites were validated against a throwaway reference implementation (FastAPI with a vanilla-JS + SortableJS UI):
- **Clean runs:** all 102 tests passed on two consecutive runs with retries off.
- **Bug detection:** four deliberately injected bugs were each caught:
  - no WIP check on moves
  - `null` not clearing `due_date`
  - source column not re-packed
  - `innerHTML` for card titles (triggered the XSS cap)
- **Not yet verified:** drag-and-drop against dnd-kit (nestjs-react) and svelte-dnd-action (gin-sveltekit), and the Docker steps of `evaluate.sh`. If a correct implementation fails only the drag tests, adjust `drag()` in `lib/ui.ts` first.
