# TECH.md — FastAPI + htmx + SQLAlchemy/Alembic + SQLite

Read `../PRD.md` first. This document tells you **how** to build it. The PRD tells you **what** to build.
Your implementation goes in `kanban-board/fastapi-htmx/<llm-name>/`. All paths below are relative to that directory.

> **Terminology note:** Alembic is SQLAlchemy's *migration tool*, not an ORM. In this stack the ORM is **SQLAlchemy 2.x** (typed declarative models), and **Alembic** owns every schema change.

---

## 1. Pinned versions (latest stable as of 2026-09-30)

Use these exact versions. Pin them in `pyproject.toml` with `==` for runtime dependencies and commit `uv.lock`. Do not use pre-releases.

| Component | Version | Notes |
|---|---|---|
| Python | **3.14** (3.14.7) | Docker image `python:3.14-slim-trixie` |
| uv (package/venv manager) | **0.12.21** | Docker: `COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /bin/` |
| FastAPI | **0.142.2** | Install as `fastapi[standard]` (brings in uvicorn, Jinja2, python-multipart, httpx, fastapi-cli) |
| Uvicorn | 0.54.0 | Comes from `fastapi[standard]` |
| Pydantic | 2.13.5 | v2 API only (`model_dump`, `model_validate`, `ConfigDict`) |
| pydantic-settings | 2.15.0 | Configuration from env vars |
| SQLAlchemy | **2.1.1** | Sync engine with the stdlib `sqlite3` driver. **Do not** use the async engine or aiosqlite |
| Alembic | **1.20.0** | Migrations |
| Jinja2 | 3.1.6 | Server-side templates (comes from `fastapi[standard]`) |
| python-multipart | 0.0.32 | Form parsing for htmx requests (comes from `fastapi[standard]`) |
| htmx | **2.0.11** | npm package `htmx.org`. **Not** 4.x (that is the `next` dist-tag, still pre-release) |
| SortableJS | **1.15.7** | Drag-and-drop |
| pytest | 9.1.1 | dev dependency |
| httpx | 0.28.1 | dev; used by `fastapi.testclient.TestClient` |
| ruff | 0.16.9 | dev; lint + format |

No Node.js toolchain is used in this stack. There is no bundler and no CSS framework build step.

## 2. Architecture

```
Browser ── HTML/htmx ──▶ FastAPI "web" router  (/ , /boards/{id}, /ui/**)  ──┐
        ── JSON ───────▶ FastAPI "api" router  (/api/**)                   ──┤──▶ services/*  ──▶ SQLAlchemy Session ──▶ SQLite /data/kanban.db
                                                                              ┘
```

- **One process and one container** serve both the HTML UI and the JSON API on port 8000. Compose publishes it as 8080.
- **Service layer (`app/services/`)** holds every business rule: position packing, WIP checks, label/board checks and cascades. Both routers call the services. **Routers and templates hold no business logic.**
- Services raise domain exceptions (`NotFound`, `WipLimitReached`, `Conflict`, `ValidationFailed`). The API maps them to the PRD §6.3 envelope. The web layer maps them to an error toast fragment (§6.4).
- The HTML UI is **server-rendered Jinja2** with htmx for partial updates. Write only the small amount of JS needed to glue SortableJS to htmx (`static/js/app.js`, target < 150 lines).

## 3. Project layout

```
.
├── docker-compose.yaml
├── Dockerfile
├── .dockerignore
├── pyproject.toml
├── uv.lock
├── alembic.ini
├── README.md
├── NOTES.md
├── scripts/
│   └── entrypoint.sh
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial_schema.py
├── app/
│   ├── __init__.py
│   ├── main.py            # FastAPI app factory, lifespan, middleware, exception handlers, router mounting
│   ├── config.py          # pydantic-settings Settings
│   ├── db.py              # engine, SessionLocal, get_session dependency, SQLite PRAGMA listener
│   ├── models.py          # SQLAlchemy declarative models
│   ├── schemas.py         # Pydantic request/response models (PRD §6.2)
│   ├── errors.py          # Domain exceptions + envelope helpers
│   ├── seed.py            # SEED_DEMO logic (PRD SEED-1)
│   ├── services/
│   │   ├── boards.py
│   │   ├── columns.py
│   │   ├── cards.py
│   │   ├── labels.py
│   │   └── positions.py   # shared helpers: move_in_list, repack
│   ├── api/               # JSON routers, prefix /api
│   │   ├── boards.py
│   │   ├── columns.py
│   │   ├── cards.py
│   │   ├── labels.py
│   │   └── health.py
│   ├── web/
│   │   └── routes.py      # HTML routes: full pages and htmx fragments
│   ├── templates/
│   │   ├── base.html
│   │   ├── index.html
│   │   ├── board.html
│   │   ├── not_found.html
│   │   └── partials/      # _board_columns.html, _column.html, _card.html, _card_detail.html, _labels.html, _toast.html ...
│   └── static/
│       ├── css/app.css
│       ├── js/app.js
│       └── vendor/
│           ├── htmx.min.js       # 2.0.11, committed
│           └── Sortable.min.js   # 1.15.7, committed
└── tests/
    ├── conftest.py
    ├── test_api_boards.py
    ├── test_api_cards_move.py
    ├── test_api_labels.py
    ├── test_api_errors.py
    └── test_web_smoke.py
```

