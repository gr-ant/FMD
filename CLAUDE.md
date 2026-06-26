# Functional Markdown (FMD)

A markdown-like language (`.fmd`) that **renders directly into a UI**. You write a
declarative document describing the screen and its data model; a React app parses
it into an AST and generates a live, interactive interface.

The reference document is `app.fmd` (a "Wedding Planner" app). It is loaded as the
default document in the editor.

## Running

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173 (HMR enabled)
npm run build    # production build to dist/
npm run preview  # preview the production build
```

### Full stack with databases (Docker)

```bash
docker compose up --build      # (or: docker-compose up --build) -> http://localhost:5173
```

This runs three services (see `docker-compose.yml`): **db** (a single Postgres),
**api** (Node service that creates/seeds the data and serves `/api/<source>`),
and **web** (the Vite editor/preview, with `/api` proxied to the api service).
The same Postgres instance backs *both* storage styles — see Data binding below.
Without Docker, `npm run dev` still works: the API is unreachable so bindings
fall back to the bundled `public/data.json`.

> **Editing the model live.** The header has a **Save → rebuild DB** button. It
> POSTs the current FMD `[Data]` model to `POST /api/_apply`, which reconstructs
> Postgres to match: `[List]` tables get the exact declared columns (new ones
> added, removed ones dropped), `[Store]` collections are (de)registered, and
> entities removed from the model are dropped. Overlapping data is preserved
> (rows survive; only removed columns/entities are lost). After it succeeds the
> UI refetches every binding from the database.

> **Compose v1 + Docker 29 quirk (this machine).** `docker-compose` v1.29.2 can
> only *create* containers, not *recreate* them (Docker 29 dropped the legacy
> `ContainerConfig` field it reads). To pick up image/code changes:
> `docker-compose rm -sf api web && docker-compose up -d --build api web`.
> Bind-mount volumes hit the same bug, so the web source is baked into the image
> (rebuild to update it) rather than live-mounted. For fast frontend iteration,
> run `npm run dev` on the host instead — its `/api` proxy targets the published
> `localhost:4000` API.

The app is a **split screen**: edit the `.fmd` on the left, the generated UI
regenerates live on the right. A header toggle shows the **Data model** inspector
(a dev tool — not part of the rendered app). The editor underlines field
references that don't match a declared `[Data]` field (`lintReferences`).

### Multi-page displays

Multiple top-level `[Display] Name` blocks are **pages**; the `[Top Menu Bar]`
navigates between them by name (`[Display] Schedule` ⟷ the "Schedule" tab). Only
the active page renders; the menu persists across pages; a tab with no matching
`[Display]` shows a "create this page" placeholder. (App.jsx → `PageView`.)

### Interactive tables (CRUD)

A `[Table]` viz tag may carry a CRUD-letter prefix to make it editable, Notion-
style: `c` create (faux bottom row inserts), `u` update (inline-editable cells),
`d` delete (per-row control), `r`/none read. Combine freely: `udTable`,
`cudTable`. Mutations hit the backend (`POST/PATCH/DELETE /api/<source>/:id`)
which uses a reserved `_id` row identifier, then the UI re-fetches (`useRefresh`).

## The FMD language

Two ideas: **layout is indentation-based**, and **data lives behind the scenes**.

### 1. Tags and nesting

- `[Tag]` — a bracket tag. Nesting is defined purely by **indentation**: a tag's
  children are the lines indented beneath it. **There are no closing tags.**
- `[Tag] inline text` — a tag with inline content is a leaf element.
- A `[Tag]` with indented children renders as a **container**; without children it
  is a labeled leaf.

```
[Display]                 <- container (has indented children)
  [Title] Wedding Planner <- leaf (inline content)
  [Main]                  <- container
    (Widget)(Widget)      <- a row of widgets
