import { createContext, useContext, useEffect, useState } from 'react'
import type { Node, Schema, FmdRecord } from '../fmd/types'
import { apiFetch, dataBase } from './auth'

// Runtime data context. `store` is the offline fallback (data.json); `version`
// is a counter the app bumps to force every binding to refetch (e.g. after the
// data model is applied to the database).
export interface DataContextValue {
  store: Record<string, unknown>
  version: number
  refresh: () => void
}
export const DataContext = createContext<DataContextValue>({ store: {}, version: 0, refresh: () => {} })

// Trigger a re-fetch of every binding (used after a CRUD mutation).
export function useRefresh(): () => void {
  return useContext(DataContext).refresh || (() => {})
}

// The declared [Data] model: { [source]: { name, fields:[{name,type}], kind } }.
// Used to validate field references strictly against the model.
export const SchemaContext = createContext<Schema>({})

// Lets a [Button] anywhere in the tree open a [Form] modal: { open(buttonNode) }.
export interface FormsContextValue {
  open: (node: Node | null) => void
}
export const FormsContext = createContext<FormsContextValue>({ open: () => {} })

// The record drilled into in a [Cases] (or [Detail]) case — plus the source it
// came from, so a [Button -> Action] inside the case can update THAT record
// (a no-source [Update]/[Delete] step). Null outside a case.
export interface CaseContextValue { record: FmdRecord; source: string | null }
export const RecordContext = createContext<CaseContextValue | null>(null)
export function useRecord(): FmdRecord | null {
  return useContext(RecordContext)?.record ?? null
}
export function useCase(): CaseContextValue | null {
  return useContext(RecordContext)
}

// Opening a [Cases] case takes over the WHOLE page (a new screen with a Back
// button), so the selection is lifted to the app level. A case-link calls
// `open(...)`; App/Preview render the case page instead of the normal content.
export interface OpenCaseValue { record: FmdRecord; source: string | null; children: Node[]; title: string }
export const CaseNavContext = createContext<{ open: (c: OpenCaseValue) => void }>({ open: () => {} })
export function useCaseNav(): { open: (c: OpenCaseValue) => void } {
  return useContext(CaseNavContext)
}

// The collected [Form] definitions, so a [View -> FormName] can find its form by
// name (forms are otherwise only opened by [Button]s).
export interface FormDef { title: string; source: string | null; size?: 'compact' | 'standard' | 'wide'; fields: Array<{ field: string; label: string; width?: number | null }>; lineItems?: { source: string | null; cols: Array<{ field: string; label: string; width?: number | null }> } | null; totals?: Array<{ name: string; expr: string }> }
export const FormsListContext = createContext<FormDef[]>([])
export function useFormsList(): FormDef[] {
  return useContext(FormsListContext)
}

// Named [Rule] definitions: { name -> expression }, for conditions by name.
export const RulesContext = createContext<Record<string, string | null>>({})
export function useRules(): Record<string, string | null> {
  return useContext(RulesContext)
}

// The current user's roles for `{Role, !Role}` element visibility. Defaults to
// ['*'] (open mode) — when Authentik isn't configured, the dev sees everything.
export const RolesContext = createContext<string[]>(['*'])
export function useVisibilityRoles(): string[] {
  return useContext(RolesContext)
}

// Lets a [User Management] button open the user-management window.
export const UserMgmtContext = createContext<{ open: () => void }>({ open: () => {} })
export function useUserMgmt(): { open: () => void } {
  return useContext(UserMgmtContext)
}

// Named [Action] definitions plus a runner: { actions: { [name]: action },
// run(action) }. Lets a [Button] anywhere in the tree fire an action's steps.
export interface ActionsContextValue {
  actions: Record<string, unknown>
  run: (action: unknown, caseCtx?: CaseContextValue | null) => void
}
export const ActionsContext = createContext<ActionsContextValue>({ actions: {}, run: () => {} })
export function useActions(): ActionsContextValue {
  return useContext(ActionsContext)
}

// The API base path for data calls. The editor uses '/api'; a deployed app
// rendered at /app/<slug> uses '/api/_app/<slug>' so its reads/writes hit that
// app's isolated schema.
export const ApiContext = createContext<string>('/api')
export function useApiBase(): string {
  return useContext(ApiContext)
}

const isUrl = (s: unknown): boolean => typeof s === 'string' && /^https?:\/\//.test(s)

// Resolve a binding to an array of records. A plain entity name is fetched from
// the backend API (/api/<name>), which serves it from Postgres -- a SQL table
// for [List] entities, a JSONB collection for [Store] entities. The FMD author
// never says "sql" or "nosql": the storage was decided by the [Data] declaration
// and the API routes accordingly. A `-> https://` binding still hits that URL
// directly. If the API is unreachable, fall back to the bundled data.json.
export function useSource(source: string | null): FmdRecord[] | null {
  const { store, version } = useContext(DataContext)
  const base = useContext(ApiContext)
  // The declared [Data] model tells us a source's kind. An `api`-kind source
  // reads through the server proxy (/_ext/<source>); dataBase routes it there.
  const schema = useContext(SchemaContext)
  const [remote, setRemote] = useState<FmdRecord[] | null>(null)

  useEffect(() => {
    if (!source) return
    let alive = true
    const kind = schema[source.toLowerCase()]?.kind
    const url = isUrl(source) ? source : dataBase(base, source, kind)
    apiFetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setRemote(toRows(d) ?? []))
      .catch(() => alive && setRemote(toRows(store?.[source]) ?? []))
    return () => {
      alive = false
    }
  }, [source, store, version, base, schema])

  if (!source) return null
  return remote
}

function toRows(d: unknown): FmdRecord[] | null {
  if (!d) return null
  if (Array.isArray(d)) return d as FmdRecord[]
  const rows = (d as { rows?: unknown }).rows
  if (Array.isArray(rows)) return rows as FmdRecord[]
  return null
}