## 4. Bootstrapping steps

```bash
cd kanban-board/fastapi-htmx/<llm-name>
uv init --app --python 3.14 --name kanban .
uv add "fastapi[standard]==0.142.2" "sqlalchemy==2.1.1" "alembic==1.20.0" "pydantic-settings==2.15.0"
uv add --dev "pytest==9.1.1" "httpx==0.28.1" "ruff==0.16.9"
uv run alembic init -t generic migrations     # then edit env.py (see §5.3)

# Vendor front-end libraries (commit these files; never load from a CDN at runtime)
mkdir -p app/static/vendor
curl -fsSL https://unpkg.com/htmx.org@2.0.11/dist/htmx.min.js      -o app/static/vendor/htmx.min.js
curl -fsSL https://unpkg.com/sortablejs@1.15.7/Sortable.min.js     -o app/static/vendor/Sortable.min.js
```

Delete the `main.py`/`hello.py` that `uv init` generates at the project root. Add `[tool.ruff]` settings to `pyproject.toml`: `line-length = 100`, `target-version = "py314"`, `lint.select = ["E","F","I","UP","B","SIM"]`.

## 5. Persistence

### 5.1 Configuration (`app/config.py`)

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")
    database_url: str = "sqlite:///./data/kanban.db"   # Compose sets sqlite:////data/kanban.db (4 slashes = absolute)
    seed_demo: bool = False
    log_level: str = "info"

