// App config store (key/value JSON in the `_fmd_configs` table).
import { pool } from './db.js'

export function registerConfigRoutes(app) {
  app.get('/api/_config', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT key, value FROM _fmd_configs ORDER BY key')
      const out = {}
      for (const r of rows) out[r.key] = r.value
      res.json(out)
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })
  app.get('/api/_config/:key', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT value FROM _fmd_configs WHERE key = $1', [req.params.key])
      if (!rows.length) return res.status(404).json({ key: req.params.key, value: null })
      res.json({ key: req.params.key, value: rows[0].value })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })
  app.put('/api/_config/:key', async (req, res) => {
    try {
      await pool.query(
        `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [req.params.key, JSON.stringify(req.body?.value ?? null)])
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })
  app.delete('/api/_config/:key', async (req, res) => {
    try { await pool.query('DELETE FROM _fmd_configs WHERE key = $1', [req.params.key]); res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: String(e) }) }
  })
}
