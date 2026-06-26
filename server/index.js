// FMD backend API -- server entry point.
// -------------------------------------------------------------
// One Postgres database, two storage styles. The FMD document decides which:
//   [List X]  -> a relational TABLE  (SQL)
//   [Store X] -> a JSONB COLLECTION  (NoSQL)
//
// The frontend just fetches /api/<source>. This service knows, from the seed,
// whether <source> is a list (table) or a store (documents) and queries the
// right way. The author never annotates sql/nosql -- it just happens.
//
// The DB pool, helpers, and init/seed live in db.js; the routes are split into
// schema.js (_schema/_apply/_health), config.js (_config), and crud.js (:source).
// -------------------------------------------------------------
import express from 'express'
import { init } from './db.js'
import { registerSchemaRoutes } from './schema.js'
import { registerConfigRoutes } from './config.js'
import { registerCrudRoutes } from './crud.js'

const PORT = process.env.PORT || 4000

const app = express()
app.use(express.json())
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*') // dev convenience; proxy is same-origin
  next()
})

// Order matters: the reserved `_*` routes must register before `/api/:source`.
registerSchemaRoutes(app)
registerConfigRoutes(app)
registerCrudRoutes(app)

init()
  .then(() => app.listen(PORT, () => console.log(`[fmd-api] listening on :${PORT}`)))
  .catch((e) => {
    console.error('[fmd-api] failed to start:', e)
    process.exit(1)
  })
