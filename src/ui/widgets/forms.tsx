import React, { useState, useContext } from 'react'
import { FormsContext, ActionsContext, useRefresh, useRules, useApiBase, useCase } from '../../data'
import { fieldName } from '../../parser'
import { passes } from '../../fmd/rules'
import { fieldDef } from '../../fmd/format'
import { matchAction } from '../panels/helpers'
import { useDialogs } from '../dialogs'
import { TypedInput } from './inputs'
import { useFields } from './viz'
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
type FormDef = {
  title: string
  source: string | null
  size?: 'compact' | 'standard' | 'wide'
  fields: FormField[]
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

// A modal form that creates a record in its source on submit.
export function FormModal({ form, onClose }: { form: FormDef; onClose: () => void }) {
  const fields = useFields(form.source)
  const refresh = useRefresh()
  const rules = useRules()
  const base = useApiBase()
  // Seed auto-filled fields (CurrentUser, literals, Today/Now) once, on open.
  const [vals, setVals] = useState<FmdRecord>(() => {
    const init: FmdRecord = {}
    for (const f of form.fields) if (f.autofill) init[f.field] = resolveAutofill(f.autofill)
    return init
  })
  const [err, setErr] = useState<string | null>(null)
  // Only fields whose show-if condition passes (against current values) are shown.
  const visible = form.fields.filter((f) => !f.showIf || passes(f.showIf, vals, rules))
  const submit = () => {
    const missing = visible.filter((f) => f.required && !String(vals[f.field] ?? '').trim())
    if (missing.length) { setErr(`Required: ${missing.map((f) => f.label).join(', ')}`); return }
    const body: FmdRecord = {}
    // Key by the plain column name (strip any type prefix, e.g. fileAttachment ->
    // Attachment) so the value lands in the right column.
    visible.forEach((f) => { if (vals[f.field] != null && vals[f.field] !== '') body[fieldName(f.field)] = vals[f.field] })
    apiFetch(dataBase(base, form.source), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(() => { refresh(); onClose() })
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
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-actions">
          <button className="toggle" onClick={onClose}>Cancel</button>
          <button className="toggle primary" onClick={submit}>{form.title}</button>
        </div>
      </div>
    </div>
  )
}
