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
import { registerAuth } from './auth.js'
import { registerSchemaRoutes } from './schema.js'
import { registerConfigRoutes } from './config.js'
import { registerDeployRoutes } from './deploy.js'
import { registerUserRoutes } from './users.js'
import { registerCrudRoutes } from './crud.js'
import { registerExtRoutes } from './ext.js'
import { registerConnectionRoutes } from './connections.js'
import { registerFileRoutes } from './files.js'
import { registerChatRoutes } from './chat.js'
import { registerAuditRoutes } from './audit.js'
import { registerTriggerRoutes, startTriggerSweep } from './triggers.js'

const PORT = process.env.PORT || 4000

const app = express()
// Raised limit so base64 file uploads ([File]/[Files] fields) fit in the JSON body.
app.use(express.json({ limit: '35mb' }))
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*') // dev convenience; proxy is same-origin
  next()
})

// Auth first: attaches req.user (open dev mode when OIDC_ISSUER is unset).
registerAuth(app)

// Order matters: the reserved `_*` routes must register before `/api/:source`.
registerSchemaRoutes(app)
registerConfigRoutes(app)
registerDeployRoutes(app)
registerUserRoutes(app)
registerTriggerRoutes(app) // _triggers/run — before the catch-all /api/:source
registerExtRoutes(app) // _ext/* — external API data sources, before /api/:source
registerConnectionRoutes(app) // _conn(s)/* + _call/* — outbound integrations, before /api/:source
registerFileRoutes(app) // _files/* — file upload/download, before /api/:source
registerChatRoutes(app) // _chat — read-only AI chat, before the catch-all /api/:source
registerAuditRoutes(app) // _audit — activity log, before the catch-all /api/:source
registerCrudRoutes(app)

init()
  .then(() => app.listen(PORT, () => console.log(`[fmd-api] listening on :${PORT}`)))
  .then(() => startTriggerSweep()) // background trigger sweep (every 60s)
  .catch((e) => {
    console.error('[fmd-api] failed to start:', e)
    process.exit(1)
  })