settings = Settings()
```

### 5.2 Engine, session and PRAGMAs (`app/db.py`)

These rules are mandatory:

- `create_engine(settings.database_url, connect_args={"check_same_thread": False})`. FastAPI runs sync endpoints in a thread pool.
- Apply the PRAGMAs **on every new DBAPI connection** with an event listener:
  ```python
  from sqlalchemy import event
  @event.listens_for(engine, "connect")
  def _sqlite_pragmas(dbapi_conn, _):
      cur = dbapi_conn.cursor()
      cur.execute("PRAGMA foreign_keys=ON")
      cur.execute("PRAGMA journal_mode=WAL")
      cur.execute("PRAGMA busy_timeout=5000")
      cur.close()
  ```
- `SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)`. Provide a `get_session()` generator dependency that yields a session and closes it. Services receive the `Session` as an argument. Each request is one unit of work: commit on success, roll back on exception.
- Create the parent directory of the DB file at startup if it does not exist, so local dev works.

### 5.3 Models (`app/models.py`)

- Use SQLAlchemy 2.x typed declarative style: `class Base(DeclarativeBase)`, `Mapped[...]`, `mapped_column(...)`.
- Give `Base.metadata` a **naming convention**. Alembic batch mode on SQLite needs named constraints:
  ```python
  NAMING = {"ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s", "pk": "pk_%(table_name)s"}
  class Base(DeclarativeBase):
      metadata = MetaData(naming_convention=NAMING)
  ```
- FKs use `ForeignKey(..., ondelete="CASCADE")` **and** the relationship uses `cascade="all, delete-orphan", passive_deletes=True`, so both the ORM and the DB agree.
- Relationships that `GET /api/boards/{id}` needs are loaded with `selectinload` in the service query. No lazy loads in a loop (PRD §9 forbids N+1).
- Order relationships in the query or in Python by `position`. Do not rely on insertion order.
- `card_labels` is a plain `Table` (association table) with a composite PK and two cascading FKs.
- Label name uniqueness is case-insensitive. Create a unique index on `(board_id, lower(name))`, or declare `name` with `collation="NOCASE"` plus a `UniqueConstraint("board_id", "name")`. It must appear in the migration.
- Timestamps: store UTC. SQLite returns **naive** datetimes, so serialize them as UTC with a `Z` suffix. Use a Pydantic `field_serializer` or a SQLAlchemy `TypeDecorator` that attaches `timezone.utc` on load. Set `updated_at` in the service layer (or with `onupdate=`) whenever the row changes.
- Do **not** put a unique constraint on `(column_id, position)` or `(board_id, position)`. Re-packing updates rows one at a time, and a unique constraint would be violated partway through.
- `priority`: store it as a string, with a `CheckConstraint("priority IN ('low','medium','high','urgent')")`. Use a Python `enum.StrEnum` in the schemas.

### 5.4 Alembic

- `alembic.ini`: leave `sqlalchemy.url` empty. `migrations/env.py` must read the URL from `app.config.settings.database_url` and set `target_metadata = app.models.Base.metadata`.
- In **both** `run_migrations_offline` and `run_migrations_online`, pass `render_as_batch=True` to `context.configure(...)`. SQLite cannot `ALTER` most things, and batch mode makes later migrations work.
- Generate the initial migration with `uv run alembic revision --autogenerate -m "initial schema"`. Then **review and hand-edit it**: check the FKs with `ondelete="CASCADE"`, the CHECK constraint, the unique label index and the FK indexes. Rename the file to `0001_initial_schema.py` (set `revision = "0001"`).
- Round-trip test: `alembic upgrade head && alembic downgrade base && alembic upgrade head` must succeed.
- **Never** call `Base.metadata.create_all()` in application code. Tests must also build their schema through Alembic (§8).

## 6. HTTP layer

### 6.1 App factory (`app/main.py`)

- `app = FastAPI(title="Kanban", lifespan=lifespan)`. In `lifespan`, run the seed (only if `settings.seed_demo`) and log startup. Do **not** run migrations here; the entrypoint does that (§9).
- Mount static files: `app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")`.
- Include routers: `api_router` with `prefix="/api"` and the `web` router without a prefix.
- Middleware:
  1. **Request log**: one line per request, `METHOD path status duration_ms`. Run uvicorn with `--no-access-log` so lines are not duplicated.
  2. **Body size limit**: reject `Content-Length > 1_048_576` with 413 and the error envelope.
- Keep the OpenAPI docs at `/docs` (a free bonus). They must not collide with the UI routes.

### 6.2 JSON API (`app/api/*`)

- Every endpoint is a plain `def` (sync), because the SQLAlchemy engine is sync.
- Request models are Pydantic v2. Use `Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]`, and `Field(pattern=r"^#[0-9a-fA-F]{6}$")` for colours.
- **PATCH absent vs. null**: declare every PATCH field as optional with a default (e.g. `due_date: date | None = None`) and use `body.model_dump(exclude_unset=True)`. A key sent as `null` is in that dict with the value `None` (clear the field). A key that was absent is not in the dict (leave it unchanged).
- Response models: set `response_model=` on each route, built with `ConfigDict(from_attributes=True)`. Always return the shapes in PRD §6.2 exactly, including computed `card_count` and nested `labels`.
- Status codes: `status_code=201` on creates. On deletes, `status_code=204` and `return Response(status_code=204)`.

### 6.3 Error envelope (mandatory overrides)

FastAPI's default error bodies do **not** match PRD §6.3. You must register handlers for all of these:

| Exception | Status / code |
|---|---|
| `RequestValidationError` whose errors contain `type == "json_invalid"` | 400 `bad_request` |
| Other `RequestValidationError` | 422 `validation_error`; turn each `err["loc"]` (skip `"body"`) into `details[].field` |
| `StarletteHTTPException` (this includes unknown routes, 404) | the same status, `not_found` / `bad_request`, as the envelope. **For `/api/**` paths only.** For HTML paths, render `not_found.html` |
| Domain exceptions | 404 / 409 `wip_limit_reached` / 409 `conflict` / 422 |
| `Exception` | 500 `internal_error`; log the traceback, but do not include it in the body |

### 6.4 HTML + htmx (`app/web/routes.py`, `templates/`)

**Routes** (suggested; the `/ui/*` names are internal and free to change):

