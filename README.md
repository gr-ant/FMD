# Functional Markdown (FMD)

A small **declarative** language (`.fmd`) that renders directly into a live,
database-backed UI. You describe the screen and its data model; the app parses it
and generates an interactive interface — no glue code.

## Run

```bash
docker compose up --build      # full stack (Postgres + API + web) → http://localhost:5173
```

Or run the frontend against the API for fast iteration:

```bash
npm install
npm run dev
```

## Write FMD

See **[Configuration Guide](<Configuration Guide.md>)** — the complete authoring
reference (tags, widgets, the data model, conditions/rules, computed fields, and
forms). `app.fmd` is the default document loaded in the editor.

## Layout

```
app.fmd            default document (imported into the editor)
public/data.json   offline fallback records
src/
  fmd/             the language engine — parse + evaluate (pure, no React)
  state/           React contexts + runtime data fetching
  ui/              renderer, widgets, panels
server/            Postgres-backed API (SQL tables + JSONB)
```
