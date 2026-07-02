import React, { useState, useContext } from 'react'
import { FormsContext, ActionsContext, useRefresh, useRules, useApiBase, useCase } from '../../data'
import { fieldName } from '../../parser'
import { passes } from '../../fmd/rules'
import { fieldDef, formatValue, fieldType } from '../../fmd/format'
import { evalExpr } from '../../fmd/calc'
import { matchAction } from '../panels/helpers'
import { useDialogs } from '../dialogs'
import { TypedInput } from './inputs'
import { useFields } from './vizShared'
import { ActionNode, ButtonNode, RowButtonNode, Field, FmdRecord } from '../../fmd/types'
import { apiFetch, dataBase, getUser } from '../../state/auth'

// One declared field inside a collected [Form] (from FormFieldNode entries).
type FormField = {
  field: string
  label: string
  required: boolean
  showIf: string | null
  readonly: boolean
  autofill: string | null
  width: number | null // 1–3 columns of a 3-wide grid; null = full width
  accept: string[] | null // allowed file types for a [File]/[Files] field
}

// Resolve a `[Field -> X]` auto-fill spec to a concrete value when a form opens:
// a quoted "literal", or a token (CurrentUser, Today, Now); a bare word is a
// literal too.
function resolveAutofill(spec: string): unknown {
  const s = spec.trim()
  const q = s.match(/^"([^"]*)"$/) || s.match(/^'([^']*)'$/)
  if (q) return q[1]
  switch (s.toLowerCase()) {
    case 'currentuser':
    case 'current user': { const u = getUser(); return u ? u.name : '' }
    case 'today': return new Date().toISOString().slice(0, 10)
    case 'now': return new Date().toISOString()
    default: return s
  }
}

// A collected [Form]: its title, target source, modal size, and ordered fields.
// A form may also carry a repeating [LineItems] grid (child rows created and
// linked to the new parent on submit) and computed [Total] lines.
type FormDef = {
  title: string
  source: string | null
  size?: 'compact' | 'standard' | 'wide'
  fields: FormField[]
  lineItems?: { source: string | null; cols: FormField[] } | null
  totals?: { name: string; expr: string }[]
}

// Evaluate a form's [Total] lines against its current line-item rows. An
// expression may aggregate the rows — sum/avg/min/max/count of an inner per-row
// expression, e.g. sum(Qty * Price) — and reference earlier totals by name. The
// aggregates are reduced over the rows and substituted as literals, then the
// scalar expression is evaluated against the running totals, so a later
// `Tax = Subtotal * 0.08` sees the `Subtotal` computed above it.
export function computeTotals(totals: { name: string; expr: string }[], rows: FmdRecord[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const t of totals) {
    const substituted = t.expr.replace(/\b(sum|avg|min|max|count)\s*\(([^()]*)\)/gi, (_m, fn, inner) => {
      const f = String(fn).toLowerCase()
      if (f === 'count') return String(rows.length)
      const nums = rows.map((r) => { const v = Number(evalExpr(inner, r)); return Number.isFinite(v) ? v : 0 })
      if (!nums.length) return '0'
      const total = f === 'sum' ? nums.reduce((a, b) => a + b, 0)
        : f === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length
        : f === 'min' ? Math.min(...nums) : Math.max(...nums)
      return String(total)
    })
    const v = Number(evalExpr(substituted, acc))
    acc[t.name] = Number.isFinite(v) ? v : 0
  }
  return acc
}

// The child's link field pointing back at the parent source (a `link` field whose
// options.source names the parent), so each line row can reference the new parent.
export function childLinkField(fields: Field[] | null, parentSource: string | null): Field | null {
  if (!fields || !parentSource) return null
  const ps = parentSource.toLowerCase()
  return fields.find((f) => f.type === 'link' && String(f.options?.source || '').toLowerCase() === ps) || null
}

// The value a child link stores: the parent's match field (link.options.field),
// resolved case-insensitively off the created parent row, falling back to _id.
export function parentMatchValue(parent: FmdRecord, link: Field): unknown {
  const mf = link.options?.field
  if (!mf) return parent._id
  const k = Object.keys(parent).find((kk) => kk.toLowerCase() === String(mf).toLowerCase())
  return k != null ? parent[k] : parent._id
}

