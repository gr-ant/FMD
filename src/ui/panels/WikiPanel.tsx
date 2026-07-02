// WikiPanel — renders the generated AppWiki as styled HTML in the configurator.
// Appears as a collapsible overlay (same pattern as DataInspector).
import React, { useState } from 'react'
import type { AppWiki, WikiViz, WikiButton, WikiFieldRow, WikiFormField, WikiStep } from '../../fmd/wiki'

// ---- small helpers -------------------------------------------------------

function Gap({ msg }: { msg: string }) {
  return <div className="wiki-gap">{msg}</div>
}

function VizBadge({ viz }: { viz: string }) {
  const icons: Record<string, string> = {
    table: '⊞', counter: '#', checklist: '☑', slider: '▮', board: '⬜', calendar: '📅', chart: '📊',
  }
  return <span className="wiki-badge wiki-badge-viz">{icons[viz] || '◇'} {viz}</span>
}

function KindBadge({ kind }: { kind: 'list' | 'store' | 'api' }) {
  const labels: Record<string, string> = { list: 'SQL table', store: 'document', api: 'external API' }
  return <span className={`wiki-badge wiki-badge-kind wiki-badge-${kind}`}>{labels[kind] ?? kind}</span>
}

/** Describe CRUD flags in plain English. */
function crudDesc(v: WikiViz): string | null {
  const ops: string[] = []
  if (v.canCreate) ops.push('create')
  if (v.canUpdate) ops.push('edit')
  if (v.canDelete) ops.push('delete')
  return ops.length ? ops.join(' / ') : null
}

// ---- section components --------------------------------------------------

