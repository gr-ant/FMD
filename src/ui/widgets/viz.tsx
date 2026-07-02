import React, { useContext, useState } from 'react'
import Renderer from '../Renderer'
import { useSource, keysOf, pickField, isNum, SchemaContext, RecordContext, useRefresh, useRules, useApiBase, useVisibilityRoles, useRecord, useFormsList, useCaseNav, useActions } from '../../data'
import type { OpenCaseValue } from '../../state/contexts'
import { fieldName, visibleForRoles } from '../../parser'
import { widgetViz, parseFieldMarkers } from '../../fmd/parse/nodes'
import { passes } from '../../fmd/rules'
import { parseAggregate, splitEntityField, aggregate } from '../../fmd/expr'
import { evalExpr } from '../../fmd/calc'
import { formatValue, fieldDef, fieldType } from '../../fmd/format'
import { EditableCell, NewRow } from './inputs'
import { FileView } from './fileInput'
import { AuditButton } from './audit'
import { classify, Checklist, Empty } from './shared'
import { FormButton, spanOf } from './forms'
import { filterRows, useFields, resolveField, type ResolvedField } from './vizShared'
import { VizChart } from './vizChart'
import { matchAction } from '../panels/helpers'
import { executeAction, pokeTriggers } from '../runAction'
import { useDialogs } from '../dialogs'
import { apiFetch, dataBase } from '../../state/auth'
import type {
  Node,
  VizNode,
  WidgetNode,
  DetailNode,
  CasesNode,
  ViewNode,
  RowButtonNode,
  BulkActionNode,
  ActionNode,
  FootNode,
  KindNode,
  SearchNode,
  FilterNode,
  ItemNode,
  Field,
  FieldType,
  FmdRecord,
  PermissionVerb,
} from '../../fmd/types'

// Whether the current user's roles permit each verb on a source — mirrors the
// server's isAllowed: open for '*', open when the source declares no
// [Permission] (backward compatible), else a role must grant the verb. This is
// what makes CRUD affordances and data rendering reflect assigned permissions.
function usePermits(source: string | null): Record<PermissionVerb, boolean> {
  const schema = useContext(SchemaContext)
  const roles = useVisibilityRoles()
  const perms = source ? schema?.[source.toLowerCase()]?.permissions : undefined
  const allow = (verb: PermissionVerb): boolean => {
    if (roles.includes('*')) return true
    if (!perms) return true
    return roles.some((r) => perms[r]?.verbs?.includes(verb))
  }
  return { read: allow('read'), create: allow('create'), update: allow('update'), delete: allow('delete') }
}

// A footer/subtotal aggregate spec bound to a resolved column key.
type FootSpec = { fn: string; field: string | null; key: string | null }

// ---- structured widgets (nested FMD syntax: rows of (Name) cards) ----

// A (Name) widget card whose body is the indented [Viz] tag(s) beneath it.
// A card that holds ONLY buttons renders as a compact action bar (no big card
// chrome) so an "actions" group doesn't waste a full card of space.
export function WidgetCard({ node }: { node: WidgetNode }): React.ReactNode {
  // (Table -> X), (Board -> Y) … render as the viz, identical to [Table -> X].
  const asViz = node.children.length === 0 ? widgetViz(node.name) : null
  if (asViz) return <Viz node={asViz} />
  const kind = classify(node.name)
  const roles = useVisibilityRoles()
  // Drop children hidden by their own `{Role, !Role}` block.
  const visible = node.children.filter((c) => visibleForRoles(c.roles, roles))
  // Buttons and [User Management] are "button-like" — an all-button card renders
  // as a slim action bar; everything else gets the full card.
  const isButtonLike = (c: Node) => c.type === 'Button' || c.type === 'UserManagement'
  // Render every card child through the full Renderer so a card can hold ANY
  // element — [Cases]/[Detail]/[View]/[Text]/[List]/nested cards — not just the
  // six [Viz] tags. (Renderer routes [Button] to FormButton itself.)
  const renderChild = (c: Node, i: number) => <Renderer key={i} node={c} />
  const onlyButtons = visible.length > 0 && visible.every(isButtonLike)
  if (onlyButtons) {
    return <div className="action-bar">{visible.map(renderChild)}</div>
  }
  return (
    <div className="widget" data-kind={kind}>
      <div className="widget-head">
        <h3>{node.name}</h3>
      </div>
      <div className="widget-body">{visible.map(renderChild)}</div>
    </div>
  )
}

// Dispatch a [Viz] node to its visualization. Each pulls from node.source.
export function Viz({ node }: { node: Node }): React.ReactNode {
  const source = node && node.type === 'Viz' ? node.source : null
  const permits = usePermits(source)
  if (!node || node.type !== 'Viz') return null
  // No read permission -> don't render (or fetch) the source's data at all.
  if (!permits.read) return <Empty source={node.source} />
  switch (node.viz) {
    case 'table': return <VizTable node={node} />
    case 'counter': return <VizCounter node={node} />
    case 'checklist': return <VizChecklist node={node} />
    case 'slider': return <VizSlider node={node} />
    case 'board': return <VizBoard node={node} />
    case 'calendar': return <VizCalendar node={node} />
    case 'chart': return <VizChart node={node} />
    default: return null
  }
}

// The labels generated by a viz's [Count]/[Slide] (and plural) children.
export const itemEntries = (node: VizNode): ItemNode['items'] =>
  node.children.filter((c): c is ItemNode => c.type === 'Item').flatMap((c) => c.items)