// Clamp a field's declared width to 1–3 columns; default full width (3). Shared
// so a read-only [View] panel lays its fields out identically to the form modal.
export const spanOf = (w: number | null | undefined): number => (w && w >= 1 && w <= 3 ? w : 3)

// A button. If its target names an [Action] it runs that action's steps;
// otherwise it opens the matching [Form] modal (via FormsContext). A `[RowButton]`
// inside a [Table]/[Cases] renders the same way with `compact` set, wrapped per-row
// in a RecordContext so `useCase()` here resolves to that row.
export function FormButton({ node, compact }: { node: ButtonNode | RowButtonNode; compact?: boolean }) {
  const forms = useContext(FormsContext)
  const { actions, run } = useContext(ActionsContext)
  const dialogs = useDialogs()
  const caseCtx = useCase() // when inside a [Cases]/[Detail] case, target its record
  // ActionsContext stores actions loosely (Record<string, unknown>); matchAction
  // narrows to the ActionNode-shaped entries by name. [RowButton] shares [Button]'s
  // label/target shape, so the same match/run machinery applies.
  const action = matchAction(actions as Record<string, ActionNode>, node)
  // A button whose action deletes records is destructive: paint it as a danger
  // button and make it confirm before running (the write can't be undone).
  const steps = (action as unknown as { steps?: { op?: string }[] } | null)?.steps
  const destructive = !!steps?.some((s) => s.op === 'delete')
  const onClick = action
    ? async () => {
        if (destructive && !(await dialogs.confirm({
          danger: true, title: node.label,
          message: 'This permanently deletes the record. This can’t be undone.',
          confirmLabel: node.label, cancelLabel: 'Cancel',
        }))) return
        run(action, caseCtx)
      }
    : () => forms.open(node)
  return <button className={`fmd-button${compact ? ' row-btn' : ''}${destructive ? ' danger' : ''}`} onClick={onClick}>{node.label}</button>
}

