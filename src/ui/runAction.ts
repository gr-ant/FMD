// Action runtime (does IO). Executes an [Action]'s steps in order against the
// CRUD API: create inserts a row; update/delete fetch the source, keep the rows
// matching the step's `?` filter (rules engine), and PATCH/DELETE each by _id.
// Returns a per-step summary; the caller refetches bindings on completion.

import { passes } from '../fmd/rules'
import { buildBody } from '../fmd/actions'
import { apiFetch, dataBase } from '../state/auth'
import { FmdRecord, PostStepNode, ActionStep } from '../fmd/types'

// The named-rule map (rule name -> expression) used by `?` filters.
type RuleMap = Record<string, unknown>

// The collected action shape produced by collectActions: a name plus its
// ordered write steps.
interface ActionLike {
  name?: string
  steps?: ActionStep[]
}

// Per-step execution summary returned to the caller.
interface StepResult {
  op: string | null
  source: string | null
  count: number
  error: string | null
}

const api = (apiBase: string, source: string): string => dataBase(apiBase, source)
const jsonPost = (url: string, method: string, body: FmdRecord): Promise<Response> =>
  apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// An outbound [Post]/[Call] step: build the request body from the assigns (per
// the current case record, if any) and POST it through the server's /api/_call
// proxy. The connection's secret key stays server-side — the client only names
// the connection. Runs from the EDITOR base (/api) so it works in both editor +
// deployed app (connections are global, server-side).
async function runPostStep(step: PostStepNode, caseRecord: FmdRecord | null): Promise<StepResult> {
  const body = buildBody(step.assigns, caseRecord || {})
  const url = `/api/_call/${encodeURIComponent(step.connection)}`
  const label = `@${step.connection}${step.path ? '/' + step.path : ''}`
  try {
    const r = await jsonPost(url, 'POST', { path: step.path, method: step.method, body })
    const out = (await r.json().catch((): unknown => null)) as { ok?: boolean; status?: number } | null
    // The proxy always 200s with { status, ok, body }; a non-2xx upstream shows
    // as out.ok === false. Surface either transport or upstream failure.
    const ok = r.ok && out && out.ok !== false
    return { op: 'post', source: label, count: ok ? 1 : 0, error: ok ? null : `HTTP ${out?.status ?? r.status}` }
  } catch (e) {
    return { op: 'post', source: label, count: 0, error: String(e) }
  }
}

// `caseRecord`/`caseSource` are the current [Cases]/[Detail] case (when an action
// runs from a button inside one). A step with NO `-> source` acts on that record.
async function runStep(
  step: ActionStep, rules: RuleMap, apiBase: string,
  caseRecord: FmdRecord | null, caseSource: string | null,
): Promise<StepResult> {
  // Outbound integration step — routed through the server-side connection proxy.
  if (step.type === 'PostStep') return runPostStep(step, caseRecord)
  // No explicit source: act on the current case record (set its fields / delete it).
  if (!step.source) {
    if (!caseRecord || caseRecord._id == null || !caseSource) {
      return { op: step.op, source: null, count: 0, error: 'no source (and no case record)' }
    }
    if (step.op === 'create') return { op: 'create', source: null, count: 0, error: 'create needs a -> source' }
    const url = `${api(apiBase, caseSource)}/${encodeURIComponent(caseRecord._id as string)}`
    const r = step.op === 'delete'
      ? await apiFetch(url, { method: 'DELETE' })
      : await jsonPost(url, 'PATCH', buildBody(step.assigns, caseRecord))
    return { op: step.op, source: caseSource, count: r.ok ? 1 : 0, error: r.ok ? null : `HTTP ${r.status}` }
  }
  const base = api(apiBase, step.source)

  if (step.op === 'create') {
    const r = await jsonPost(base, 'POST', buildBody(step.assigns, caseRecord || {}))
    return { op: 'create', source: step.source, count: r.ok ? 1 : 0, error: r.ok ? null : `HTTP ${r.status}` }
  }

  // update / delete: select target rows by the step's filter, then act per row.
  const rows: unknown = await apiFetch(base)
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : ([] as unknown[])))
    .catch(() => [] as unknown[])
  const matched: FmdRecord[] = (Array.isArray(rows) ? rows : []).filter((row: FmdRecord) => passes(step.filter, row, rules))
  let count = 0
  for (const row of matched) {
    if (row._id == null) continue
    const url = `${base}/${encodeURIComponent(row._id)}`
    const r =
      step.op === 'delete'
        ? await apiFetch(url, { method: 'DELETE' })
        : await jsonPost(url, 'PATCH', buildBody(step.assigns, row))
    if (r.ok) count++
  }
  return { op: step.op, source: step.source, count, error: null }
}

// Ask the server to evaluate this app's [Trigger]s NOW. Triggers run server-side
// (so they fire even with the app closed — see server/triggers.js); the client
// just pokes after an action and on its own timer, then refetches. `base` is
// '/api' (editor) or '/api/_app/<slug>' (deployed); the endpoint is
// `${base}/_triggers/run`. Best-effort — failures are swallowed.
export async function pokeTriggers(base = '/api'): Promise<void> {
  try { await apiFetch(`${base}/_triggers/run`, { method: 'POST' }) } catch { /* best-effort */ }
}

// Run every step sequentially. `rules` is the named-rule map (for `?` filters);
// `base` is the API base path (the editor's '/api', or a deployed app's
// '/api/_app/<slug>').
export async function executeAction(
  action: ActionLike,
  { rules, base = '/api', record = null, source = null }:
    { rules?: RuleMap; base?: string; record?: FmdRecord | null; source?: string | null } = {},
): Promise<StepResult[]> {
  const results: StepResult[] = []
  for (const step of action.steps || []) {
    try {
      results.push(await runStep(step, rules || {}, base, record, source))
    } catch (e) {
      results.push({ op: step.op, source: 'source' in step ? step.source : null, count: 0, error: String(e) })
    }
  }
  return results
}