// Find the record whose `key` field matches `label` (exact, then contains).
export function matchRecord(rows: FmdRecord[] | null, label: string, key: string | null): FmdRecord | null {
  if (!rows || !key) return null
  const l = label.toLowerCase()
  return rows.find((r) => String(r[key] ?? '').toLowerCase() === l)
    || rows.find((r) => String(r[key] ?? '').toLowerCase().includes(l))
    || null
}

// A read-only table cell value, clipped with an ellipsis so a stray oversized
// value (e.g. a pasted document) truncates instead of blowing out the row; the
// full text stays available on hover.
function CellText({ children }: { children: React.ReactNode }): React.ReactNode {
  const text = children == null ? '' : String(children)
  return <span className="cell-text" title={text}>{text}</span>
}

// A table with optional CRUD interactivity, driven by the tag prefix
// (cTable/uTable/dTable, any combination). Mutations hit the backend, then
// refresh re-fetches the data so the table reflects the database.
function VizTable({ node }: { node: VizNode }): React.ReactNode {
  const rules = useRules()
  let rows = filterRows(useSource(node.source), node.filter, rules)
  const fields = useFields(node.source)
  const refresh = useRefresh()
  const base = useApiBase()
  const permits = usePermits(node.source) // all hooks BEFORE the `if (!rows)` guard
  const { actions } = useActions() // for [BulkAction] buttons (matched by name/target)
  const dialogs = useDialogs() // destructive bulk actions confirm before running
  // Viewer-facing [Search]/[Filter] controls narrow the rows client-side (before
  // the author's sort/group/foot passes). Their state lives here on the table.
  const [query, setQuery] = useState('')
  const [selections, setSelections] = useState<Record<string, string>>({})
  // [BulkAction]: the set of checkbox-selected row _ids (as strings). All hooks
  // stay above the `if (!rows)` guard to keep the hook order stable.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const searchNode = node.children.find((c): c is SearchNode => c.type === 'Search')
  const filterNodes = node.children.filter((c): c is FilterNode => c.type === 'Filter')
  if (!rows) return <Empty source={node.source} />

  const cols = node.spec
    ? node.spec.split(',').map((s) => resolveField(fields, rows, s)).filter((c) => c.name)
    : keysOf(rows).filter((k) => k !== '_id').map((k) => ({ name: k, key: k, ok: true }))

  // ---- viewer controls: [Search] + [Filter] (applied before sort/group/foot) --
  // Each [Filter] resolves to a column key plus the distinct display values of
  // the loaded rows (deduped, original order) for its dropdown.
  const hasControls = !!searchNode || filterNodes.length > 0
  // An indented [Audit] adds a history icon to the table header (this source's trail).
  const auditNode = node.children.find((c) => c.type === 'Audit')
  const filters = filterNodes.map((f) => {
    const rf = resolveField(fields, rows, f.field)
    const type = fieldType(fields, rf.key)
    const values: string[] = []
    const seen = new Set<string>()
    rows.forEach((r) => {
      const disp = rf.key ? String(formatValue(r[rf.key], type)) : ''
      if (disp !== '' && !seen.has(disp)) { seen.add(disp); values.push(disp) }
    })
    return { field: rf.name, key: rf.key, type, values, selected: selections[rf.name] || '' }
  })
  const q = query.trim().toLowerCase()
  const filtering = hasControls && (!!q || filters.some((f) => f.selected))
  if (q) {
    rows = rows.filter((r) =>
      cols.some((c) => c.key && String(formatValue(r[c.key], fieldType(fields, c.key))).toLowerCase().includes(q)))
  }
  for (const f of filters) {
    if (f.selected && f.key) rows = rows.filter((r) => String(formatValue(r[f.key], f.type)) === f.selected)
  }

  // CRUD controls appear only when the author enabled them (tag prefix) AND the
  // user's role is permitted the verb — so a viewer never sees add/edit/delete.
  const crud = node.crud || ''
  const canCreate = crud.includes('c') && permits.create
  const canUpdate = crud.includes('u') && permits.update
  const canDelete = crud.includes('d') && permits.delete
  // Per-row action buttons ([RowButton]/[RowAction]) render in a trailing actions
  // column, one button per declared row-button per row. Additive: with none, the
  // table renders exactly as before.
  const rowButtons = (permits.create || permits.update || permits.delete)
    ? node.children.filter((c): c is RowButtonNode => c.type === 'RowButton')
    : [] // only show row actions to a user with a write permit (else clicks 403 silently)
  const hasRowActions = rowButtons.length > 0
  // Bulk actions ([BulkAction]/[BulkButton]) add a leading checkbox column and a
  // toolbar (shown once ≥1 row is selected). Gated by a write permit, same as
  // [RowButton]. Additive: with none, the table renders exactly as before.
  const bulkActions = (permits.create || permits.update || permits.delete)
    ? node.children.filter((c): c is BulkActionNode => c.type === 'BulkAction')
    : []
  const hasBulk = bulkActions.length > 0
  const span = (hasBulk ? 1 : 0) + cols.length + (canDelete ? 1 : 0) + (hasRowActions ? 1 : 0)

  // Toggle one row's checkbox (keyed by its _id, stringified).
  const toggleRow = (id: string): void =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // Run a [BulkAction]'s [Action] once per selected record, each bound as `this`
  // (reusing the action runtime). Destructive actions confirm first. On
  // completion clear the selection, poke triggers, and refresh the table.
  const runBulk = async (b: BulkActionNode): Promise<void> => {
    const action = matchAction(actions as Record<string, ActionNode>, b)
    if (!action) return
    const chosen = rows.filter((r) => r._id != null && selected.has(String(r._id)))
    if (!chosen.length) return
    const steps = (action as unknown as { steps?: { op?: string }[] }).steps
    if (steps?.some((s) => s.op === 'delete') && !(await dialogs.confirm({
      danger: true, title: b.label,
      message: `This runs “${b.label}” on ${chosen.length} selected record${chosen.length === 1 ? '' : 's'} and can’t be undone.`,
      confirmLabel: b.label, cancelLabel: 'Cancel',
    }))) return
    for (const r of chosen) await executeAction(action, { rules, base, record: r, source: node.source })
    await pokeTriggers(base)
    setSelected(new Set())
    refresh()
  }
  const api = (path: string, opts?: RequestInit): Promise<void> =>
    apiFetch(`${dataBase(base, node.source)}${path}`, opts).then(refresh)

  const patch = (row: FmdRecord, key: string, value: unknown): Promise<void> =>
    api(`/${row._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) })
  const remove = (row: FmdRecord): Promise<void> => api(`/${row._id}`, { method: 'DELETE' })

  // A cell's raw value for sort/group/aggregate — computes [Calc] fields so a
  // computed column can be sorted, grouped, and totalled like a stored one.
  const rawValue = (r: FmdRecord, key: string): unknown => {
    const def = fieldDef(fields, key)
    return def?.calc ? evalExpr(def.calc, r) : r[key]
  }

  // ---- sub-directives: [Sort], [Group], [Foot] -----------------------------
  const sort = node.children.find((c) => c.type === 'Sort')
  const group = node.children.find((c) => c.type === 'Group')
  const footSpecs: FootSpec[] = node.children
    .filter((c): c is FootNode => c.type === 'Foot')
    .flatMap((c) => c.specs)
    .map((s) => ({ ...s, ...(s.field ? { key: resolveField(fields, rows, s.field).key } : { key: null }) }))

  if (sort && sort.type === 'Sort' && sort.field) {
    const sk = resolveField(fields, rows, sort.field).key
    const dir = sort.dir === 'desc' ? -1 : 1
    rows = [...rows].sort((a, b) => {
      const av = rawValue(a, sk), bv = rawValue(b, sk)
      if (isNum(av) && isNum(bv)) return (Number(av) - Number(bv)) * dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir
    })
  }

  // Aggregate a spec over a set of rows (calc-aware via rawValue).
  const aggOf = (spec: FootSpec, rs: FmdRecord[]): number | string => {
    if (spec.fn === 'count') return rs.length
    if (!spec.key) return ''
    const projected = rs.map((r) => ({ _v: rawValue(r, spec.key) }))
    return aggregate(spec.fn, projected, '_v')
  }
  // A footer/subtotal <tr>: each spec lands under its column; a fieldless
  // count sits in the first column.
  const footRow = (rs: FmdRecord[], cls: string): React.ReactNode => (
    <tr className={cls}>
      {hasBulk && <td className="bulk-cell" />}
      {cols.map((c, ci) => {
        const colSpec = footSpecs.find((s) => s.key && s.key === c.key)
        const countSpec = ci === 0 ? footSpecs.find((s) => s.fn === 'count') : null
        return (
          <td key={ci} className="foot-cell">
            {colSpec ? formatValue(aggOf(colSpec, rs), fieldType(fields, c.key)) : countSpec ? `${rs.length}` : ''}
          </td>
        )
      })}
      {canDelete && <td className="row-action" />}
      {hasRowActions && <td className="row-actions" />}
    </tr>
  )

  const renderRow = (r: FmdRecord, ri: number | string): React.ReactNode => (
    <tr key={r._id ?? ri} className={hasBulk && r._id != null && selected.has(String(r._id)) ? 'row-selected' : undefined}>
      {hasBulk && (
        <td className="bulk-cell">
          {r._id != null && (
            <input
              type="checkbox"
              className="bulk-check"
              aria-label="Select row"
              checked={selected.has(String(r._id))}
              onChange={() => toggleRow(String(r._id))}
            />
          )}
        </td>
      )}
      {cols.map((c, ci) => {
        const def = fieldDef(fields, c.key)
        return (
          <td key={ci} data-label={c.name}>
            {def?.rollup
              ? <RollupCell parentRow={r} def={def} parentSource={node.source} type={def.type} />
              : def?.lookup
                ? <LookupCell row={r} def={def} fields={fields} />
                : def?.calc
                  ? <CellText>{formatValue(evalExpr(def.calc, r), def.type)}</CellText>
                  : canUpdate && r._id != null
                    ? <EditableCell value={r[c.key]} field={def} source={node.source} onCommit={(v) => patch(r, c.key, v)} />
                    : def?.type === 'file' || def?.type === 'files'
                      ? <FileView value={r[c.key]} toggle={false} />
                      : <CellText>{formatValue(r[c.key], fieldType(fields, c.key))}</CellText>}
          </td>
        )
      })}
      {canDelete && (
        <td className="row-action">
          {r._id != null && <button className="del-btn" title="Delete row" onClick={() => remove(r)}>×</button>}
        </td>
      )}
      {hasRowActions && (
        // Wrap this row's buttons in a RecordContext bound to THAT row, so
        // FormButton's useCase() resolves to this record — reusing the existing
        // action-run + destructive-confirm + `this`-binding machinery. run()
        // refreshes the data on completion, so the table re-fetches automatically.
        <td className="row-actions">
          <RecordContext.Provider value={{ record: r, source: node.source }}>
            {rowButtons.map((b, bi) => <FormButton key={bi} node={b} compact />)}
          </RecordContext.Provider>
        </td>
      )}
    </tr>
  )

  // ---- grouped body: sections by the [Group] field, each with a subtotal ----
  let body: React.ReactNode
  if (group && group.type === 'Group' && group.field) {
    const gk = resolveField(fields, rows, group.field).key
    const order: string[] = []
    const buckets = new Map<string, FmdRecord[]>()
    rows.forEach((r) => {
      const v = String(rawValue(r, gk) ?? '')
      if (!buckets.has(v)) { buckets.set(v, []); order.push(v) }
      buckets.get(v).push(r)
    })
    body = order.map((v, gi) => (
      <React.Fragment key={gi}>
        <tr className="group-head">
          <td colSpan={span}>{v || '—'}<span className="group-count">{buckets.get(v).length}</span></td>
        </tr>
        {buckets.get(v).map((r, ri) => renderRow(r, `${gi}:${ri}`))}
        {footSpecs.length > 0 && footRow(buckets.get(v), 'subtotal')}
      </React.Fragment>
    ))
  } else {
    body = rows.map((r, ri) => renderRow(r, ri))
  }

  return (
    <>
      {(hasControls || auditNode) && (
        <div className="viz-controls">
          {searchNode && (
            <input
              className="viz-search"
              type="text"
              value={query}
              placeholder={searchNode.placeholder || 'Search…'}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {filters.map((f, i) => (
            <select
              key={i}
              className="viz-filter"
              value={f.selected}
              onChange={(e) => setSelections((s) => ({ ...s, [f.field]: e.target.value }))}
            >
              <option value="">All {f.field}</option>
              {f.values.map((v, vi) => <option key={vi} value={v}>{v}</option>)}
            </select>
          ))}
          {auditNode && <AuditButton source={node.source} title={`${node.source} history`} compact />}
        </div>
      )}
      {/* Bulk-action toolbar: appears once ≥1 row is selected; each button runs
          its [Action] once per selected record. */}
      {hasBulk && selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.size} selected</span>
          {bulkActions.map((b, i) => (
            <button key={i} className="fmd-button bulk-btn" onClick={() => runBulk(b)}>{b.label}</button>
          ))}
          <button className="bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {/* wrapper lets a wide table scroll horizontally instead of overflowing on
          narrow (mobile) screens. */}
      <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>
            {hasBulk && (() => {
              // Select-all toggles every currently-shown row that has an _id.
              const ids = rows.filter((r) => r._id != null).map((r) => String(r._id))
              const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
              return (
                <th className="bulk-cell">
                  <input
                    type="checkbox"
                    className="bulk-check"
                    aria-label="Select all rows"
                    checked={allOn}
                    onChange={() => setSelected(() => (allOn ? new Set() : new Set(ids)))}
                  />
                </th>
              )
            })()}
            {cols.map((c, i) => <th key={i}>{c.name}</th>)}{canDelete && <th className="row-action" />}{hasRowActions && <th className="row-actions" />}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && !canCreate && (
            <tr><td colSpan={span || 1} className="muted-cell">
              {filtering ? '◌ no matches' : <>◌&ensp;no records in “{node.source}” yet</>}
            </td></tr>
          )}
          {body}
          {canCreate && !group && <NewRow source={node.source} cols={cols} fields={fields} leadCol={hasBulk} extraCol={canDelete} extraActionCol={hasRowActions} onAdded={refresh} />}
        </tbody>
        {footSpecs.length > 0 && <tfoot>{footRow(rows, 'grand-total')}</tfoot>}
      </table>
      </div>
    </>
  )
}

function VizCounter({ node }: { node: VizNode }): React.ReactNode {
  const rows = filterRows(useSource(node.source), node.filter, useRules())
  const fields = useFields(node.source)
  if (!rows) return <Empty source={node.source} />
  const labelKey = rows.length ? pickField(rows, [/title|name|label/i], () => true) : null
  const valueKey = rows.length ? pickField(rows, [/count|qty|quantity|number|total|value/i], (k, r) => isNum(r[0][k])) : null
  const sub = node.spec && rows.length ? resolveField(fields, rows, node.spec) : null
  return (
    <div className="stat-grid">
      {itemEntries(node).map((it, i) => (
        it.expr
          ? <AggregateStat key={i} label={it.label} expr={it.expr} />
          : <MatchedStat key={i} label={it.label} rec={matchRecord(rows, it.label, labelKey)} valueKey={valueKey} sub={sub} fields={fields} />
      ))}
    </div>
  )
}

// A counter item matched to a record by label (the original behavior).
type MatchedStatProps = {
  label: string
  rec: FmdRecord | null
  valueKey: string | null
  sub: ResolvedField | null
  fields: Field[] | null
}
function MatchedStat({ label, rec, valueKey, sub, fields }: MatchedStatProps): React.ReactNode {
  return (
    <div className="stat">
      <div className="stat-val">{rec ? formatValue(rec[valueKey], fieldType(fields, valueKey)) : '—'}</div>
      <div className="stat-label">{label}</div>
      {sub && sub.ok && rec && <div className="stat-sub">{formatValue(rec[sub.key], fieldType(fields, sub.key))}</div>}
    </div>
  )
}

// A counter item backed by a live aggregate: count/sum/avg/min/max(Entity ? cond).
function AggregateStat({ label, expr }: { label: string; expr: string }): React.ReactNode {
  const schema = useContext(SchemaContext)
  const rules = useRules()
  const agg = parseAggregate(expr)
  const resolved = agg ? splitEntityField(agg.ref, new Set(Object.keys(schema || {}))) : { source: null, field: null }
  const rows = useSource(resolved.source)
  const filtered = agg ? (rows || []).filter((r) => passes(agg.filter, r, rules)) : []
  return (
    <div className="stat">
      <div className="stat-val">{agg ? aggregate(agg.fn, filtered, resolved.field) : '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

// A [Rollup] cell: aggregate a child entity's rows scoped to THIS parent row,
// via the child's link back to the parent (or the `via` field). Resolves child
// [Calc] fields before aggregating, and honors a `? filter`.
type RollupCellProps = { parentRow: FmdRecord; def: Field; parentSource: string | null; type?: FieldType }
function RollupCell({ parentRow, def, parentSource, type }: RollupCellProps): React.ReactNode {
  const schema = useContext(SchemaContext)
  const rules = useRules()
  const agg = parseAggregate(def.rollup)
  const resolved = agg ? splitEntityField(agg.ref, new Set(Object.keys(schema || {}))) : { source: null, field: null }
  const childRows = useSource(resolved.source)
  if (!agg) return <>—</>
  const lc = (s: unknown): string => String(s ?? '').toLowerCase()
  const childSchema = schema[resolved.source] || { fields: [] as Field[] }
  const childLink = (agg.via && childSchema.fields.find((f) => lc(f.name) === lc(agg.via)))
    || childSchema.fields.find((f) => f.type === 'link' && f.options?.source === parentSource)
  let scoped = childRows || []
  if (childLink) scoped = scoped.filter((r) => lc(r[childLink.name]) === lc(parentRow[childLink.options?.field]))
  scoped = scoped.filter((r) => passes(agg.filter, r, rules))
  const childField = childSchema.fields.find((f) => lc(f.name) === lc(resolved.field))
  const rowsForAgg = childField?.calc
    ? scoped.map((r) => ({ ...r, [resolved.field]: evalExpr(childField.calc, r) }))
    : scoped
  const blank = scoped.length === 0 && (agg.fn === 'avg' || agg.fn === 'min' || agg.fn === 'max')
  return <>{blank ? '—' : formatValue(aggregate(agg.fn, rowsForAgg, agg.fn === 'count' ? null : resolved.field), type)}</>
}

// A [Lookup] cell: follow this row's link field to the entity it points at and
// read a field off the matched record. `via` is the link field on this entity
// (its options carry the target source + match field); `target` is the field to
// pull from the linked record.
type LookupCellProps = { row: FmdRecord; def: Field; fields: Field[] | null }
function LookupCell({ row, def, fields }: LookupCellProps): React.ReactNode {
  const lc = (s: unknown): string => String(s ?? '').toLowerCase()
  const linkDef = fields?.find((f) => lc(f.name) === lc(def.lookup.via))
  const source = linkDef?.options?.source
  const matchField = linkDef?.options?.field
  const linked = useSource(source)
  if (!def.lookup.target) return <>—</>
  if (!linked) return <>…</>
  const rec = linked.find((r) => lc(r[matchField]) === lc(row[def.lookup.via]))
  const val = rec ? rec[def.lookup.target] : null
  return <>{val == null || val === '' ? '—' : formatValue(val, 'text')}</>
}

// Resolve `this` references in a nested view's `?` filter against the parent
// [Detail] record. `this.Field` reads that field; a bare `this` (e.g.
// `Ticket == this`) reads the parent's value of the *other* operand's field.
export function resolveThis(cond: string | null, parent: FmdRecord | null): string | null {
  if (!cond || !/\bthis\b/.test(cond)) return cond
  const lc = (s: unknown): string => String(s ?? '').toLowerCase()
  const val = (name: string): unknown => { const k = Object.keys(parent || {}).find((kk) => lc(kk) === lc(name)); return k ? parent[k] : '' }
  const q = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '')}"`
  return cond
    .replace(/\bthis\.([A-Za-z0-9_]+)\b/g, (_, f) => q(val(f)))
    .replace(/([A-Za-z0-9_]+)\s*(==|!=|<=|>=|<|>)\s*this\b/g, (_, lhs, op) => `${lhs} ${op} ${q(val(lhs))}`)
    .replace(/\bthis\s*(==|!=|<=|>=|<|>)\s*([A-Za-z0-9_]+)/g, (_, op, rhs) => `${q(val(rhs))} ${op} ${rhs}`)
}

// Clone a subtree, rewriting every `this` in `?` filters against `record`, so
// nested views under a [Detail] scope to the chosen record.
function bindThis(node: Node, record: FmdRecord): Node {
  const out = { ...node, children: (node.children || []).map((c) => bindThis(c, record)) } as Node & {
    filter?: string | null; name?: string; widgets?: { name: string; source: string | null }[]
  }
  // bracket viz: [Table -> X ? ... this]
  if ('filter' in out && out.filter) out.filter = resolveThis(out.filter, record)
  // card widget: (Table -> X ? ... this) — the binding+filter live in the name
  if (typeof out.name === 'string' && /\bthis\b/.test(out.name)) out.name = resolveThis(out.name, record) || out.name
  // legacy widget row: (A -> src)(B -> src)
  if (Array.isArray(out.widgets)) out.widgets = out.widgets.map((w) =>
    w && typeof w.source === 'string' && /\bthis\b/.test(w.source) ? { ...w, source: resolveThis(w.source, record) } : w)
  return out
}

// One header field's value, honoring computed/lookup/rollup fields.
type DetailValueProps = { record: FmdRecord; def?: Field; fields: Field[] | null; source: string | null }
function DetailValue({ record, def, fields, source }: DetailValueProps): React.ReactNode {
  if (def?.rollup) return <RollupCell parentRow={record} def={def} parentSource={source} type={def.type} />
  if (def?.lookup) return <LookupCell row={record} def={def} fields={fields} />
  if (def?.calc) return <>{formatValue(evalExpr(def.calc, record), def.type)}</>
  const raw = record?.[def?.name as string]
  // [File]/[Files] -> image thumbnails + named links.
  if (def?.type === 'file' || def?.type === 'files') return <FileView value={raw} />
  // A boolean (declared, or a real true/false value) reads better as a status
  // pill than the bare word "true"/"false".
  if (def?.type === 'boolean' || typeof raw === 'boolean') {
    const on = raw === true || raw === 'true' || raw === 't' || raw === 1 || raw === '1'
    return <span className={`bool-pill ${on ? 'on' : 'off'}`}>{on ? 'Yes' : 'No'}</span>
  }
  return <>{formatValue(raw, def?.type)}</>
}

// A single-record view: a record picker, the chosen record's fields, then the
// nested views (their `? ... this` filters bound to that record).
export function VizDetail({ node }: { node: DetailNode }): React.ReactNode {
  const permits = usePermits(node.source)
  const rows = filterRows(useSource(permits.read ? node.source : null), node.filter, useRules())
  const fields = useFields(node.source)
  const [sel, setSel] = useState<string | null>(null) // all hooks before any guard
  if (!permits.read) return <Empty source={node.source} />
  if (!rows) return <Empty source={node.source} />
  if (!rows.length) return <div className="detail"><div className="muted-cell">no records in “{node.source}”</div></div>

  const labelKey = pickField(rows, [/ticket|name|title|order|number|invoice|customer/i], () => true)
    || keysOf(rows).find((k) => k !== '_id')
  const record = rows.find((r) => String(r._id) === String(sel)) || rows[0]
  // A spec column may carry a leading width marker (1–3), e.g. `1Ticket, 2Total`.
  const cols = node.spec
    ? node.spec.split(',').map((s) => {
        const { field, width } = parseFieldMarkers(s)
        return { ...resolveField(fields, rows, field), width }
      }).filter((c) => c.name)
    : keysOf(rows).filter((k) => k !== '_id').map((k) => ({ name: k, key: k, width: null as number | null }))
  // Switch to a precise 3-column grid only when widths are declared; otherwise
  // keep the responsive auto-fit layout.
  const hasWidths = cols.some((c) => c.width)

  return (
    <div className="detail">
      <div className="detail-head">
        <select className="detail-picker" value={record?._id ?? ''} onChange={(e) => setSel(e.target.value)}>
          {rows.map((r, i) => <option key={i} value={r._id}>{String(r[labelKey] ?? `#${r._id}`)}</option>)}
        </select>
      </div>
      <div className={`detail-fields${hasWidths ? ' detail-grid3' : ''}`}>
        {cols.map((c, i) => (
          <div className="detail-field" key={i} style={hasWidths ? { gridColumn: `span ${c.width || 1}` } : undefined}>
            <span className="detail-label">{c.name}</span>
            <span className="detail-value"><DetailValue record={record} def={fieldDef(fields, c.key)} fields={fields} source={node.source} /></span>
          </div>
        ))}
      </div>
      {node.children.length > 0 && (
        <RecordContext.Provider value={{ record, source: node.source }}>
          <div className="detail-children">
            {node.children.map((c, i) => <Renderer key={i} node={bindThis(c, record)} />)}
          </div>
        </RecordContext.Provider>
      )}
    </div>
  )
}

// Master-detail: a table of records whose FIRST column links to that record's
// "case". Clicking it opens a WHOLE new page (CasePage, rendered at the app
// level via CaseNavContext) — not an inline panel — exited via ← Back.
export function VizCases({ node }: { node: CasesNode }): React.ReactNode {
  const permits = usePermits(node.source)
  let rows = filterRows(useSource(permits.read ? node.source : null), node.filter, useRules())
  const fields = useFields(node.source)
  const nav = useCaseNav()
  if (!permits.read || !rows) return <Empty source={node.source} />

  const cols = node.spec
    ? node.spec.split(',').map((s) => resolveField(fields, rows, s)).filter((c) => c.name)
    : keysOf(rows).filter((k) => k !== '_id').map((k) => ({ name: k, key: k, ok: true }))
  const cell = (r: FmdRecord, key: string | null): React.ReactNode =>
    <DetailValue record={r} def={fieldDef(fields, key)} fields={fields} source={node.source} />

  // Per-row action buttons in the LIST: a trailing actions column, one button per
  // [RowButton] per row. They're excluded from the case-page children below so they
  // render only in the list, not again on the opened case.
  const rowButtons = (permits.create || permits.update || permits.delete)
    ? node.children.filter((c): c is RowButtonNode => c.type === 'RowButton')
    : [] // only show row actions to a user with a write permit (else clicks 403 silently)
  const hasRowActions = rowButtons.length > 0

  // An indented [Sort] orders the list (the rest of the children are case content).
  const sort = node.children.find((c) => c.type === 'Sort')
  if (sort && sort.type === 'Sort' && sort.field) {
    const sk = resolveField(fields, rows, sort.field).key
    const dir = sort.dir === 'desc' ? -1 : 1
    rows = [...rows].sort((a, b) => {
      const av = sk ? a[sk] : undefined, bv = sk ? b[sk] : undefined
      if (isNum(av) && isNum(bv)) return (Number(av) - Number(bv)) * dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir
    })
  }

  const openCase = (r: FmdRecord): void => nav.open({
    record: r, source: node.source, children: node.children.filter((c) => c.type !== 'RowButton'),
    title: cols[0] ? String(r[cols[0].key ?? ''] ?? `#${r._id}`) : `#${r._id}`,
  })

  return (
    <div className="fmd-list cases-list">
      <table>
        <thead><tr>{cols.map((c, i) => <th key={i}>{c.name}</th>)}{hasRowActions && <th className="row-actions" />}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {cols.map((c, ci) => (
                <td key={ci} data-label={c.name}>
                  {ci === 0
                    ? <button className="cases-link" onClick={() => openCase(r)}>{cell(r, c.key)}</button>
                    : cell(r, c.key)}
                </td>
              ))}
              {hasRowActions && (
                <td className="row-actions">
                  <RecordContext.Provider value={{ record: r, source: node.source }}>
                    {rowButtons.map((b, bi) => <FormButton key={bi} node={b} compact />)}
                  </RecordContext.Provider>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={(cols.length + (hasRowActions ? 1 : 0)) || 1} className="muted-cell">◌&ensp;no records in “{node.source}” yet</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// A case rendered as its OWN full page. It renders EXACTLY like a [Display]
// (same `.fmd-display` shell, children rendered directly), except the top nav is
// a "← Back" bar instead of the menu — so authoring a case is authoring a page:
// put a [Title], [Main], ((Card))s, [View], [Button]s under the [Cases] and they
// render identically to the same content in a [Display]. Children render with
// `this` bound to the record + a RecordContext so [View]/[[field]]/case-scoped
// buttons resolve against the case's record.
export function CasePage({ caseView, onBack }: { caseView: OpenCaseValue; onBack: () => void }): React.ReactNode {
  const { record, source, children } = caseView
  // An indented [Audit] under the [Cases] shows a history button at the top of the
  // record's page (its full trail); it's excluded from the inline content below.
  const auditNode = children.find((c) => c.type === 'Audit')
  const content = auditNode ? children.filter((c) => c.type !== 'Audit') : children
  return (
    <RecordContext.Provider value={{ record, source }}>
      <div className="fmd-display case-page">
        <div className="case-back-bar">
          <button className="cases-back" onClick={onBack}>← Back</button>
          {auditNode && <AuditButton source={source} record={record._id != null ? String(record._id) : null} title="Record history" />}
        </div>
        {content.map((c, i) => <Renderer key={i} node={bindThis(c, record)} />)}
      </div>
    </RecordContext.Provider>
  )
}

// Read-only render of a declared [Form]'s fields for the current record (the
// enclosing [Cases]/[Detail] case). No inputs, no buttons — just label/value.
export function VizView({ node }: { node: ViewNode }): React.ReactNode {
  const forms = useFormsList()
  const record = useRecord()
  const form = forms.find((f) => f.title.toLowerCase() === node.form.toLowerCase())
  const fields = useFields(form?.source ?? null)
  if (!form) return <div className="detail"><div className="muted-cell">unknown form “{node.form}”</div></div>
  const rec = record || {}
  // Lay the read-only fields out on the SAME 3-column width grid as the form
  // modal, so declared 1/2/3 widths render identically in the panel.
  const hasWidths = form.fields.some((f) => f.width)
  return (
    <div className="detail fmd-view">
      {node.label && <div className="section-label">{node.label}</div>}
      <div className={`detail-fields${hasWidths ? ' detail-grid3' : ''}`}>
        {form.fields.map((f, i) => (
          <div className="detail-field" key={i} style={hasWidths ? { gridColumn: `span ${spanOf(f.width)}` } : undefined}>
            <span className="detail-label">{f.label}</span>
            <span className="detail-value"><DetailValue record={rec} def={fieldDef(fields, fieldName(f.field))} fields={fields} source={form.source} /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function VizChecklist({ node }: { node: VizNode }): React.ReactNode {
  const rows = filterRows(useSource(node.source), node.filter, useRules())
  const fields = useFields(node.source)
  if (!rows) return <Empty source={node.source} />
  const [labelRef, statusRef] = (node.spec || '').split('/').map((s) => s.trim())
  const label = resolveField(fields, rows, labelRef)
  const status = resolveField(fields, rows, statusRef)
  return <Checklist rows={rows} labelKey={label.key} statusKey={status.key} />
}

function parseSliderSpec(spec: string): { label?: string; spent?: string; cap?: string } {
  // "Category Spend / Cap" -> { label: Category, spent: Spend, cap: Cap }
  if (!spec) return {}
  const [left, right] = spec.split('/').map((s) => s.trim())
  const tokens = (left || '').split(/\s+/).filter(Boolean)
  if (tokens.length >= 2) return { label: tokens[0], spent: tokens[1], cap: right }
  return { spent: tokens[0], cap: right }
}

function VizSlider({ node }: { node: VizNode }): React.ReactNode {
  const rows = filterRows(useSource(node.source), node.filter, useRules())
  const fields = useFields(node.source)
  if (!rows) return <Empty source={node.source} />
  const { label, spent, cap } = parseSliderSpec(node.spec)
  const L = resolveField(fields, rows, label)
  const S = resolveField(fields, rows, spent)
  const C = resolveField(fields, rows, cap)
  const labelKey = L.key || pickField(rows, [/category|name|label|title/i], (k, r) => !isNum(r[0][k]))
  return (
    <div className="summary">
      {itemEntries(node).map(({ label: lbl }, i) => {
        const rec = matchRecord(rows, lbl, labelKey)
        const s = Number(rec?.[S.key] || 0)
        const c = Number(rec?.[C.key] || 0) || s || 1
        return (
          <div className="bar-row" key={i}>
            <span className="bar-label">{lbl}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, (s / c) * 100)}%` }} /></span>
            <span className="bar-val">{formatValue(s, fieldType(fields, S.key) || 'currency')}</span>
          </div>
        )
      })}
    </div>
  )
}

// A kanban board grouped by a field: [Board -> WorkOrders] Status.
// Cards are draggable between columns when the user has update permission;
// dropping a card PATCHes its group field to the target column's value.
function VizBoard({ node }: { node: VizNode }): React.ReactNode {
  const rows = filterRows(useSource(node.source), node.filter, useRules())
  const fields = useFields(node.source)
  const refresh = useRefresh()
  const base = useApiBase()
  const permits = usePermits(node.source)
  const [dragOver, setDragOver] = useState<string | null>(null)
  if (!rows) return <Empty source={node.source} />
  const groupDef = node.spec ? resolveField(fields, rows, node.spec) : null
  const groupKey = groupDef?.key || (rows[0] && keysOf(rows).find((k) => k !== '_id'))
  const labelKey = pickField(rows, [/title|name|label|ticket|order|customer/i], () => true)
  const declared = fieldDef(fields, groupKey)?.options?.values
  const distinct = [...new Set(rows.map((r) => String(r[groupKey] ?? '')).filter(Boolean))]
  const columns = declared && declared.length ? declared : distinct
  const canDrag = permits.update
  const handleDrop = (colValue: string, e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (!id || !groupKey) return
    const row = rows.find((r) => String(r._id) === id)
    if (!row || String(row[groupKey] ?? '') === colValue) return
    apiFetch(`${dataBase(base, node.source)}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [groupKey]: colValue }),
    }).then(refresh)
  }
  return (
    <div className="board">
      {columns.map((col, i) => {
        const cards = rows.filter((r) => String(r[groupKey] ?? '') === col)
        return (
          <div
            className={`board-col${dragOver === col ? ' board-col-over' : ''}`}
            key={i}
            onDragOver={canDrag ? (e) => { e.preventDefault(); setDragOver(col) } : undefined}
            onDragLeave={canDrag ? () => setDragOver(null) : undefined}
            onDrop={canDrag ? (e) => handleDrop(col, e) : undefined}
          >
            <div className="board-col-head">{col}<span className="board-count">{cards.length}</span></div>
            {cards.map((r, ri) => (
              <div
                className="board-card"
                key={ri}
                draggable={canDrag && r._id != null}
                onDragStart={canDrag && r._id != null ? (e) => {
                  e.dataTransfer.setData('text/plain', String(r._id))
                  e.dataTransfer.effectAllowed = 'move'
                } : undefined}
              >
                {formatValue(r[labelKey], fieldType(fields, labelKey))}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// A month calendar placing records on a date field: [Calendar -> Appointments] Date.
function VizCalendar({ node }: { node: VizNode }): React.ReactNode {
  const rows = filterRows(useSource(node.source), node.filter, useRules())
  const fields = useFields(node.source)
  if (!rows) return <Empty source={node.source} />
  const dateKey = node.spec ? resolveField(fields, rows, node.spec).key : null
  const labelKey = pickField(rows, [/title|name|label|customer|activity|reason|service/i], () => true)
  const now = new Date()
  const year = now.getFullYear(), month = now.getMonth()
  const startDay = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const byDay: Record<string, FmdRecord[]> = {}
  rows.forEach((r) => { const d = String(r[dateKey] ?? '').slice(0, 10); if (d) (byDay[d] = byDay[d] || []).push(r) })
  const cells = [...Array(startDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const key = (day: number): string => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return (
    <div className="calendar">
      <div className="cal-title">{now.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</div>
      <div className="cal-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div className="cal-dow" key={d}>{d}</div>)}
        {cells.map((day, i) => (
          <div className={`cal-cell${day ? '' : ' empty'}`} key={i}>
            {day && <div className="cal-day">{day}</div>}
            {day && (byDay[key(day)] || []).slice(0, 3).map((r, ri) => (
              <div className="cal-event" key={ri}>{formatValue(r[labelKey], fieldType(fields, labelKey))}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

