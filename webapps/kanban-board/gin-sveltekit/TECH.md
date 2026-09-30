# TECH.md — Gin (Go) + SvelteKit + GORM/goose + SQLite

Read `../PRD.md` first. This document tells you **how** to build it. The PRD tells you **what** to build.
Your implementation goes in `kanban-board/gin-sveltekit/<llm-name>/`. All paths below are relative to that directory.

---

## 1. Pinned versions (latest stable as of 2026-09-30)

Pin everything exactly: `go.mod` with the exact versions below, and npm with `-E`. Commit `go.sum` and `package-lock.json`. Do not use pre-releases.

| Component | Version | Notes |
|---|---|---|
| Go | **1.27.1** | `go.mod`: `go 1.27` (you may add `toolchain go1.27.1`). Docker image `golang:1.27-trixie` |
| Gin | **v1.12.0** | `github.com/gin-gonic/gin` |
| GORM | **v1.31.2** | `gorm.io/gorm`. The ORM, used for all queries |
| GORM SQLite driver | **v1.6.0** | `gorm.io/driver/sqlite`. Wraps `github.com/mattn/go-sqlite3`, so it **needs CGO** (see §6) |
| goose | **v3.28.0** | `github.com/pressly/goose/v3`. Versioned SQL migrations, embedded in the binary |
| testify | v1.12.1 | `github.com/stretchr/testify`. Test assertions |
| Node.js | **24 LTS** (24.21.0) | Frontend build and runtime. Image `node:24-trixie-slim`. Use **npm** |
| SvelteKit | **2.70.3** | `@sveltejs/kit`. Scaffold with `sv@0.17.1` |
| Svelte | **5.57.1** | **Runes mode only** (see §5.3) |
| @sveltejs/adapter-node | **5.5.7** | Replaces `adapter-auto` |
| Vite | the version the `sv` scaffold installs (8.x) | Do not change it |
| svelte-dnd-action | **0.9.79** | Drag-and-drop (supports Svelte 5 and keyboard) |

> **ORM and migrations:** GORM is the ORM. **`AutoMigrate` is forbidden** (PRD §4.6, §8.3). The schema comes only from goose SQL migrations.

## 2. Architecture

```
Browser ──▶ :8080 SvelteKit (frontend container, adapter-node, port 3000)
              ├── SSR pages + form actions ──(server-side fetch, API_URL)──┐
              └── /api/[...path] proxy route ─────────────────────────────┤
                                                                           ▼
                                          Gin (backend container, :8081, not published)
                                          handlers → service → GORM ──▶ SQLite /data/kanban.db
```

