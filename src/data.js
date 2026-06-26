import { createContext, useContext, useEffect, useState } from 'react'

// Runtime data context. `store` is the offline fallback (data.json); `version`
// is a counter the app bumps to force every binding to refetch (e.g. after the
// data model is applied to the database).
export const DataContext = createContext({ store: {}, version: 0, refresh: () => {} })

// Trigger a re-fetch of every binding (used after a CRUD mutation).
export function useRefresh() {
  return useContext(DataContext).refresh || (() => {})
}

// The declared [Data] model: { [source]: { name, fields:[{name,type}], kind } }.
// Used to validate field references strictly against the model.
export const SchemaContext = createContext({})

// Lets a [Button] anywhere in the tree open a [Form] modal: { open(buttonNode) }.
export const FormsContext = createContext({ open: () => {} })

// Named [Rule] definitions: { name -> expression }, for conditions by name.
export const RulesContext = createContext({})
export function useRules() {
  return useContext(RulesContext)
}

const isUrl = (s) => typeof s === 'string' && /^https?:\/\//.test(s)

// Resolve a binding to an array of records. A plain entity name is fetched from
// the backend API (/api/<name>), which serves it from Postgres -- a SQL table
// for [List] entities, a JSONB collection for [Store] entities. The FMD author
// never says "sql" or "nosql": the storage was decided by the [Data] declaration
// and the API routes accordingly. A `-> https://` binding still hits that URL
// directly. If the API is unreachable, fall back to the bundled data.json.
export function useSource(source) {
  const { store, version } = useContext(DataContext)
  const [remote, setRemote] = useState(null)

  useEffect(() => {
    if (!source) return
    let alive = true
    const url = isUrl(source) ? source : `/api/${encodeURIComponent(source)}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => alive && setRemote(toRows(d) ?? []))
      .catch(() => alive && setRemote(toRows(store?.[source]) ?? []))
    return () => {
      alive = false
    }
  }, [source, store, version])

  if (!source) return null
  return remote
}

function toRows(d) {
  if (!d) return null
  if (Array.isArray(d)) return d
  if (Array.isArray(d.rows)) return d.rows
  return null
}

// ---- field detection helpers (so widgets work with any entity shape) ----
const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))

export function keysOf(rows) {
  return rows && rows.length ? Object.keys(rows[0]) : []
}

export function pickField(rows, prefer, fallbackPredicate) {
  const keys = keysOf(rows)
  for (const re of prefer) {
    const k = keys.find((key) => re.test(key))
    if (k) return k
  }
  return keys.find((k) => fallbackPredicate(k, rows)) || keys[0] || null
}

export const firstText = (rows) =>
  pickField(rows, [], (k, r) => !isNum(r[0][k]))
export const firstNumber = (rows) =>
  pickField(rows, [], (k, r) => isNum(r[0][k]))
export { isNum }
