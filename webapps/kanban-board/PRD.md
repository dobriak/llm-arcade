# Kanban Board — Product Requirements Document

**Status:** Frozen for benchmark use · **Version:** 1.0 · **Date:** 2026-09-30

This PRD is the stack-independent specification for the Kanban Board benchmark application. Every implementation, whatever its backend/frontend pair, must satisfy **all** requirements in this document. Stack-specific setup, tooling and versions live in the `TECH.md` file of each stack directory:

| Stack directory | Backend | Frontend | Persistence |
|---|---|---|---|
| `fastapi-htmx/` | FastAPI | htmx (server-rendered Jinja2) | SQLAlchemy ORM + Alembic migrations, SQLite |
| `nestjs-react/` | NestJS | React (Vite SPA) | Prisma ORM + Prisma Migrate, SQLite |
| `gin-sveltekit/` | Gin (Go) | SvelteKit | GORM + goose migrations, SQLite |

If this PRD and a `TECH.md` conflict, **the PRD wins on behaviour** (what the app does, the API contract, and the runtime contract), and **`TECH.md` wins on technology** (which libraries, versions and project layout to use).

---

## 1. Purpose and benchmark context

This application is a coding-ability test for locally hosted LLMs. One LLM produces one implementation, working from this PRD plus exactly one `TECH.md`.

- An implementation lives in `kanban-board/<backend>-<frontend>/<llm-name>/`, for example `kanban-board/fastapi-htmx/qwen3-coder-30b/`. `<llm-name>` is lowercase kebab-case and includes the model size or quant when relevant.
- The implementation directory must be **self-contained**. It must not reference files outside itself, apart from public package registries and container image registries during the build.
- Every implementation exposes the **same HTTP JSON API (§6)**, the **same runtime contract (§8)** and the **same UI test hooks (§7.4)**. This lets one black-box test suite and one evaluator score every implementation the same way.
- The LLM must not ask clarifying questions. When something is ambiguous, it picks the simplest reasonable interpretation and records it in `NOTES.md` (§10).

## 2. Product summary

The product is a single-user, self-hosted Kanban board. A user creates boards. A board holds ordered columns (lists), and each column holds ordered cards. The user moves cards between columns with drag-and-drop and can also move them without a mouse. Columns may have a work-in-progress (WIP) limit, which the server enforces. Cards can carry a priority, a due date and board-scoped coloured labels. All data is stored in a single SQLite database file that survives container restarts.

### 2.1 Personas

- **Solo user:** tracks personal or small-team work in a browser on desktop or mobile.
- **Evaluator (benchmark harness):** drives the JSON API and the UI automatically and checks the results against this spec.

### 2.2 Out of scope

These features must **not** be built. Adding them does not earn points and may cost points for scope creep:

- authentication, users, sharing or permissions
- real-time multi-client sync (WebSockets or SSE); a page reload is enough to see other clients' changes
- attachments, comments, checklists, activity history, archiving
- i18n (the UI language is English), and any theme choice beyond the default
- any external service at runtime (CDNs, analytics, web fonts from third-party hosts)

## 3. Glossary

| Term | Meaning |
|---|---|
| Board | A named container of columns and labels. |
| Column | An ordered list inside a board (e.g. "To Do"). It may have a WIP limit. |
| Card | A work item inside exactly one column. |
| Label | A board-scoped coloured tag. It can be attached to many cards on the same board. |
| Position | A 0-based integer index giving the order of a column within its board or a card within its column. |
| WIP limit | The maximum number of cards allowed in a column. `null` means unlimited. |

## 4. Data model

The logical model is below. Physical table and column names are up to the implementation, but the JSON field names in §6 are fixed.

```
Board 1───* Column 1───* Card *───* Label *───1 Board
```

### 4.1 Board
| Field | Type | Rules |
|---|---|---|
| id | integer | Primary key, auto-increment |
| name | string | Required; trimmed; 1–100 chars |
| description | string | Optional; ≤ 1000 chars; defaults to `""` |
| created_at | datetime (UTC) | Set by the server |
| updated_at | datetime (UTC) | Set by the server on every change to the board's own fields |