- **Two images:** `backend` (a static-ish Go binary on distroless) and `frontend` (a Node server built by SvelteKit's adapter-node).
- The browser talks **only** to the SvelteKit origin on `:8080`. PRD §8.1 requires `/api/*` on the same origin, so SvelteKit has a **catch-all proxy route** `src/routes/api/[...path]/+server.ts` that forwards to Gin **transparently**: same method, path, query, body, status and JSON.
- Page data is loaded server-side in `+page.server.ts` `load` functions. Mutations use **SvelteKit form actions** with `use:enhance`, except drag-and-drop and the filter, which run client-side through the `/api` proxy.
- **Backend layering:** `httpapi` (Gin handlers, DTOs, error mapping) → `service` (all business rules and transactions) → GORM models. Handlers never run queries themselves.

## 3. Project layout

```
.
├── docker-compose.yaml
├── README.md
├── NOTES.md
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── go.mod / go.sum
│   ├── cmd/kanban/main.go           # subcommands: serve (default), migrate, healthcheck
│   └── internal/
│       ├── config/config.go         # env: DATABASE_PATH, PORT, SEED_DEMO, GIN_MODE
│       ├── db/db.go                 # Open(), with the DSN pragmas and pool settings
│       ├── migrations/
│       │   ├── embed.go             # //go:embed *.sql → var FS embed.FS
│       │   └── 00001_initial_schema.sql
│       ├── model/model.go           # GORM structs
│       ├── service/{boards.go, columns.go, cards.go, labels.go, positions.go, errors.go}
│       ├── httpapi/{router.go, middleware.go, errors.go, optional.go, boards.go, columns.go, cards.go, labels.go, health.go, dto.go}
│       └── seed/seed.go
│   (tests next to the code: *_test.go, plus internal/httpapi/api_test.go for end-to-end HTTP tests)
└── frontend/
    ├── Dockerfile
    ├── .dockerignore
    ├── package.json / package-lock.json
    ├── svelte.config.js / vite.config.ts / tsconfig.json
    └── src/
        ├── app.html / app.d.ts / app.css
        ├── lib/
        │   ├── types.ts                 # PRD §6.2 types (snake_case)
        │   ├── server/backend.ts        # server-only helper: backendFetch(event.fetch, path, init)
        │   ├── api.ts                   # browser helper for /api (throws ApiError)
        │   └── components/{Column.svelte, CardTile.svelte, CardDialog.svelte, LabelsDialog.svelte, Filters.svelte, Toast.svelte}
        └── routes/
            ├── +layout.svelte / +error.svelte
            ├── +page.svelte / +page.server.ts                   # board list and createBoard action
            ├── boards/[id]/+page.svelte / +page.server.ts       # board view and its actions
            ├── api/[...path]/+server.ts                         # transparent proxy to Gin
            └── healthz/+server.ts                               # container healthcheck
```

## 4. Backend

### 4.1 Bootstrap

```bash
mkdir backend && cd backend
go mod init kanban
go get github.com/gin-gonic/gin@v1.12.0 gorm.io/gorm@v1.31.2 gorm.io/driver/sqlite@v1.6.0 \
       github.com/pressly/goose/v3@v3.28.0 github.com/stretchr/testify@v1.12.1
go mod tidy
```
A C toolchain is needed locally for CGO. It is already there on macOS (Xcode CLT) and on Debian (`build-essential`).

### 4.2 Database opening (`internal/db`)

- DSN (mattn/go-sqlite3 syntax). The PRAGMAs go **in the DSN**, so they apply to *every* pooled connection:
  ```go
  dsn := fmt.Sprintf("file:%s?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate", path)
  gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
      NowFunc:                func() time.Time { return time.Now().UTC() },
      TranslateError:         true,               // maps unique violations to gorm.ErrDuplicatedKey
      Logger:                 logger.Default.LogMode(logger.Warn),
  })
  sqlDB, _ := gdb.DB()
  sqlDB.SetMaxOpenConns(1)   // a single writer connection. It avoids SQLITE_BUSY, and it is plenty for this app
  ```
- ⚠️ With `SetMaxOpenConns(1)`, **never use the outer `*gorm.DB` inside a `Transaction(func(tx *gorm.DB) error {...})` callback**. Use only `tx`, or the request will deadlock.
- `_txlock=immediate` makes every transaction take the write lock up front. That avoids lock-upgrade deadlocks.
- At startup, assert that `PRAGMA foreign_keys` returns `1`.

### 4.3 Migrations (goose, embedded)

- `internal/migrations/embed.go`:
  ```go
  package migrations
  import "embed"
  //go:embed *.sql
  var FS embed.FS
  ```
- Each SQL file uses goose annotations: `-- +goose Up` / `-- +goose Down`. `00001_initial_schema.sql` hand-writes the full PRD §4 schema:
  - `INTEGER PRIMARY KEY AUTOINCREMENT` ids
  - `REFERENCES … ON DELETE CASCADE` on every FK
  - `CHECK (priority IN ('low','medium','high','urgent'))`
  - `CREATE UNIQUE INDEX ux_labels_board_name ON labels(board_id, name COLLATE NOCASE)`
  - an index on every FK column
  - `DATETIME` columns stored as UTC
  - `due_date TEXT NULL` (`YYYY-MM-DD`)
  - Do **not** put a unique constraint on positions (re-packing updates rows one at a time).
- Run the migrations from Go with the goose Provider API. Verify the exact signature against the v3.28.0 package docs:
  ```go
  p, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, migrations.FS)
  _, err = p.Up(ctx)
  ```
- `kanban migrate` applies the migrations and exits. `kanban serve` (the default) **applies migrations first, then** seeds (if enabled), then listens. Both are idempotent.
- There is no `AutoMigrate` call anywhere, including in tests.

### 4.4 GORM models (`internal/model`)

- **Do not embed `gorm.Model`.** Its `DeletedAt` turns on *soft delete*, which breaks the cascade semantics. Declare `ID uint64`, `CreatedAt time.Time` and `UpdatedAt time.Time` explicitly. GORM fills the timestamps automatically.
- Name the column struct `BoardColumn` with `TableName() string { return "board_columns" }`.
- Relations:
  - `Board.Columns []BoardColumn` and `BoardColumn.Cards []Card` (has-many)
  - `Card.Labels []Label \`gorm:"many2many:card_labels;"\``
  - `Board.Labels []Label`
- Nullable fields are pointers: `WipLimit *int`, `DueDate *string`.
- Board detail uses ordered preloads and **no N+1**:
  ```go
  tx.Preload("Columns", func(db *gorm.DB) *gorm.DB { return db.Order("position") }).
     Preload("Columns.Cards", func(db *gorm.DB) *gorm.DB { return db.Order("position") }).
     Preload("Columns.Cards.Labels", func(db *gorm.DB) *gorm.DB { return db.Order("name COLLATE NOCASE") }).
     Preload("Labels", func(db *gorm.DB) *gorm.DB { return db.Order("name COLLATE NOCASE") }).
     First(&board, id)
  ```
- GORM gotchas you must handle:
  - `Updates(struct)` **skips zero values**, so `0`, `""` and `nil` are never written. For PATCH, use `Updates(map[string]any{...})` or `Select(cols...).Updates(...)`, so that clearing `due_date` to NULL works.
  - Replacing a card's labels: `tx.Model(&card).Association("Labels").Replace(labels)`. First verify that every label belongs to the card's board (422 otherwise).
  - `First` returns `gorm.ErrRecordNotFound` → map it to a `service.ErrNotFound`.
  - `DELETE` must rely on the DB cascade: `tx.Delete(&model.Board{}, id)`. Check `RowsAffected == 0` → 404.

### 4.5 Services (`internal/service`)

- Exported sentinel/typed errors: `ErrNotFound`, `ErrWipLimit`, `ErrConflict`, and `ValidationError{Details []FieldError}`. The HTTP layer maps them with `errors.Is` / `errors.As`.
- Every position-changing operation runs in `db.Transaction(...)`: load the sibling IDs ordered by position, reorder them in memory with the pure functions in `positions.go` (unit-test these), then write back only the positions that changed.
- The WIP check runs inside the same transaction as the move or create.
- Business validation that `binding` tags cannot express (trimmed length, date validity, label ownership) lives here.

### 4.6 HTTP layer (`internal/httpapi`)

- `gin.SetMode(gin.ReleaseMode)` unless `GIN_MODE=debug`. Build the engine with `gin.New()`, **not** `gin.Default()`, and add your own middleware:
  1. **Request logger**: one line per request, `METHOD path status duration`.
  2. **Recovery**: use `gin.CustomRecovery`, which logs the stack trace to stdout and responds with the 500 `internal_error` envelope.
  3. **Body limit**: `c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)`.
- `r.SetTrustedProxies(nil)`. `r.NoRoute(...)` returns the 404 `not_found` envelope for every path, since everything the backend serves is `/api/*`.
- **JSON binding and errors:**
  - Use `c.ShouldBindJSON(&dto)`, never `BindJSON`, because `BindJSON` writes a 400 on its own.
  - `*json.SyntaxError`, `io.ErrUnexpectedEOF` and `*json.UnmarshalTypeError` → 400 `bad_request`. Treating a type error as 400 is acceptable; 422 is also acceptable.
  - `validator.ValidationErrors` → 422 `validation_error`. Register a tag-name func on the validator engine (`binding.Validator.Engine().(*validator.Validate).RegisterTagNameFunc(...)`), so `details[].field` uses **json names** (`wip_limit`), not Go names (`WipLimit`).
- **PATCH absent vs. null.** Implement a small generic type in `optional.go`:
  ```go
  type Optional[T any] struct { Set bool; Null bool; Value T }
  func (o *Optional[T]) UnmarshalJSON(b []byte) error { o.Set = true; if string(b) == "null" { o.Null = true; return nil }; return json.Unmarshal(b, &o.Value) }
  ```
  PATCH DTOs use `Optional[...]` fields and are validated in code, because `binding` tags do not work on them. Absent means `!Set`, and an explicit `null` means `Set && Null`.
- Path IDs: parse with `strconv.ParseUint`. On failure → 404.
- Response DTOs are separate structs with snake_case `json` tags that match PRD §6.2 exactly. Map models to DTOs in `dto.go`. `time.Time` values in UTC marshal as RFC 3339 with a `Z` suffix. Ensure `labels` and `cards` marshal as `[]`, not `null`: initialise the slices.
- Health: `sqlDB.PingContext` + `SELECT 1` → 200 `{"status":"ok","db":"ok"}`, or 503 `{"status":"error","db":"error"}`.
- Serve with an `http.Server` on `:${PORT}` (default `8081`), with `ReadHeaderTimeout` set and graceful shutdown on SIGINT/SIGTERM via `signal.NotifyContext`.
- `kanban healthcheck` subcommand: GET `http://127.0.0.1:${PORT}/api/health` with a 3 s timeout, then exit 0 or 1. The distroless image has **no shell, curl or wget**, so the Compose healthcheck calls the binary itself.

### 4.7 Seed
`seed.Run(ctx, svc)`: when `SEED_DEMO=true` and there are no boards, create PRD SEED-1 data through the **service layer**.

### 4.8 Backend tests
- Use `t.TempDir()` for each test (or test group) for a fresh DB file. Run the goose migrations, build the router, and drive it with `httptest.NewRecorder()`.
- Cover PRD §9, plus `positions.go` unit tests, a randomised-moves contiguity test and a `PRAGMA foreign_keys == 1` check.
- Quality gates: `gofmt -l .` prints nothing, `go vet ./...` is clean, and `go test ./...` passes. `golangci-lint` is a bonus.

## 5. Frontend

### 5.1 Scaffold

```bash
npx sv@0.17.1 create frontend --template minimal --types ts --no-add-ons --install npm
cd frontend
npx sv@0.17.1 add eslint prettier --install npm
npm uninstall @sveltejs/adapter-auto
npm install -D -E @sveltejs/adapter-node@5.5.7 svelte-dnd-action@0.9.79
```
Check `package.json`: `@sveltejs/kit` must be 2.70.3 and `svelte` must be 5.57.1. Pin them with `-E` if the scaffold resolved other versions. Keep **all** packages in `devDependencies`. adapter-node then bundles them into `build/`, so the runtime image needs no `node_modules`.

### 5.2 `svelte.config.js`
```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
  kit: { adapter: adapter() }
};
```

### 5.3 Svelte 5 rules (mandatory)
- Use runes only: `$props()`, `$state()`, `$derived()`, `$effect()` (sparingly). **No** `export let`, **no** `$:` reactive statements, **no** stores for local state.
- Use event attributes: `onclick={...}` and `onsubmit={...}`. **Not** `on:click`.
- Use snippets (`{#snippet}` / `{@render}`) instead of slots. Page components receive `let { data, form } = $props();`.
- `npm run check` (`svelte-check`) must report 0 errors and 0 warnings.

### 5.4 Server/backend communication
- `src/lib/server/backend.ts` reads the backend base URL from **`$env/dynamic/private`** (`env.API_URL`, default `http://localhost:8081`). ⚠️ **Do not** use `$env/static/private`. It is inlined at *build* time, and the Docker image must be configurable at *run* time.
- `+page.server.ts` `load` functions call `backendFetch(event.fetch, '/api/boards/…')`. When the backend returns 404, `throw error(404, 'Board not found')`. That renders `+error.svelte` with a **real HTTP 404** (BRD-5).
- **Form actions** handle create/update/delete (board, column, card, label). On a backend error, return `fail(status, { error: message, fieldErrors })`. The page shows `form.error` as a toast and the field errors inline. Use `use:enhance`, so the page does not do a full reload, and pass `{ reset: false }` where it matters.
- **Proxy route** `src/routes/api/[...path]/+server.ts`: export a `fallback: RequestHandler`, which handles every HTTP method. It forwards `request.method`, the path, `url.search`, the body (`await request.arrayBuffer()` for non-GET) and `content-type` to `${API_URL}/api/${params.path}`. It returns `new Response(res.body, { status: res.status, headers })`. Copy only `content-type` from the response headers, and drop `content-encoding`, `content-length` and `transfer-encoding`: Node's `fetch` has already decoded the body. The status and body must pass through unchanged, because the evaluator's API tests run through this proxy.
- `src/routes/healthz/+server.ts` returns `200 ok` without calling the backend.
- ⚠️ adapter-node **CSRF check:** set `ORIGIN=http://localhost:8080` in the container. Without it, every form action POST fails with `403 Cross-site POST form submissions are forbidden`.

### 5.5 UI implementation rules
- **Drag-and-drop with svelte-dnd-action:** the columns container is a `use:dndzone={{ items: columns, type: 'column', flipDurationMs: 150 }}`. Each card list is `use:dndzone={{ items: cards, type: 'card', flipDurationMs: 150 }}`, with the handlers `onconsider` and `onfinalize` (Svelte 5 event attribute syntax).
  - Items must carry `id`. Card ids and column ids come from different tables, so use `type` to keep the zones separate.
  - Keep the local ordering in a **writable `$derived`** that is recomputed from `data.board` whenever the server data changes: `let columns = $derived(data.board.columns.map(c => ({ ...c, cards: [...c.cards] })))`. In `consider`/`finalize`, **assign** to it. Svelte ≥ 5.25 allows overriding a `$derived` value.
  - In `onfinalize` of the *target* zone (`info.trigger === 'droppedIntoZone'`), compute the new index of `info.id` and `fetch('/api/cards/{id}/move', {method:'POST', body: JSON.stringify({column_id, position})})`. Then `await invalidateAll()`. On a non-2xx response, show the toast and `invalidateAll()`. The server truth restores the card's position (CRD-7).
  - svelte-dnd-action inserts a *shadow* placeholder item. Filter out items with `SHADOW_ITEM_MARKER_PROPERTY_NAME` before computing positions.
- **Filters:** the inputs update the URL with `goto(`?${params}`, { keepFocus: true, noScroll: true, replaceState: true })`, debounced by 250 ms. `load` reads `url.searchParams` and filters the cards. Either call `GET /api/boards/{id}/cards?...` or filter the board detail server-side. Column counts stay **unfiltered**.
- **Card detail:** a native `<dialog>` opened with `showModal()`. Its form posts to `?/updateCard`, `?/deleteCard` and `?/moveCard` (the `<select data-testid="card-detail-column">`).
- **Titles:** `<svelte:head><title>{data.board.name} · Kanban</title></svelte:head>`.
- **Styling:** plain CSS (`app.css` + component `<style>` blocks) with CSS variables for the priority colours. **No** UI kit or CSS framework.
- Add every `data-testid` from PRD §7.4. Never use `{@html}` with user data.

## 6. Docker

### 6.1 `backend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.27-trixie AS build
WORKDIR /src
ENV CGO_ENABLED=1
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/kanban ./cmd/kanban \
 && mkdir -p /out/data

FROM build AS test
CMD ["go", "test", "./..."]

FROM gcr.io/distroless/base-debian13:nonroot AS runtime
COPY --from=build /out/kanban /app/kanban
COPY --from=build --chown=65532:65532 /out/data /data
ENV DATABASE_PATH=/data/kanban.db PORT=8081 GIN_MODE=release
USER 65532:65532
EXPOSE 8081
ENTRYPOINT ["/app/kanban"]
CMD ["serve"]
```

- `mattn/go-sqlite3` needs **CGO** and glibc. That is why the build uses `golang:*-trixie` (gcc included) and the runtime uses `distroless/base-debian13`, which has glibc. **`distroless/static` or `scratch` will not work** unless you link fully statically. Do not cross-compile: build for the host platform.
- `/data` must exist and be owned by uid 65532 in the image. A new named volume inherits that ownership. Distroless has no `mkdir`, so the directory is created in the build stage.
- The first build compiles SQLite from C, which takes about 1 minute. Cache mounts make rebuilds fast.

`backend/.dockerignore`: `data`, `*.db*`, `.git`, `kanban` (a local binary).

### 6.2 `frontend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
USER node
EXPOSE 3000
CMD ["node", "build"]
```
(`node_modules` is nearly empty after `npm prune --omit=dev`, because everything is a devDependency and bundled. The copy is kept for safety.)

`frontend/.dockerignore`: `node_modules`, `build`, `.svelte-kit`.

### 6.3 `docker-compose.yaml`

```yaml
name: kanban-gin-sveltekit
services:
  backend:
    build:
      context: ./backend
      target: runtime
    image: kanban-gin-sveltekit-backend:latest
    environment:
      DATABASE_PATH: /data/kanban.db
      PORT: "8081"
      SEED_DEMO: "true"
    volumes:
      - kanban-data:/data
    expose:
      - "8081"
    healthcheck:
      test: ["CMD", "/app/kanban", "healthcheck"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      target: runtime
    image: kanban-gin-sveltekit-frontend:latest
    environment:
      API_URL: http://backend:8081
      ORIGIN: http://localhost:8080
      PORT: "3000"
    ports:
      - "8080:3000"
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

volumes:
  kanban-data:
```

Run the backend tests in Docker with `docker build --target test -t kanban-gin-test ./backend && docker run --rm kanban-gin-test`. Document this in the README.

## 7. Local development (document in README)

```bash
# terminal 1
cd backend && DATABASE_PATH=./data/kanban.db SEED_DEMO=true go run ./cmd/kanban serve
# terminal 2
cd frontend && API_URL=http://localhost:8081 npm run dev -- --port 8080
```

## 8. Definition of done (self-check before you finish)

- [ ] `docker compose down -v && docker compose up --build -d` → both services are healthy. `curl -s localhost:8080/api/health` returns `{"status":"ok","db":"ok"}` **through the SvelteKit proxy**, and `/` lists "Demo Board".
- [ ] `curl -si localhost:8080/boards/999999` → `HTTP/1.1 404`.
- [ ] `curl -s -XPOST localhost:8080/api/boards -H 'content-type: application/json' -d '{bad'` → 400 `bad_request` envelope. `PATCH /api/cards/{id}` with `{"due_date":null}` clears the date.
- [ ] Creating a board via the UI form works. There is no 403 CSRF error, which confirms `ORIGIN` is correct.
- [ ] `docker compose restart` → the data is still there. goose reports no new migrations.
- [ ] Drag a card into a full column → a toast appears, and the card snaps back.
- [ ] `gofmt -l .` is empty, and `go vet ./...` and `go test ./...` pass. `npm run check`, `npm run lint` and `npm run build` pass.
- [ ] `NOTES.md` lists the exact versions (`go list -m all | grep -E 'gin|gorm|goose'`, `npm ls --depth=0`).