// A modal form that creates a record in its source on submit. With a [LineItems]
// grid it also creates each filled line row, linked back to the new parent, and
// stores any computed [Total]s on the parent as a frozen snapshot.
export function FormModal({ form, onClose }: { form: FormDef; onClose: () => void }) {
  const fields = useFields(form.source)
  const lineFields = useFields(form.lineItems?.source ?? null)
  const refresh = useRefresh()
  const rules = useRules()
  const base = useApiBase()
  // Seed auto-filled fields (CurrentUser, literals, Today/Now) once, on open.
  const [vals, setVals] = useState<FmdRecord>(() => {
    const init: FmdRecord = {}
    for (const f of form.fields) if (f.autofill) init[f.field] = resolveAutofill(f.autofill)
    return init
  })
  // Repeating line-item rows — start with one blank row when a grid is declared.
  const [lines, setLines] = useState<FmdRecord[]>(() => (form.lineItems ? [{}] : []))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Only fields whose show-if condition passes (against current values) are shown.
  const visible = form.fields.filter((f) => !f.showIf || passes(f.showIf, vals, rules))

  // Line-item columns, each carrying its bare `key` (type prefix stripped) — line
  // rows are keyed by that bare name so a [Total] expression's `Qty`/`Price`
  // references resolve regardless of a `numQty`/`curPrice` prefix on the column.
  const cols = (form.lineItems?.cols || []).map((c) => ({ ...c, key: fieldName(c.field) }))
  const setLine = (i: number, key: string, v: unknown): void =>
    setLines((ls) => ls.map((ln, j) => (j === i ? { ...ln, [key]: v } : ln)))
  // A row counts as filled once any of its columns has a value (blank trailing
  // rows are ignored on submit and excluded from the totals).
  const filledLines = lines.filter((ln) => cols.some((c) => String(ln[c.key] ?? '').trim() !== ''))
  const totals = form.totals && form.totals.length ? computeTotals(form.totals, filledLines) : {}
  const gridCols = { gridTemplateColumns: `repeat(${cols.length}, 1fr) auto` }

  const submit = async (): Promise<void> => {
    const missing = visible.filter((f) => f.required && !String(vals[f.field] ?? '').trim())
    if (missing.length) { setErr(`Required: ${missing.map((f) => f.label).join(', ')}`); return }
    setBusy(true); setErr(null)
    try {
      const body: FmdRecord = {}
      // Key by the plain column name (strip any type prefix, e.g. fileAttachment ->
      // Attachment) so the value lands in the right column.
      visible.forEach((f) => { if (vals[f.field] != null && vals[f.field] !== '') body[fieldName(f.field)] = vals[f.field] })
      // Computed [Total]s are stored on the parent (a snapshot frozen at creation).
      for (const [k, v] of Object.entries(totals)) body[k] = v
      const res = await apiFetch(dataBase(base, form.source), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'You don’t have permission to add this record.' : `Couldn’t save (${res.status}).`)
      const parent = (await res.json().catch(() => ({}))) as FmdRecord
      // Create each filled line row, linked back to the new parent. Best-effort:
      // if the child declares no link to this source the rows are created unlinked.
      if (form.lineItems?.source && filledLines.length) {
        const link = childLinkField(lineFields, form.source)
        const linkVal = link ? parentMatchValue(parent, link) : null
        await Promise.all(filledLines.map((ln) => {
          const rowBody: FmdRecord = {}
          cols.forEach((c) => { if (ln[c.key] != null && ln[c.key] !== '') rowBody[c.key] = ln[c.key] })
          if (link && linkVal != null) rowBody[link.name] = linkVal
          return apiFetch(dataBase(base, form.lineItems.source), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowBody),
          })
        }))
      }
      refresh(); onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Couldn’t save.'); setBusy(false)
    }
  }
  const size = form.size || 'standard'
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal form-modal modal-${size}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{form.title}</div>
        {/* the field grid scrolls when the form is taller than the viewport;
            the title and the action bar stay pinned outside it. */}
        <div className="form-body">
          <div className="form-grid">
            {visible.map((f, i) => {
              const def = fieldDef(fields, fieldName(f.field)) // tolerate a stray type prefix
              return (
                <label className="form-field" key={i} style={{ gridColumn: `span ${spanOf(f.width)}` }}>
                  <span className="form-label">{f.label}{f.required && <span className="req">*</span>}</span>
                  {f.readonly
                    ? <div className="form-input form-readonly" aria-readonly="true">{String(vals[f.field] ?? '') || '—'}</div>
                    : <TypedInput def={def} value={vals[f.field] || ''} accept={f.accept} source={form.source} onChange={(v) => setVals((s) => ({ ...s, [f.field]: v }))} />}
                </label>
              )
            })}
          </div>
          {form.lineItems && (
            <div className="line-items">
              <div className="line-items-head" style={gridCols}>
                {cols.map((c, i) => <span key={i} className="li-col-label">{c.key}{c.required && <span className="req">*</span>}</span>)}
                <span className="li-col-action" />
              </div>
              {lines.map((ln, i) => (
                <div className="line-item-row" style={gridCols} key={i}>
                  {cols.map((c, ci) => (
                    <span className="li-cell" key={ci}>
                      <TypedInput def={fieldDef(lineFields, c.key)} value={ln[c.key] || ''} accept={c.accept} source={form.lineItems.source} onChange={(v) => setLine(i, c.key, v)} />
                    </span>
                  ))}
                  <button type="button" className="li-remove" title="Remove item" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}>×</button>
                </div>
              ))}
              <button type="button" className="li-add" onClick={() => setLines((ls) => [...ls, {}])}>+ Add item</button>
            </div>
          )}
          {form.totals && form.totals.length > 0 && (
            <div className="form-totals">
              {form.totals.map((t, i) => (
                <div className="form-total-row" key={i}>
                  <span className="form-total-label">{t.name}</span>
                  <span className="form-total-val">{String(formatValue(totals[t.name] ?? 0, fieldType(fields, t.name)))}</span>
                </div>
              ))}
            </div>
          )}
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-actions">
          <button className="toggle" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="toggle primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : form.title}</button>
        </div>
      </div>
    </div>
  )
}