| Route | Returns |
|---|---|
| `GET /` | full page: board list + create form |
| `POST /ui/boards` | form → creates the board → responds with `HX-Redirect: /boards/{id}` |
| `GET /boards/{id}` | full page, or only the `#board-columns` fragment when `HX-Request` is set and `HX-History-Restore-Request` is not (filters use this) |
| `POST /ui/columns/{id}/cards`, `POST /ui/cards/{id}/move`, `POST /ui/columns/{id}/move`, `PATCH/DELETE /ui/cards/{id}`, ... | re-rendered fragment(s) of the affected column(s) or of the whole `#board-columns` |
| `GET /ui/cards/{id}` | card-detail fragment, swapped into a `<dialog id="card-dialog">` |

**Rules and htmx 2 specifics you must get right:**

1. `base.html` loads `/static/vendor/htmx.min.js`, `/static/vendor/Sortable.min.js` and `/static/js/app.js`, each with `defer`. Jinja2 autoescaping is on for `.html` (the `Jinja2Templates` default). **Never** apply `|safe` to user data.
2. **Full page vs. fragment:** check `request.headers.get("HX-Request")`. When the header `HX-History-Restore-Request` is `true`, return the full page. Add a `Vary: HX-Request` response header.
3. **Error responses are not swapped by default in htmx 2.** Configure `htmx.config.responseHandling` in `base.html` so that 4xx responses **are** swapped:
   ```html
   <meta name="htmx-config" content='{"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'>
   ```
   On a domain error, the web layer returns the `_toast.html` fragment with the matching status (409/422) and the headers `HX-Retarget: #toast-region` and `HX-Reswap: innerHTML`. The toast element carries `data-testid="toast"` and removes itself after about 4 s (e.g. `hx-on::load` + `setTimeout`, or a CSS animation plus JS removal).
4. **`hx-delete` in htmx 2 sends parameters in the query string, not the body.** Design delete routes to need only path params.
5. Event attribute syntax is `hx-on::after-request="..."` (htmx 2 style). The old `hx-on="htmx:..."` form is removed.
6. **Filters (FLT-1..3):** a `<form id="filters" hx-get="/boards/{id}" hx-target="#board-columns" hx-select="#board-columns" hx-swap="outerHTML" hx-push-url="true" hx-trigger="input changed delay:300ms from:#filter-q, change from:select">`. The server applies `q`, `priority` and `label` from the query string. It uses the **unfiltered** counts for the column headers.
7. **Drag-and-drop with SortableJS:**
   - Every column's card list is a `<ul class="card-list" data-column-id="…">`. Initialise Sortable with `group: "cards"` on each list, and a separate Sortable (`group: "columns"`, `handle: ".column-drag-handle"`) on the columns container.
   - In `onEnd(evt)`, read `evt.item.dataset.cardId`, `evt.to.dataset.columnId` and `evt.newIndex`. Call `htmx.ajax("POST", `/ui/cards/${id}/move`, {values: {column_id, position}, target: "#board-columns", swap: "outerHTML"})`.
   - **Re-initialise Sortable after every swap.** Wrap the initialisation in `htmx.onLoad(root => root.querySelectorAll(".card-list").forEach(...))`, so new content (including the post-error re-render) gets drag handlers again. Guard against double-initialising the same element (`Sortable.get(el)`).
   - **On a 409 WIP error**, the card must go back to its place. The simplest correct approach: on error, return the toast *and* trigger a board re-render, e.g. with `HX-Trigger: refresh-board` and a `hx-trigger="refresh-board from:body"` `hx-get` on `#board-columns`.
8. **Keyboard/non-drag moves:** the card detail `<select data-testid="card-detail-column">` (CRD-6) and "◀ ▶" buttons on column headers (COL-4) are plain `hx-post` controls.
9. **Card detail dialog:** use a native `<dialog id="card-dialog">`. The fragment is loaded with `hx-get="/ui/cards/{id}" hx-target="#card-dialog" hx-swap="innerHTML"`, and opened with `hx-on::after-swap="document.getElementById('card-dialog').showModal()"`. A native `<dialog>` gives you focus trapping and closing on `Esc`.
10. Confirmations: `hx-confirm="Delete column 'X' and its 4 cards?"` is acceptable (it uses native `confirm()`).
11. Submit buttons are disabled while a request is in flight (`hx-disabled-elt="find button"`).
12. CSS: hand-written `static/css/app.css`, using CSS custom properties for the priority colours and a system font stack. Columns are `display:flex; overflow-x:auto`. Add a `@media (max-width: 600px)` rule for a full-screen dialog.
13. Add every `data-testid` from PRD §7.4 to the templates.