### 4.2 Column
| Field | Type | Rules |
|---|---|---|
| id | integer | Primary key |
| board_id | integer | FK → Board, `ON DELETE CASCADE` |
| name | string | Required; trimmed; 1–50 chars |
| position | integer | 0-based; contiguous within the board (no gaps, no duplicates) |
| wip_limit | integer or null | `null` = unlimited; otherwise 1–999 |
| created_at, updated_at | datetime (UTC) | Set by the server |

### 4.3 Card
| Field | Type | Rules |
|---|---|---|
| id | integer | Primary key |
| column_id | integer | FK → Column, `ON DELETE CASCADE` |
| title | string | Required; trimmed; 1–200 chars |
| description | string | Optional; ≤ 5000 chars; defaults to `""`; plain text (it must be HTML-escaped when rendered) |
| priority | enum | One of `low`, `medium`, `high`, `urgent`; default `medium` |
| due_date | date or null | ISO-8601 calendar date `YYYY-MM-DD` |
| position | integer | 0-based; contiguous within the column |
| created_at, updated_at | datetime (UTC) | Set by the server |

### 4.4 Label
| Field | Type | Rules |
|---|---|---|
| id | integer | Primary key |
| board_id | integer | FK → Board, `ON DELETE CASCADE` |
| name | string | Required; trimmed; 1–30 chars; unique within a board (case-insensitive) |
| color | string | `#RRGGBB` hex; the server stores it lowercased |

### 4.5 CardLabel (join)
`card_id` FK → Card with cascade, and `label_id` FK → Label with cascade. The primary key is the composite `(card_id, label_id)`. A card may only carry labels from **its own board**.

### 4.6 Integrity rules
- SQLite foreign-key enforcement must be **on** (`PRAGMA foreign_keys = ON` on every connection).
- Deleting a board deletes its columns, cards, labels and card-label links. Deleting a column deletes its cards. Deleting a label removes it from every card.
- After **every** mutation, positions within the affected board or column(s) must be contiguous `0..n-1`. Operations that change positions must run in a **single database transaction**.
- The schema must be created and evolved **only through migrations** (§8.3), never through an ORM "create all" or auto-migrate call at runtime.

## 5. Functional requirements

Requirement IDs (e.g. `BRD-3`) are referenced by the evaluator.

### 5.1 Boards
- **BRD-1** List all boards on the home page (`/`), ordered by `created_at` descending. Each entry shows the board's name, its description (truncated to one line) and its total card count.
- **BRD-2** Create a board with a name and an optional description. A new board automatically gets three columns: `To Do` (position 0), `In Progress` (1) and `Done` (2), all with no WIP limit.
- **BRD-3** Rename a board or edit its description.
- **BRD-4** Delete a board after an in-page confirmation. Native `confirm()` is allowed. The delete cascades as described in §4.6.
- **BRD-5** Open a board at `/boards/{id}`. An unknown id shows a friendly 404 page and returns HTTP status 404.

### 5.2 Columns
- **COL-1** Columns appear left-to-right in `position` order. When they overflow the viewport, the row scrolls horizontally.
- **COL-2** Add a column. It is appended at the end.
- **COL-3** Rename a column inline and set or clear its WIP limit.
- **COL-4** Reorder columns. Drag-and-drop is required, **and** a non-drag control ("◀ / ▶" buttons or a menu) must also be available.
- **COL-5** Delete a column after confirmation. The confirmation states how many cards will be deleted.
- **COL-6** Each column header shows the card count, formatted as `n` when there is no limit and `n / limit` when there is one. When `n == limit` the header gets a visual "full" state (e.g. an amber colour).