```

Recognized tags:

| Tag | Role |
|-----|------|
| `[Display]` | The app shell / screen. The root of what is rendered. |
| `[Title] text` | Page/app title (rendered as a heading). |
| `[Top Menu Bar] a, b, c` | Top navigation; comma-separated, clickable tabs. Also `[Menu]` / `[Nav]`. |
| `[Main]` | Main content area (CSS grid of widget rows). |
| `[List Name] col, col` | A relational entity `Name` → a **SQL table** (typed columns). |
| `[Store Name] field, …` | A schemaless entity `Name` → a **JSONB document collection** (NoSQL). |
| `[Data]` | The data model. **Not rendered** (see below). |
| `[AnyOther]` | Generic container (if it has children) or labeled element. |

### 2. Widgets

Parenthesised names on a line become a **row of widget cards**:

```
(Schedule Timeline -> schedule)(Inventory Counts -> inventory)
```

Each widget picks a visualization by **keyword in its name**, then renders the
records from its bound source:

| Keyword in name | Visualization | Expected record shape |
|-----------------|---------------|------------------------|
| timeline / schedule / agenda / calendar | vertical timeline | `{ time-ish, label-ish }` |
| count / inventory / stat / metric | stat cards | `{ label-ish, number-ish }` |
| checklist / todo / task / vendor | interactive checklist | `{ label-ish, status/done }` |
| summary / budget / total / finance / cost | progress bars | `{ label, spent#, cap# }` |
| (anything else) | generic key/value list or skeleton | any |

Field detection is **shape-agnostic** (see `src/data.js` → `pickField`, `isNum`),
so widgets adapt to arbitrary entity field names — the table above lists the
*preferred* field-name patterns, not requirements.

### 3. Data binding — "behind the scenes, not displayed"

- **`[Data]` declares the data model** (entities + their fields). It is the source
  registry and is **never rendered** as UI.
- **`[Display]` is the UI.** Widgets and lists *bind* to a data entity with
  `-> source`.
- **Records are loaded at RUNTIME.** A plain binding (`-> inventory`) is fetched
  from the backend API at `/api/<source>`, which serves it from Postgres. A
  binding to a URL (`-> https://api.example.com/items`) fetches that live API
  instead. If the API is unreachable, bindings fall back to `public/data.json`,
  keyed by source name. Records are **never written in the `.fmd` document**.

#### SQL vs NoSQL is automatic — decided by the *kind of declaration*

The author never annotates `sql`/`nosql`. The storage is implied by *how the
entity is declared* in `[Data]`, and the API routes each binding accordingly:

- `[List Name] cols` → a **relational table** in Postgres. Columns are typed
  (integers stay numbers). Use for fixed-shape, tabular data.
- `[Store Name]` → a **JSONB document collection** in Postgres (one shared
  `documents` table, partitioned by `collection`, GIN-indexed). Use for
  schemaless / variable-shape records.

A widget or list just binds with `-> source`; whether that source is a SQL table
or a JSONB collection is resolved by the API from the seed registry (`KIND` map
in `server/index.js`). The Data-model inspector shows each entity's storage kind
(`SQL · table` vs `JSONB · document`).

```
[Display]
  [Main]
    (Inventory Counts -> inventory)   # widget bound to the `inventory` entity

[Data]
  [Store Inventory] Title, Category, Count, Price, Related Vendor   # -> JSONB
```

Binding rules:
- `(Name -> source)` — widget bound to `source`.
- `[List Name] cols -> source` / `[Store Name] -> source` — explicit source.
- `[List Name]` / `[Store Name]` with no `->` — implicit source = the name
  lowercased (e.g. `[List Vendors]` binds to `vendors`).

The `Data model` inspector in the header shows each declared entity, its fields,
and how many records are currently loaded for it.

## Architecture

```
app.fmd              Reference FMD document (default in the editor)
public/data.json     Offline fallback records (used when the API is unreachable)
docker-compose.yml   db (Postgres) + api (Node) + web (Vite) — the full stack
Dockerfile           Web image (Vite dev server)
.dockerignore        Build-context excludes for both images
index.html           Vite entry
vite.config.js       Vite + React, port 5173, proxies /api -> the api service
server/              Backend API (single Postgres, SQL tables + JSONB documents)
  index.js           Express app: init/seed Postgres, route /api/<source> by kind,
                     POST /api/_apply reconstructs the schema to match the model
  seed.js            Seed data: `lists` (-> tables) and `stores` (-> JSONB docs)
  Dockerfile         API image (node + express + pg)
src/
  main.jsx           React root
  App.jsx            Split editor/preview, loads data.json, Data-model inspector,
                     filters out [Data] from the rendered tree
  parser.js          parseFMD() -> AST. Indentation stack, binding extraction,
                     collectSchema() and isDataBlock() helpers
  Renderer.jsx       AST -> React UI. Skips [Data]. Lists pull bound records.
  Widget.jsx         Data-driven widgets (timeline/stats/checklist/summary/generic)
  data.js            DataContext + useSource() hook + field-detection helpers
  styles.css         All styling (dark theme)
```

### Parser (`src/parser.js`)

- `parseFMD(src)` → `{ type: 'Root', children: [...] }`.
- Nesting via an **indentation stack**: each line's indent (tabs = 2 spaces)
  decides its parent. Pop the stack until the top's indent is less than the
  current line's, attach as a child, then push.
- Node types: `Root`, `Block` (generic tag, incl. `Display`/`Main`/`Data`),
  `Title`, `Menu`, `List`, `Store`, `WidgetRow`, `Text`. `List`/`Store` carry a
  `kind` (`'list'`/`'store'`) that drives storage.
- `splitBinding('text -> source')` extracts the `-> source` suffix.
- `collectSchema(root)` → `{ [source]: { name, fields, kind } }` from `[Data]`
  `[List]`/`[Store]` entities.
- `isDataBlock(node)` → true for the `[Data]` block (so the renderer can skip it).

### Data flow (`src/data.js`)

- `DataContext` holds the offline-fallback records map (loaded once from
  `/data.json`).
- `useSource(source)` resolves a binding to an array of records: `fetch`es
  `/api/<source>` (Postgres-backed), or the URL directly if the source is a URL;
  falls back to the `DataContext` store if the fetch fails.
- `pickField` / `isNum` / `keysOf` let widgets find the right field in any record
  shape.

## Conventions for extending FMD

- **Add a new tag:** handle it in `parser.js` → `parseNode`, then add a case in
  `Renderer.jsx`.
- **Add a new widget type:** add a keyword branch in `Widget.jsx` → `classify`,
  an icon in `ICONS`, and a body component. Read records via the `rows` prop and
  use `pickField` so it works with any entity shape.
- **Add a new storage kind:** declare it as a tag in `parser.js` → `parseNode`
  with a `kind`, surface it in `collectSchema`, and route it in
  `server/index.js` (the `KIND` map + the `/api/:source` handler) with matching
  seed data in `server/seed.js`.
- **Keep the contract:** anything under `[Data]` defines the model and must NOT be
  rendered; the document never contains record values — those come from the API
  (Postgres), a URL, or the `data.json` fallback at runtime. `[List]` → SQL
  table, `[Store]` → JSONB collection, decided purely by the declaration.
- The `.fmd` document is imported raw via Vite (`import x from '../app.fmd?raw'`).