## 7. Seeding

`app/seed.py::seed_demo(session)` runs in `lifespan` when `SEED_DEMO=true` and `session.scalar(select(func.count()).select_from(Board)) == 0`. It must build the data by calling the **service layer**, not raw inserts, so the positions come out right. Give one card `due_date = today - 3 days`.

## 8. Testing

- `tests/conftest.py`:
  - Create a temp dir per test session and set `DATABASE_URL=sqlite:///<tmp>/test.db` **before** importing `app`. Alternatively, build the engine lazily from settings and override it.
  - Run `alembic.command.upgrade(Config("alembic.ini"), "head")` once per session. For isolation, truncate every table between tests (with `PRAGMA foreign_keys=OFF` during the truncate), or use a fresh DB file per test.
  - Provide a `client` fixture: `with TestClient(app) as c: yield c`. The context manager runs the lifespan.
- Cover everything listed in PRD §9, plus:
  - a parametrised move test that performs about 50 random moves and checks that the positions in every column are exactly `0..n-1`
  - a check that `PRAGMA foreign_keys` returns 1 on a session connection
  - an XSS check: a card titled `<script>alert(1)</script>` renders escaped on `GET /boards/{id}`
- Commands:
  ```bash
  uv run ruff check . && uv run ruff format --check .
  uv run pytest -q
  docker build --target test -t kanban-fastapi-test . && docker run --rm kanban-fastapi-test   # also document this in README
  ```

## 9. Docker

### 9.1 `Dockerfile` (multi-stage; follow this structure)

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.14-slim-trixie AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

FROM base AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev

FROM builder AS test
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked
CMD ["uv", "run", "pytest", "-q"]

FROM base AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app app \
 && mkdir -p /data && chown app:app /data
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" DATABASE_URL=sqlite:////data/kanban.db
USER app
EXPOSE 8000
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
```

- The last stage must be `runtime`, so a plain `docker build` or `docker compose build` produces it. Alternatively set `target: runtime` in compose.
- `/data` must exist **and be owned by the app user inside the image**. A new named volume copies that ownership, which avoids `sqlite3.OperationalError: unable to open database file`.

### 9.2 `scripts/entrypoint.sh` (must be executable: `chmod +x`, committed with mode 755)

```sh
#!/bin/sh
set -eu
alembic upgrade head
exec fastapi run app/main.py --host 0.0.0.0 --port 8000 --workers 1 --no-access-log
```
(`uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log` is also acceptable.)

### 9.3 `.dockerignore`
`.venv`, `__pycache__`, `*.pyc`, `.pytest_cache`, `.ruff_cache`, `data/`, `*.db*`, `.git`, `.env`.

### 9.4 `docker-compose.yaml`

```yaml
name: kanban-fastapi-htmx
services:
  web:
    build:
      context: .
      target: runtime
    image: kanban-fastapi-htmx:latest
    ports:
      - "8080:8000"
    environment:
      DATABASE_URL: sqlite:////data/kanban.db
      SEED_DEMO: "true"
    volumes:
      - kanban-data:/data
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    restart: unless-stopped
volumes:
  kanban-data:
```

`python:*-slim` has no `curl`, so the healthcheck uses Python's standard library. Do not install curl just for this.

## 10. Definition of done (self-check before you finish)

- [ ] `docker compose down -v && docker compose up --build -d`, then `curl -s localhost:8080/api/health` returns `{"status":"ok","db":"ok"}`, and `/` shows "Demo Board".
- [ ] `docker compose restart` → the data is still there.
- [ ] Migration applied: `docker compose exec web python -c "import sqlite3;print(sqlite3.connect('/data/kanban.db').execute('select version_num from alembic_version').fetchall())"` → `[('0001',)]`.
- [ ] Every PRD §6.4 endpoint behaves as specified, including the error envelopes (check 400 for malformed JSON).
- [ ] Drag a card into a full column → a toast appears, and the card returns to its column.
- [ ] `uv run ruff check .`, `uv run pytest` and the Docker `test` target all pass.
- [ ] `README.md` and `NOTES.md` are written. The versions in `NOTES.md` match `uv.lock`.
