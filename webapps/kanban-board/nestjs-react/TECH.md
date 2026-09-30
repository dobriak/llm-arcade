# TECH.md — NestJS + React (Vite) + Prisma + SQLite

Read `../PRD.md` first. This document tells you **how** to build it. The PRD tells you **what** to build.
Your implementation goes in `kanban-board/nestjs-react/<llm-name>/`. All paths below are relative to that directory.

---

## 1. Pinned versions (latest stable as of 2026-09-30)

Pin runtime dependencies with **exact** versions (`npm install -E`) and commit both `package-lock.json` files. Do not use pre-releases.

| Component | Version | Notes |
|---|---|---|
| Node.js | **24 LTS** (24.21.0) | Docker image `node:24-trixie-slim`. npm is the one bundled with Node; **use npm, not pnpm or yarn** |
| NestJS (`@nestjs/core`, `common`, `platform-express`, `testing`) | **12.1.x** | Scaffold with `@nestjs/cli@12.0.8` |
| TypeScript (backend) | **~6.0** (the version the Nest 12 scaffold installs) | ⚠️ Do **not** upgrade the backend to TypeScript 7. The Nest 12 CLI toolchain depends on `typescript ~6.0` |
| Prisma CLI `prisma` | **7.10.0** | ⚠️ The npm `latest` dist-tag currently points at `8.0.0-rc.*`. Always install with the explicit version: `prisma@7.10.0` |
| `@prisma/client` | **7.10.0** | Must match the CLI exactly |
| `@prisma/adapter-better-sqlite3` | **7.10.0** | Driver adapters are **mandatory** in Prisma 7 |
| better-sqlite3 | 13.0.3 | Native module (the adapter's driver) |
| dotenv | 18.0.5 | Loaded by `prisma.config.ts` |
| class-validator / class-transformer | 0.15.1 / 0.5.1 | DTO validation with the global `ValidationPipe` |
| Jest / ts-jest / supertest | the versions from the Nest scaffold (Jest 30, supertest 7.3) | Backend tests |
| React / React DOM | **19.3.0** | |
| Vite | **8.3.x** (scaffold with `create-vite@9.2.1`, template `react-ts`) | Keep the TypeScript version the template installs |
| @vitejs/plugin-react | 6.1.1 | |
| @tanstack/react-query | **5.104.0** | All server state |
| react-router | **8.4.0** | Package `react-router` (declarative mode: `<BrowserRouter>`, `<Routes>`, `<Route>`) |
| @dnd-kit/core / sortable / utilities | **6.3.1 / 10.0.0 / 3.2.2** | Drag-and-drop |
| Vitest / @testing-library/react / jsdom | 5.0.3 / 16.3.3 / 30.1.1 | Frontend tests (optional bonus) |
| nginx (frontend runtime) | **1.30** | Image `nginxinc/nginx-unprivileged:1.30-alpine` (runs as non-root, listens on 8080) |

## 2. Architecture

```
Browser ──▶ :8080 nginx (frontend container) ──┬── /            → static React SPA (Vite build)
                                                └── /api/*       → proxy_pass http://backend:3000   (prefix kept)
                                                                     │
                                         NestJS (backend container) ─┴─▶ PrismaService ──▶ SQLite /data/kanban.db
```

- **Two images:** `backend` (NestJS on port 3000, not published) and `frontend` (nginx serving `dist/` and reverse-proxying `/api`, published as `8080`).
- The browser only ever talks to `:8080`. It is same-origin, so **no CORS**.
- **Backend layering:** `Controller` (HTTP, DTOs) → `Service` (business rules: positions, WIP, label/board checks; runs transactions) → `PrismaService`. Controllers never call Prisma directly.
- Nest feature modules: `BoardsModule`, `ColumnsModule`, `CardsModule`, `LabelsModule`, `HealthModule`, plus a global `PrismaModule`.

## 3. Project layout

```
.
├── docker-compose.yaml
├── README.md
├── NOTES.md
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── docker-entrypoint.sh
│   ├── package.json / package-lock.json
│   ├── nest-cli.json / tsconfig.json / tsconfig.build.json
│   ├── prisma.config.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/<timestamp>_init/migration.sql   # committed
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── generated/prisma/        # prisma generate output: git-ignored, generated at build time
│   │   ├── prisma/{prisma.module.ts,prisma.service.ts}
│   │   ├── common/{api-exception.filter.ts, domain-errors.ts, request-logger.middleware.ts, validation.ts, mappers.ts}
│   │   ├── boards/{boards.module.ts, boards.controller.ts, boards.service.ts, dto/*.ts}
│   │   ├── columns/…  cards/…  labels/…  health/…
│   │   ├── positions/positions.ts   # pure helpers for moving and re-packing
│   │   └── seed/seed.service.ts     # OnApplicationBootstrap
│   └── test/
│       ├── jest-e2e.json
│       ├── utils/test-app.ts        # boots the app against a temp SQLite file after running migrations
│       └── *.e2e-spec.ts
└── frontend/
    ├── Dockerfile
    ├── .dockerignore
    ├── nginx.conf
    ├── package.json / package-lock.json
    ├── vite.config.ts / tsconfig*.json / index.html
    └── src/
        ├── main.tsx / App.tsx
        ├── api/{client.ts, types.ts, hooks.ts}   # fetch wrapper, PRD §6.2 types, TanStack Query hooks
        ├── pages/{BoardListPage.tsx, BoardPage.tsx, NotFoundPage.tsx}
        ├── components/{Column.tsx, CardTile.tsx, CardDetailDialog.tsx, LabelsDialog.tsx, Filters.tsx, Toast.tsx, ConfirmDialog.tsx}
        └── styles/*.module.css
```

## 4. Backend

### 4.1 Scaffold

```bash
npx @nestjs/cli@12.0.8 new backend --package-manager npm --strict --skip-git
cd backend
npm install -E prisma@7.10.0 @prisma/client@7.10.0 @prisma/adapter-better-sqlite3@7.10.0 better-sqlite3@13.0.3 dotenv@18.0.5 class-validator@0.15.1 class-transformer@0.5.1
npm install -D -E @types/better-sqlite3@9.6.0
npx prisma init --datasource-provider sqlite --output ../src/generated/prisma
```

- `prisma` is installed as a **runtime** dependency on purpose. The container runs `prisma migrate deploy` at startup (§6.1).
- Delete `app.controller.ts`, `app.service.ts` and their spec. Keep `AppModule`.
- Add `src/generated/` to `.gitignore` and `.dockerignore`, and add `"prisma:generate": "prisma generate"` to the scripts.
- The Nest 12 scaffold compiles to **CommonJS** (with `module: nodenext` and no `"type": "module"`). Nest's own packages are ESM, and Node 24 loads them through `require(esm)`. Do **not** switch the project to `"type": "module"`.
- The scaffold ships with **oxlint** (`npm run lint`) and Prettier. Both must pass.

### 4.2 Prisma 7 configuration: rules that differ from Prisma ≤ 6

Prisma 7 changed several defaults, and a lot of online examples are out of date. Follow these exactly:

1. **The connection URL lives in `prisma.config.ts`, not in `schema.prisma`.** The `datasource` block only has `provider`.
   ```ts
   // prisma.config.ts
   import 'dotenv/config';
   import { defineConfig, env } from 'prisma/config';

   export default defineConfig({
     schema: 'prisma/schema.prisma',
     migrations: { path: 'prisma/migrations' },
     datasource: { url: env('DATABASE_URL') },
   });
   ```
   `.env` for local development: `DATABASE_URL="file:./data/kanban.db"`. **Env files are not auto-loaded in Prisma 7**, which is why the config imports `dotenv/config`.
2. **Generator:** use the `prisma-client` generator (not `prisma-client-js`). It needs an `output` path and **`moduleFormat = "cjs"`**. Without that, NestJS crashes at runtime with `ReferenceError: exports is not defined in ES module scope`.
   ```prisma
   generator client {
     provider     = "prisma-client"
     output       = "../src/generated/prisma"
     moduleFormat = "cjs"
   }
   datasource db {
     provider = "sqlite"
   }
   ```
   Import the client from the generated path: `import { PrismaClient } from '../generated/prisma/client';`. **Not** from `@prisma/client`.
3. **Driver adapter is required:**
   ```ts
   import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
   const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./data/kanban.db' });
   super({ adapter });
   ```
4. `prisma migrate dev` **does not run `prisma generate` automatically any more**, and it does not seed. Run `npx prisma generate` explicitly after changing the schema, and at image build time.

### 4.3 Schema guidance (`prisma/schema.prisma`)

- Models: `Board`, `Column` (map it to the table `board_columns`, since `column` is an awkward identifier), `Card`, `Label`, `CardLabel` (an explicit join model with `@@id([cardId, labelId])`). Using an explicit join model instead of an implicit m-n relation keeps the migration SQL readable.
- Use camelCase Prisma fields with `@map("snake_case")` and `@@map("table_name")`. JSON responses are produced by **explicit mapper functions** (`common/mappers.ts`) that output PRD §6.2 snake_case shapes. Never return Prisma entities straight from controllers.
- Every relation that has a parent gets `onDelete: Cascade`. Add `@@index` on every FK field.
- `priority` is a `String` with default `"medium"`, validated in the DTO with `@IsIn([...])`. `dueDate` is `String?`, stored as `YYYY-MM-DD` and validated with a regex plus a real-date check. This avoids timezone shifts from `DateTime`.
- **Case-insensitive unique label names:** Prisma cannot declare `COLLATE NOCASE`. Add a `nameKey String` column that holds `name.trim().toLowerCase()`, plus `@@unique([boardId, nameKey])`. Map Prisma error `P2002` to 409 `conflict`.
- Do **not** add a unique constraint on `(columnId, position)` or `(boardId, position)`. Re-packing updates rows one at a time, and a unique constraint would be violated partway through.
- `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`. `Date#toJSON()` already produces the PRD's `...Z` format.
- Create the migration with `npx prisma migrate dev --name init`, then **read the generated `migration.sql`** and check the `ON DELETE CASCADE` clauses and indexes. Commit `prisma/migrations/**` including `migration_lock.toml`.

### 4.4 `PrismaService`

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() { super({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./data/kanban.db' }) }); }
  async onModuleInit() {
    await this.$connect();
    await this.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL');   // returns a row, so use $queryRaw*
    await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
    // Assert: SELECT * FROM pragma_foreign_keys must return 1. Throw on startup otherwise.
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
Mark `PrismaModule` as `@Global()` and export `PrismaService`. In `main.ts` call `app.enableShutdownHooks()`.

### 4.5 Services and transactions

- Every operation that touches positions uses an **interactive transaction**: `this.prisma.$transaction(async (tx) => { … })`. Read the sibling list ordered by position, compute the new order in memory with the pure helper in `positions/positions.ts` (unit-test it!), then write back only the rows whose position changed.
- WIP check (CRD-7): inside the same transaction, `count` the cards in the target column and compare with `wipLimit`. Only check when the column changes or when creating a card.
- Throw **domain errors** (`NotFoundError`, `WipLimitError`, `ConflictError`, `DomainValidationError`) from services. They extend a common `DomainError` and are **not** Nest `HttpException`s. The filter maps them.
- `GET /api/boards/:id` does **one** query with nested `include` (columns → cards → labels → label), with `orderBy` on each level. There is no N+1.
- `card_count` in the board list: use `_count` or a grouped aggregate, not per-board queries.

### 4.6 HTTP details (`main.ts` and `common/`)

- `app.setGlobalPrefix('api')`.
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, exceptionFactory })`. The `exceptionFactory` must throw your own `DomainValidationError` (422) with `details: [{field, message}]`, built from the `ValidationError[]` tree (including nested children). Nest's default (400 with a `message` array) does **not** satisfy the PRD.
- DTO properties are **snake_case** so they match the wire format (`wip_limit`, `due_date`, `label_ids`, `column_id`). Nest has no global key-transform magic. Keep it explicit.
- **PATCH absent vs. null:** do not declare default values on DTO class properties. `class-transformer` then leaves absent keys `undefined` and keeps explicit `null`. Validate nullable fields with `@IsOptional()` (which allows both null and undefined) plus the type validators. In the service, use `dto.due_date !== undefined` to decide whether to write the field. `null` means clear it.
- IDs in paths: `@Param('id', ParseIntPipe)`. Make its `exceptionFactory` produce a 404 `not_found` (the PRD accepts 404 or 422).
- **One global exception filter** (`@Catch()`, registered with `app.useGlobalFilters`) produces the PRD §6.3 envelope for every error:
  - Express JSON parse failures reach Nest as a `BadRequestException` whose cause is a `SyntaxError`, or as an error with `type === 'entity.parse.failed'`. Map these to 400 `bad_request`.
  - `NotFoundException` (this includes unknown `/api/*` routes) → 404 `not_found`.
  - Domain errors → their status and code.
  - Prisma `P2025` (record not found) → 404. `P2002` → 409 `conflict`.
  - Everything else → 500 `internal_error`. Log it with `Logger.error(err.stack)` and never leak the stack trace.
- Body size: Nest's Express default JSON limit is 100 kB, which satisfies PRD §9 (≤ 1 MB). If you change it, use `app.useBodyParser('json', { limit: '1mb' })` with `NestFactory.create<NestExpressApplication>(AppModule)`.
- Request logging: a middleware applied to `'*'` logs `METHOD url status durationMs` on the response `finish` event.
- Health: `GET /api/health` runs ``this.prisma.$queryRaw`SELECT 1` ``. It returns `{status:'ok',db:'ok'}`, or throws a `ServiceUnavailableException`, which the filter maps to 503 with body `{status:'error',db:'error'}` (special-case this route).
- Listen on `0.0.0.0` and `process.env.PORT ?? 3000`.

### 4.7 Seed
`SeedService implements OnApplicationBootstrap`. When `process.env.SEED_DEMO === 'true'` and `board.count() === 0`, build the demo data **through the domain services** (PRD SEED-1).

### 4.8 Backend tests
- Keep Jest from the scaffold. e2e tests (`test/*.e2e-spec.ts`) boot the real `AppModule` with `Test.createTestingModule`. Apply the **same** global pipe, filter and prefix as `main.ts`: factor that setup into `configureApp(app)` and reuse it.
- Test DB: for each test file, create a temp dir, set `process.env.DATABASE_URL = 'file:<tmp>/test.db'`, and run `npx prisma migrate deploy` via `execSync` **before** creating the app. Clean the tables between tests with `deleteMany` in child-to-parent order.
- Cover PRD §9, plus unit tests for `positions.ts` and a randomised-moves contiguity test.
- Commands: `npm run lint`, `npm test` (unit), `npm run test:e2e`.

## 5. Frontend

### 5.1 Scaffold

```bash
npm create vite@9.2.1 frontend -- --template react-ts
cd frontend
npm install -E @tanstack/react-query@5.104.0 react-router@8.4.0 @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
npm install -D -E vitest@5.0.3 @testing-library/react@16.3.3 jsdom@30.1.1
```
Make sure `react` and `react-dom` resolve to 19.3.0. Delete the template's demo content (the counter, logos and `App.css` boilerplate).

### 5.2 `vite.config.ts`
```ts
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
```
The app calls **relative** URLs (`/api/...`) everywhere. Never hard-code a host, and do not use `VITE_API_URL`. That keeps the same build working behind nginx.

### 5.3 Implementation rules
- **Server state lives only in TanStack Query.** Query keys: `['boards']`, `['board', id]`. Mutations call `invalidateQueries({queryKey: ['board', id]})` on settle. Do not copy server data into `useState`, except for the transient drag state described below.
- `api/client.ts`: a small `fetch` wrapper that throws an `ApiError {status, code, message, details}` parsed from the §6.3 envelope. `api/types.ts` mirrors PRD §6.2 exactly (snake_case).
- **Routing** (`react-router`, declarative mode): `/` → `BoardListPage`, `/boards/:boardId` → `BoardPage`, `*` → `NotFoundPage`. The card detail is a dialog on the board page. Set `document.title` according to PRD §7.3.
- **Drag-and-drop with dnd-kit:**
  - One `DndContext` per board, with `PointerSensor` (activation constraint `{ distance: 5 }`, so clicks still open the card) and `KeyboardSensor` with `sortableKeyboardCoordinates`.
  - Columns: `SortableContext` with `horizontalListSortingStrategy`. Each column's cards: its own `SortableContext` with `verticalListSortingStrategy`. Each column is also a droppable, so empty columns accept cards.
  - Use the standard multi-container pattern. Keep a local `items` map (`columnId → cardId[]`) that is **derived from the query data**, and reset it whenever the data changes. `onDragOver` moves the id between containers for live preview. `onDragEnd` computes `{column_id, position}` from the final index and calls the move mutation. Use a `DragOverlay` for the dragged tile.
  - On mutation error (e.g. 409 `wip_limit_reached`), show the toast and invalidate the board query. The local `items` then reset to the server truth, so the card snaps back.
- **Filters:** keep `q`, `priority` and `label` in the URL with `useSearchParams` (FLT-3). Filtering the already-loaded `BoardDetail` on the client is acceptable, and must follow the same semantics as `GET /api/boards/{id}/cards`. Debounce text input by 250 ms. Column counts use the **unfiltered** card arrays.
- **Dialogs:** use a native `<dialog>` with `ref.current.showModal()`. It traps focus and closes on `Esc` for free. Put the `data-testid`s from PRD §7.4 on the elements.
- **Toast:** a context provider with `useToast()`. It renders `<div role="status" data-testid="toast">` only while a message is visible.
- **Styling:** CSS Modules (`*.module.css`) plus a small global `index.css` with CSS variables for the priority colours. **No** UI component library or CSS framework.
- ESLint from the Vite template must pass (`npm run lint`), and so must `tsc -b` (part of `npm run build`).

## 6. Docker

### 6.1 `backend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS base
WORKDIR /app
# better-sqlite3 normally uses a prebuilt binary; these tools are the fallback if it has to compile
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM build AS test
ENV DATABASE_URL=file:/tmp/test.db
CMD ["sh", "-c", "npm test && npm run test:e2e"]

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:24-trixie-slim AS runtime
# openssl lets the Prisma schema engine (used by `migrate deploy`) detect libssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production DATABASE_URL=file:/data/kanban.db PORT=3000
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json prisma.config.ts docker-entrypoint.sh ./
COPY --chown=node:node prisma ./prisma
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
```

- The runtime stage's base image **must be the same distro and Node major** as `prod-deps`, so the compiled `better-sqlite3` binary is ABI-compatible.
- Check the build output: `nest build` with `tsconfig.build.json` (`rootDir: ./src`) emits `dist/main.js`. If your layout emits somewhere else, fix the path in the entrypoint.

`backend/docker-entrypoint.sh` (mode 755):
```sh
#!/bin/sh
set -eu
./node_modules/.bin/prisma migrate deploy
exec node dist/main.js
```

`backend/.dockerignore`: `node_modules`, `dist`, `src/generated`, `data`, `*.db*`, `.env`, `coverage`.

### 6.2 `frontend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
```

`frontend/nginx.conf`:
```nginx
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  client_max_body_size 1m;

  location = /healthz { access_log off; return 200 "ok\n"; }

  location /api/ {
    proxy_pass http://backend:3000;          # no trailing slash, so the /api prefix is kept
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
  location / { try_files $uri $uri/ /index.html; }   # SPA fallback: /boards/42 serves index.html
}
```

Deep-linking to an unknown board (BRD-5): the SPA shows a 404 page after the API returns 404. The HTTP status of the HTML document itself will be 200 in this stack, and that is accepted.

`frontend/.dockerignore`: `node_modules`, `dist`, `coverage`.

### 6.3 `docker-compose.yaml`

```yaml
name: kanban-nestjs-react
services:
  backend:
    build:
      context: ./backend
      target: runtime
    image: kanban-nestjs-react-backend:latest
    environment:
      DATABASE_URL: file:/data/kanban.db
      PORT: "3000"
      SEED_DEMO: "true"
    volumes:
      - kanban-data:/data
    expose:
      - "3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 20s
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      target: runtime
    image: kanban-nestjs-react-frontend:latest
    ports:
      - "8080:8080"
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  kanban-data:
```

Run the backend tests in Docker with `docker build --target test -t kanban-nest-test ./backend && docker run --rm kanban-nest-test`. Document this in the README.

## 7. Definition of done (self-check before you finish)

- [ ] `docker compose down -v && docker compose up --build -d` → both services are healthy. `curl -s localhost:8080/api/health` returns `{"status":"ok","db":"ok"}`, and `http://localhost:8080/` lists "Demo Board".
- [ ] `curl -s localhost:8080/boards/1` returns the SPA's `index.html` (the nginx fallback works).
- [ ] `curl -s -XPOST localhost:8080/api/boards -H 'content-type: application/json' -d '{bad'` → 400 with the `bad_request` envelope. Sending `{"name":""}` → 422 `validation_error` with `details[0].field == "name"`.
- [ ] `docker compose restart` → the data is still there. The backend logs show `No pending migrations to apply` on the second start.
- [ ] Drag a card into a full column → a toast appears, and the card snaps back.
- [ ] `npm run lint`, `npm test` and `npm run test:e2e` pass in `backend/`. `npm run lint` and `npm run build` pass in `frontend/`.
- [ ] `NOTES.md` lists the exact installed versions (`npm ls --depth=0` in both packages), and Prisma is `7.10.0` everywhere.
