import React, { useState, useContext } from 'react'
import { FormsContext, useRefresh, useRules } from '../data.js'
import { fieldName } from '../parser.js'
import { passes } from '../rules.js'
import { fieldDef } from './format.js'
import { TypedInput } from './inputs.jsx'
import { useFields } from './viz.jsx'

// A button that opens a [Form] modal (via FormsContext).
export function FormButton({ node }) {
  const forms = useContext(FormsContext)
  return <button className="fmd-button" onClick={() => forms.open(node)}>{node.label}</button>
}

// A modal form that creates a record in its source on submit.
export function FormModal({ form, onClose }) {
  const fields = useFields(form.source)
  const refresh = useRefresh()
  const rules = useRules()
  const [vals, setVals] = useState({})
  const [err, setErr] = useState(null)
  // Only fields whose show-if condition passes (against current values) are shown.
  const visible = form.fields.filter((f) => !f.showIf || passes(f.showIf, vals, rules))
  const submit = () => {
    const missing = visible.filter((f) => f.required && !String(vals[f.field] ?? '').trim())
    if (missing.length) { setErr(`Required: ${missing.map((f) => f.label).join(', ')}`); return }
    const body = {}
    visible.forEach((f) => { if (vals[f.field] != null && vals[f.field] !== '') body[f.field] = vals[f.field] })
    fetch(`/api/${encodeURIComponent(form.source)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(() => { refresh(); onClose() })
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{form.title}</div>
        {visible.map((f, i) => {
          const def = fieldDef(fields, fieldName(f.field)) // tolerate a stray type prefix
          return (
            <label className="form-field" key={i}>
              <span className="form-label">{f.label}{f.required && <span className="req">*</span>}</span>
              <FormInput def={def} value={vals[f.field] || ''} onChange={(v) => setVals((s) => ({ ...s, [f.field]: v }))} />
            </label>
          )
        })}
        {err && <div className="form-error">{err}</div>}
        <div className="modal-actions">
          <button className="toggle" onClick={onClose}>Cancel</button>
          <button className="toggle primary" onClick={submit}>{form.title}</button>
        </div>
      </div>
    </div>
  )
}

function FormInput({ def, value, onChange }) {
  return <TypedInput def={def} value={value} onChange={onChange} />
}