function OverviewSection({ wiki }: { wiki: AppWiki }) {
  return (
    <section className="wiki-section">
      <h2 className="wiki-h2">Overview</h2>
      <div className="wiki-overview-grid">
        <div className="wiki-kv"><span className="wiki-kv-label">App name</span><span>{wiki.appName || <em className="wiki-empty">not set</em>}</span></div>
        <div className="wiki-kv"><span className="wiki-kv-label">Pages</span><span>{wiki.pages.length ? wiki.pages.map((p) => p.name).join(', ') : <em className="wiki-empty">none</em>}</span></div>
        {wiki.roles.length > 0 && (
          <div className="wiki-kv">
            <span className="wiki-kv-label">Roles</span>
            <span>{wiki.roles.map((r) => <span key={r} className="wiki-role-chip">{r}</span>)}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function DataModelSection({ wiki }: { wiki: AppWiki }) {
  return (
    <section className="wiki-section">
      <h2 className="wiki-h2">Data model</h2>
      {wiki.entities.length === 0 && <p className="wiki-empty-note">No [Data] entities declared yet.</p>}
      {wiki.entities.map((e) => (
        <div key={e.source} className="wiki-entity-block">
          <div className="wiki-entity-head">
            <strong className="wiki-entity-name">{e.name}</strong>
            <code className="wiki-source-tag">{e.source}</code>
            <KindBadge kind={e.kind} />
          </div>
          {e.gaps.map((g, i) => <Gap key={i} msg={g} />)}
          {e.fields.length > 0 && (
            <table className="wiki-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Computed</th>
                  <th>Expression / Options</th>
                </tr>
              </thead>
              <tbody>
                {e.fields.map((f: WikiFieldRow) => (
                  <tr key={f.name}>
                    <td className="wiki-field-name">{f.name}</td>
                    <td><span className="wiki-type-chip">{f.type}</span></td>
                    <td>{f.computed && <span className="wiki-computed-chip">{f.computed}</span>}</td>
                    <td className="wiki-formula">{f.formula || f.options || <span className="wiki-dash">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  )
}

function PagesSection({ wiki }: { wiki: AppWiki }) {
  return (
    <section className="wiki-section">
      <h2 className="wiki-h2">Pages</h2>
      {wiki.pages.length === 0 && <p className="wiki-empty-note">No [Display] pages declared yet.</p>}
      {wiki.pages.map((pg) => (
        <div key={pg.name} className="wiki-page-block">
          <h3 className="wiki-h3">{pg.name}</h3>
          {pg.gaps.map((g, i) => <Gap key={i} msg={g} />)}
          {pg.vizzes.length > 0 && (
            <ul className="wiki-viz-list">
              {pg.vizzes.map((v: WikiViz, i) => {
                const crud = crudDesc(v)
                return (
                  <li key={i} className="wiki-viz-item">
                    <VizBadge viz={v.viz} />
                    {v.source && <> <span className="wiki-arrow">→</span> <code>{v.source}</code></>}
                    {v.filter && <span className="wiki-filter"> where <em>{v.filter}</em></span>}
                    {crud && <span className="wiki-crud-tag">{crud}</span>}
                  </li>
                )
              })}
            </ul>
          )}
          {pg.buttons.length > 0 && (
            <ul className="wiki-btn-list">
              {pg.buttons.map((b: WikiButton, i) => (
                <li key={i} className="wiki-btn-item">
                  <span className="wiki-badge wiki-badge-btn">Button</span>
                  <span className="wiki-btn-label">"{b.label}"</span>
                  {b.target && <><span className="wiki-arrow">→</span><code>{b.target}</code></>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}

function FormsSection({ wiki }: { wiki: AppWiki }) {
  if (!wiki.forms.length) return null
  return (
    <section className="wiki-section">
      <h2 className="wiki-h2">Forms</h2>
      {wiki.forms.map((f) => (
        <div key={f.title} className="wiki-form-block">
          <div className="wiki-entity-head">
            <strong className="wiki-entity-name">{f.title}</strong>
            {f.source && <><span className="wiki-arrow">→</span><code className="wiki-source-tag">{f.source}</code></>}
            <span className="wiki-badge wiki-badge-size">{f.size}</span>
          </div>
          {f.gaps.map((g, i) => <Gap key={i} msg={g} />)}
          {f.fields.length > 0 && (
            <table className="wiki-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Field</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {f.fields.map((ff: WikiFormField) => {
                  const flags: string[] = []
                  if (ff.required) flags.push('required')
                  if (ff.readonly) flags.push('read-only')
                  if (ff.autofill) flags.push(`auto: ${ff.autofill}`)
                  if (ff.showIf) flags.push(`show if: ${ff.showIf}`)
                  return (
                    <tr key={ff.field}>
                      <td>{ff.label}</td>
                      <td className="wiki-field-name">{ff.field}</td>
                      <td className="wiki-flags">{flags.join(' · ') || <span className="wiki-dash">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {f.lineItems && (
            <div className="wiki-lineitems">
              <span className="wiki-kv-label">Line items</span>
              {f.lineItems.source && <><span className="wiki-arrow">→</span><code>{f.lineItems.source}</code></>}
              <span className="wiki-li-cols">{f.lineItems.cols.join(', ')}</span>
            </div>
          )}
          {f.totals.length > 0 && (
            <div className="wiki-totals">
              {f.totals.map((t) => (
                <div key={t.name} className="wiki-total-row">
                  <span className="wiki-computed-chip">Total</span>
                  <strong>{t.name}</strong>
                  <span className="wiki-formula"> = {t.expr}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function StepList({ steps }: { steps: WikiStep[] }) {
  if (!steps.length) return <p className="wiki-empty-note">No steps declared.</p>
  return (
    <ol className="wiki-step-list">
      {steps.map((s, i) => {
        const assigns = s.assigns.map((a) => `${a.field} = ${a.expr}`).join(', ')
        // An outbound [Post]/[Call] step targets a named connection + path; a
        // record-write step targets a source with an optional `where` filter.
        const target = s.connection
          ? <> → <code>@{s.connection}{s.path}</code></>
          : <>{s.source ? <> on <code>{s.source}</code></> : null}{s.filter ? <> where <em>{s.filter}</em></> : null}</>
        return (
          <li key={i} className="wiki-step">
            <span className={`wiki-op wiki-op-${s.op}`}>{s.op.toUpperCase()}</span>
            {target}
            {assigns && <span className="wiki-assigns">: {assigns}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function AutomationsSection({ wiki }: { wiki: AppWiki }) {
  if (!wiki.actions.length && !wiki.triggers.length) return null
  return (
    <section className="wiki-section">
      <h2 className="wiki-h2">Automations</h2>

      {wiki.actions.length > 0 && (
        <>
          <h3 className="wiki-h3 wiki-h3-sub">Actions</h3>
          {wiki.actions.map((a) => (
            <div key={a.name} className="wiki-action-block">
              <div className="wiki-action-head">
                <span className="wiki-badge wiki-badge-action">Action</span>
                <strong>{a.name}</strong>
              </div>
              {a.gaps.map((g, i) => <Gap key={i} msg={g} />)}
              <StepList steps={a.steps} />
            </div>
          ))}
        </>
      )}

      {wiki.triggers.length > 0 && (
        <>
          <h3 className="wiki-h3 wiki-h3-sub">Triggers</h3>
          {wiki.triggers.map((t, i) => (
            <div key={i} className="wiki-action-block">
              <div className="wiki-action-head">
                <span className="wiki-badge wiki-badge-trigger">Trigger</span>
                <strong>{t.label}</strong>
                <span className="wiki-trigger-src">
                  scans <code>{t.source}</code>
                  {t.condition && <> where <em>{t.condition}</em></>}
                </span>
              </div>
              <StepList steps={t.steps} />
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function PermissionsSection({ wiki }: { wiki: AppWiki }) {
  if (!wiki.permMatrix.length && !wiki.roles.length) return null
  return (
    <section className="wiki-section">
      <h2 className="wiki-h2">Permissions</h2>
      {wiki.roles.length > 0 && (
        <p className="wiki-perm-roles">
          Declared roles: {wiki.roles.map((r) => <span key={r} className="wiki-role-chip">{r}</span>)}
        </p>
      )}
      {wiki.permMatrix.length === 0 && <p className="wiki-empty-note">No per-entity permission grants declared.</p>}
      {wiki.permMatrix.length > 0 && (
        <table className="wiki-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Role</th>
              <th>Verbs</th>
            </tr>
          </thead>
          <tbody>
            {wiki.permMatrix.flatMap((row) =>
              row.grants.map((g, i) => (
                <tr key={`${row.entity}-${g.role}`}>
                  {i === 0 && <td rowSpan={row.grants.length} className="wiki-entity-name">{row.entityName}</td>}
                  <td><span className="wiki-role-chip">{g.role}</span></td>
                  <td>{g.verbs.map((v) => <span key={v} className={`wiki-verb wiki-verb-${v}`}>{v}</span>)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ---- Main panel ----------------------------------------------------------

type Props = {
  wiki: AppWiki
  onClose: () => void
}

export default function WikiPanel({ wiki, onClose }: Props) {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'data', label: `Data (${wiki.entities.length})` },
    { id: 'pages', label: `Pages (${wiki.pages.length})` },
    { id: 'forms', label: `Forms (${wiki.forms.length})` },
    { id: 'automations', label: `Automations (${wiki.actions.length + wiki.triggers.length})` },
    { id: 'permissions', label: `Permissions` },
  ]

  return (
    <div className="wiki-panel">
      <div className="wiki-panel-head">
        <div className="wiki-panel-title">
          <span className="wiki-panel-icon">📖</span>
          <span>App wiki{wiki.appName ? ` — ${wiki.appName}` : ''}</span>
        </div>
        <div className="wiki-panel-nav">
          {sections.map((s) => (
            <button
              key={s.id}
              className={`wiki-nav-btn${activeSection === s.id ? ' active' : ''}`}
              onClick={() => setActiveSection(activeSection === s.id ? null : s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button className="wiki-close" onClick={onClose} title="Close wiki">✕</button>
      </div>

      <div className="wiki-body">
        {/* Top-level documentation gaps */}
        {wiki.topGaps.length > 0 && (
          <div className="wiki-top-gaps">
            {wiki.topGaps.map((g, i) => <Gap key={i} msg={g} />)}
          </div>
        )}

        {/* Show all sections when none selected, else show just the active one */}
        {(activeSection === null || activeSection === 'overview') && <OverviewSection wiki={wiki} />}
        {(activeSection === null || activeSection === 'data') && <DataModelSection wiki={wiki} />}
        {(activeSection === null || activeSection === 'pages') && <PagesSection wiki={wiki} />}
        {(activeSection === null || activeSection === 'forms') && <FormsSection wiki={wiki} />}
        {(activeSection === null || activeSection === 'automations') && <AutomationsSection wiki={wiki} />}
        {(activeSection === null || activeSection === 'permissions') && <PermissionsSection wiki={wiki} />}
      </div>
    </div>
  )
}