### 5.3 Cards
- **CRD-1** Add a card from the bottom of any column by typing a title and pressing Enter or clicking "Add". The card is appended at the end of that column.
- **CRD-2** Each card tile shows the title, a priority indicator, its labels (as coloured chips) and its due date if it has one. A card whose due date is before today (server local date = UTC) is marked **overdue** (e.g. a red date).
- **CRD-3** Clicking a card opens a detail view (a modal/dialog or a dedicated route) where every field is editable: title, description, priority, due date (can be cleared) and labels (multi-select from the board's labels).
- **CRD-4** Delete a card from the detail view after confirmation.
- **CRD-5** Move a card within its column or to another column with **drag-and-drop**. A drop at any index lands the card at exactly that index.
- **CRD-6** Move a card **without drag-and-drop** from the detail view: pick a target column from a `<select>`, and the card is appended at the end of that column.
- **CRD-7** **WIP enforcement:** moving or creating a card into a column that is already at its WIP limit is rejected by the server (409, §6.3). The UI shows a readable error message, and the card visibly stays in or returns to its original place. Reordering a card inside its own column is never blocked. Lowering a WIP limit below a column's current count is **allowed**; afterwards the column simply refuses new cards until it is under the limit again.

### 5.4 Labels
- **LBL-1** Manage a board's labels (create, rename, recolour, delete) from a "Labels" panel or dialog on the board page.
- **LBL-2** Assigning a label that belongs to a different board is rejected (422).
- **LBL-3** Creating a label whose name duplicates an existing one on the same board (case-insensitive) is rejected (409).

### 5.5 Search and filter
- **FLT-1** The board page has a text filter. As the user types (debounced to ≤ 300 ms), only cards whose title or description contains the text (case-insensitive) are shown.
- **FLT-2** Filter by priority (single select, with "any") and by label (single select, with "any"). All filters combine with AND.
- **FLT-3** Column counts (COL-6) always show the **unfiltered** totals. The filter is reflected in the URL query string (`?q=&priority=&label=`), so a filtered view survives a reload.

### 5.6 Demo data
- **SEED-1** When the environment variable `SEED_DEMO=true` is set and the database has **zero boards** at startup, the app creates one board named `Demo Board`. It has the default columns, three labels (`bug` `#d73a4a`, `feature` `#0e8a16`, `chore` `#6a737d`) and at least 6 cards spread across the columns with mixed priorities. At least one card is overdue and at least one has two labels. Seeding must be idempotent: it never runs when any board exists.

## 6. HTTP JSON API contract

This API is **mandatory for every stack**, including `fastapi-htmx`, whose HTML UI must use the same service layer. All paths are under `/api`. Requests and responses use `application/json; charset=utf-8`.

### 6.1 Conventions
- JSON keys are **snake_case**.
- Datetimes are ISO-8601 in UTC with a `Z` suffix, e.g. `2026-09-30T14:03:11Z`. Fractional seconds are optional.
- Dates are `YYYY-MM-DD`.
- `PATCH` means a partial update: fields that are absent stay unchanged. For nullable fields (`wip_limit`, `due_date`), sending an explicit `null` **clears** the value. Implementations must tell "absent" apart from "null".
- Unknown JSON fields in request bodies are ignored.
- IDs are integers. A non-integer id in a path gives 404 or 422 (either is accepted).
- Successful `POST` create operations return **201** with the created resource. `DELETE` returns **204** with an empty body. Everything else returns **200**.

### 6.2 Resource representations

```jsonc
// Label
{ "id": 3, "board_id": 1, "name": "bug", "color": "#d73a4a" }

// Card
{
  "id": 12, "column_id": 4, "title": "Fix login", "description": "",
  "priority": "high", "due_date": "2026-10-02", "position": 0,
  "labels": [ { "id": 3, "board_id": 1, "name": "bug", "color": "#d73a4a" } ],   // ordered by label name
  "created_at": "2026-09-30T14:03:11Z", "updated_at": "2026-09-30T14:03:11Z"
}

// Column
{ "id": 4, "board_id": 1, "name": "To Do", "position": 0, "wip_limit": null,
  "card_count": 5, "created_at": "...", "updated_at": "..." }

// BoardSummary (list view)
{ "id": 1, "name": "Demo Board", "description": "", "card_count": 9,
  "created_at": "...", "updated_at": "..." }

// BoardDetail
{ "id": 1, "name": "Demo Board", "description": "", "created_at": "...", "updated_at": "...",
  "labels":  [ Label... ],                          // ordered by name
  "columns": [ { ...Column, "cards": [ Card... ] } ] // columns by position, cards by position
}
```

### 6.3 Errors
Every non-2xx response (including 404s for unknown routes under `/api`) has this body:

```json
{ "error": { "code": "validation_error", "message": "Human readable summary", "details": [ { "field": "title", "message": "must not be empty" } ] } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | The body is not valid JSON |
| 404 | `not_found` | The resource (or a referenced parent) does not exist |
| 409 | `wip_limit_reached` | A card create or move would exceed the target column's WIP limit |
| 409 | `conflict` | Duplicate label name on the board |
| 422 | `validation_error` | A field fails a rule in §4. `details` lists each offending field |
| 500 | `internal_error` | Unexpected errors. The body never contains stack traces |

### 6.4 Endpoints

| Method & path | Body | Response |
|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok","db":"ok"}`. It must actually query the DB, and returns 503 with `"db":"error"` when the DB is unavailable |
| `GET /api/boards` | — | `BoardSummary[]` ordered by `created_at` desc |
| `POST /api/boards` | `{name, description?}` | `201 BoardDetail`, with the three default columns |
| `GET /api/boards/{id}` | — | `BoardDetail` |
| `PATCH /api/boards/{id}` | `{name?, description?}` | `BoardDetail` |
| `DELETE /api/boards/{id}` | — | `204` |
| `POST /api/boards/{id}/columns` | `{name, wip_limit?}` | `201 Column`, appended at the end |
| `PATCH /api/columns/{id}` | `{name?, wip_limit?}` | `Column` |
| `POST /api/columns/{id}/move` | `{position}` | `Column[]`: every column of the board in their new order |
| `DELETE /api/columns/{id}` | — | `204`; the remaining columns are re-packed |
| `POST /api/columns/{id}/cards` | `{title, description?, priority?, due_date?, label_ids?}` | `201 Card`, appended; 409 if the WIP limit is reached |
| `GET /api/cards/{id}` | — | `Card` |
| `PATCH /api/cards/{id}` | `{title?, description?, priority?, due_date?, label_ids?}` | `Card`; `label_ids` **replaces** the full set of labels |
| `POST /api/cards/{id}/move` | `{column_id, position}` | `Card`; 409 if moving to a *different* column that is full |
| `DELETE /api/cards/{id}` | — | `204`; the column is re-packed |
| `GET /api/boards/{id}/labels` | — | `Label[]` ordered by name |
| `POST /api/boards/{id}/labels` | `{name, color}` | `201 Label` |
| `PATCH /api/labels/{id}` | `{name?, color?}` | `Label` |
| `DELETE /api/labels/{id}` | — | `204` |
| `GET /api/boards/{id}/cards?q=&priority=&label_id=` | — | `Card[]` matching all given filters, ordered by column position then card position |

### 6.5 Move semantics (normative)
- `position` is the **target 0-based index in the final ordering**. Values `< 0` are clamped to 0. Values past the end are clamped to the last valid index, i.e. `n-1` within the same list, or `n` when the card is appended to another column.
- Moving to the same list at the same index is a no-op and returns 200.
- A card move to another column must: remove the card from its source column and re-pack the source; insert it into the target at `position` and shift the later cards; set the card's `column_id`; and update `updated_at`. All of this happens in one transaction.
- A card cannot be moved to a column on a different board (422).

## 7. User interface requirements

### 7.1 General
- **Pages:** `/` (board list) and `/boards/{id}` (board view). The card detail can be a modal on the board page or `/boards/{id}/cards/{card_id}`. If it is a modal, deep-linking is a bonus, not a requirement.
- Mutations are persisted **on the server** before the UI reports success. Optimistic UI is allowed only if it rolls back on error.
- A reload after any action shows the same state (no client-only state for data).
- Errors from the API are shown in a non-blocking toast or banner, never with `alert()`. Inline validation messages appear next to form fields.
- Loading states: while a request is in flight, submit buttons are disabled.
- **Responsive:** usable at 375 px width (columns scroll horizontally; the modal becomes full-screen).
- **Accessibility:** every interactive element can be reached and operated with the keyboard. Inputs have labels. Colour is never the only carrier of meaning (e.g. the priority also has text or an icon). Dialogs trap focus and close on `Esc`.
- All user-supplied text is HTML-escaped. **XSS in any field is a critical failure.**

### 7.2 Visual design
Clean and neutral. Columns are cards/panels on a light-grey board background. The priority colours are: low = grey, medium = blue, high = orange, urgent = red. No external fonts or icon CDNs; system font stack and inline SVG/Unicode only.

### 7.3 Page title
`<title>` is `Kanban` on the home page and `<Board name> · Kanban` on a board page.

### 7.4 Test hooks (mandatory `data-testid` attributes)
The evaluator's browser tests (Playwright) depend on these exact attributes:

| `data-testid` | Element |
|---|---|
| `board-list` | Container of board entries on `/` |
| `board-item` | Each board entry. It also carries `data-board-id="{id}"` and contains a link to the board |
| `new-board-name`, `new-board-description`, `new-board-submit` | Create-board form controls |
| `board-title` | Board name heading on the board page |
| `column` | Each column, with `data-column-id="{id}"` |
| `column-name` | Column name display/edit element |
| `column-count` | The `n` / `n / limit` count |
| `add-column-name`, `add-column-submit` | Add-column controls |
| `card` | Each card tile, with `data-card-id="{id}"` |
| `card-title` | Title inside the tile |
| `add-card-input` | Per-column new-card title input (one per column) |
| `card-detail` | Card detail dialog/page root |
| `card-detail-title`, `card-detail-description`, `card-detail-priority`, `card-detail-due-date`, `card-detail-column`, `card-detail-save`, `card-detail-delete` | Card detail controls |
| `filter-q`, `filter-priority`, `filter-label` | Filter controls |
| `labels-open` | Button that opens label management |
| `toast` | Error/success message element (only present while it is visible) |
| `confirm-yes` | Confirm button of any custom confirmation dialog (not needed if native `confirm()` is used) |

The browser tests also rely on these conventions:

- **Selects:**
  - `filter-priority` and `card-detail-priority` are `<select>` elements whose option values are `low`, `medium`, `high` and `urgent`. `filter-priority` also has an "any" option with an empty value.
  - `filter-label` is a `<select>` whose option values are label ids and whose option text is the label name. It also has an "any" option.
  - `card-detail-column` is a `<select>` whose option values are column ids and whose option text is the column name.
  - `card-detail-due-date` is an `<input type="date">`.
- **Moving via `card-detail-column`:** a new selection takes effect either immediately or when the user clicks `card-detail-save`.
- **Board links:** each `board-item` contains an `<a>` link to `/boards/{id}`.
- **Delete-board control:** a `<button>` whose accessible name contains **"Delete board"** on the board page, or one whose name contains **"Delete"** inside the `board-item`.
- **Label management:** opening `labels-open` shows every label name of the board as visible text.
- **Card tiles:** a `card` tile shows the names of its labels as text.
- **Opening a card:** clicking a `card` tile opens `card-detail`.
- **Drag-and-drop:** drag works with a real pointer (mouse down → move → up). Dropping below the last card of a column, or anywhere in an empty column's card area, must place the card in that column.

## 8. Runtime and deployment contract

### 8.1 Docker
- The implementation directory contains a `docker-compose.yaml` at its root and one `Dockerfile` per image it builds.
- From a clean machine with only Docker Engine ≥ 27 and Compose v2, run from the implementation directory:
  ```bash
  docker compose up --build -d
  ```
  Within **120 seconds** of the images finishing their build, the full app must be reachable at **http://localhost:8080**, with the UI at `/` and the API at `/api/*` on the **same origin**.
- The only host port published is `8080`. Internal services talk over the default Compose network.
- **Data persistence:** SQLite lives at `/data/kanban.db` inside the container that owns the DB, and `/data` is mounted to a **named volume** `kanban-data`. Running `docker compose down && docker compose up -d` keeps all data. `docker compose down -v` resets it.
- Every long-running service has a Compose `healthcheck`. Services that depend on another service use `depends_on: { <svc>: { condition: service_healthy } }`.
- Containers run as a **non-root** user.
- Images are multi-stage: build tools, dev dependencies and compilers are not in the final runtime images.
- No secrets are required. Configuration comes from environment variables with sane defaults. `SEED_DEMO` defaults to `true` in `docker-compose.yaml`.
- The build must not depend on host state: no pre-built artefacts, no `node_modules`, `.venv` or binaries copied from the host. A `.dockerignore` excludes them.
- Front-end assets (htmx, SortableJS and so on) are installed through the package manager or vendored in the repo. They are **never** loaded from a CDN at runtime.

### 8.2 SQLite configuration
Each connection must apply: `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000` ms. Run a **single application process/worker** that writes to the DB. Do not scale horizontally.

### 8.3 Migrations
- Migrations are checked into the repo and applied automatically on container start (entrypoint or one-shot migrate service) **before** the app starts accepting traffic.
- Starting against an empty volume creates the schema. Starting against an up-to-date DB is a no-op.
- The initial migration creates the whole §4 schema, including FKs, cascades, the unique constraint on labels (case-insensitive, e.g. `UNIQUE(board_id, name COLLATE NOCASE)` or an equivalent index) and indexes on every FK column.

### 8.4 Logging
Log one line per HTTP request (method, path, status, duration) to stdout. Unhandled exceptions are logged with a stack trace to stdout, never to the client.

## 9. Quality requirements

- **Tests:** backend tests cover at least: create board with default columns; card create/move/reorder with contiguous positions; the WIP-limit 409 path; label cross-board rejection; cascade delete; PATCH `null` clearing `due_date`; and the error envelope shape. Tests use a temporary SQLite database and run with a single documented command locally. The backend Dockerfile must also have a stage named **`test`**: the evaluator runs `docker build --target test <backend context> && docker run --rm <image>`, and a zero exit code counts as passing. The backend context is the implementation root for `fastapi-htmx` and `./backend` for the other stacks. Frontend tests are optional (bonus).
- **Code quality:** the stack's standard linter/formatter is configured and passes. Business rules (positions, WIP) live in a service/domain layer, not in route handlers or templates. There is no dead scaffold code (e.g. the default "Hello World" controller is removed).
- **Performance:** a board with 10 columns × 100 cards loads its API detail in < 300 ms on a laptop. There are no N+1 queries on `GET /api/boards/{id}` (use eager loading or batched queries).
- **Security:** parameterised queries only; output escaping; request body size limit ≤ 1 MB; no CORS needed (same origin). If CORS is configured anyway it must not be `*` with credentials.

## 10. Deliverables (inside `kanban-board/<stack>/<llm-name>/`)

| File | Content |
|---|---|
| `docker-compose.yaml` | As described in §8.1 |
| `Dockerfile`(s) | One per built image, multi-stage |
| `.dockerignore` | Per build context |
| `README.md` | Prerequisites, `docker compose up --build`, local dev without Docker, how to run tests and lint, and the project layout |
| `NOTES.md` | The LLM's own report: interpretations of ambiguous points, known gaps, deviations from PRD/TECH, and the exact library versions used |
| Source, migrations, tests | As prescribed by `TECH.md` |

## 11. Acceptance and scoring (for the evaluator)

Scoring is out of 100. Critical failures cap the score as noted.

| Area | Points | Checked by |
|---|---|---|
| `docker compose up --build` works from scratch; health is green; data survives a restart | 15 | Scripted |
| API contract conformance (§6), black-box suite | 25 | Scripted |
| Move/position/WIP correctness (§5.3, §6.5), including randomised move sequences checked for contiguity | 15 | Scripted |
| UI flows via Playwright using the §7.4 test hooks (create board → add cards → drag → filter → edit → delete) | 20 | Scripted |
| Backend tests present and passing (the Docker `test` target) | 10 | Scripted |
| Adherence to `TECH.md` (versions, ORM, migration tool, layout) | 10 | Review |
| Code clarity, layering, lint clean, README/NOTES quality | 5 | Review |

**Critical failures:**
- The app does not start → the score is capped at 10.
- XSS is possible → capped at 40.
- Data is lost on restart → capped at 50.
- Schema is created without migrations → −10.
