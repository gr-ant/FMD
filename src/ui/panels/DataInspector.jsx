import React from 'react'

// Dev-only view of "what exists behind the scenes": each [Data] entity, its
// declared fields, and the records currently loaded for it.
export default function DataInspector({ schema, store }) {
  const entities = Object.entries(schema)
  return (
    <div className="data-inspector">
      <div className="inspector-head">Data model — behind the scenes (not rendered)</div>
      <div className="inspector-grid">
        {entities.length === 0 && <div className="muted-cell">No [Data] entities declared.</div>}
        {entities.map(([key, def]) => {
          const records = store?.[key]
          return (
            <div className="entity" key={key}>
              <div className="entity-head">
                <strong>{def.name}</strong>
                <code>{key}</code>
                <span className={`store-badge ${def.kind === 'store' ? 'nosql' : 'sql'}`}>
                  {def.kind === 'store' ? 'JSONB · document' : 'SQL · table'}
                </span>
                <span className="bind-badge">{Array.isArray(records) ? `${records.length} records` : 'no data'}</span>
              </div>
              <div className="entity-fields">
                {(def.fields.length ? def.fields : [{ name: '(inferred)' }]).map((f) => (
                  <span className="field-chip" key={f.name}>
                    {f.name}
                    {f.type && <span className="field-type">{f.type}</span>}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
