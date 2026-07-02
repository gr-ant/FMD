// Tag/line node parsing: regexes, comment handling, and parseNode().
// -------------------------------------------------------------

import type { Node, RoleVisibility, VizNode, ApiNode } from '../types'
import { parseFields } from './fields'

export const TAG_RE = /^\[([^\]]+)\]\s*(.*)$/
export const WIDGET_RE = /\(([^)]*)\)/g
export const WIDGET_LINE_RE = /^\(([^)]+)\)$/

export const VIZ_TAGS = new Set(['table', 'counter', 'checklist', 'slider', 'board', 'calendar', 'chart'])
export const ITEM_TAGS: Record<string, string> = { count: 'count', counts: 'count', slide: 'slide', slides: 'slide' }

// The record-write verbs an [Action] is built from. Each is a step that hits the
// CRUD API: create inserts, update/delete act on rows matching a `?` filter.
export const STEP_VERBS = new Set(['create', 'update', 'delete'])

// Aggregate functions shared by [Count] KPI items, [Rollup], and [Foot] footers.
const AGG_FNS = new Set(['sum', 'count', 'avg', 'min', 'max'])

// A viz tag may carry CRUD flags as a prefix: cTable (create), uTable (update),
// dTable (delete), rTable/Table (read), in any combination -> udTable, cudTable.
export const VIZ_RE = new RegExp('^([crud]*)(' + [...VIZ_TAGS].join('|') + ')$')

// A `( )` widget whose name is a viz binding — `(Table -> Source ? filter)`,
// `(cudTable -> X)`, `(Board -> Y)` — renders the SAME as the bracket form
// `[Table -> Source]`, so ( ) and [ ] are interchangeable for vizzes. Returns a
// VizNode or null (null = a plain card / legacy keyword widget).
export function widgetViz(name: string): VizNode | null {
  const i = String(name).indexOf('->')
  if (i === -1) return null
  const m = name.slice(0, i).trim().toLowerCase().match(VIZ_RE)
  if (!m) return null
  let rest = name.slice(i + 2).trim()
  let filter: string | null = null
  const qi = rest.indexOf('?')
  if (qi !== -1) { filter = rest.slice(qi + 1).trim() || null; rest = rest.slice(0, qi).trim() }
  return { type: 'Viz', viz: m[2], crud: m[1], source: rest ? rest.toLowerCase() : null, filter, spec: '', children: [] }
}

// Index where a `#` comment begins on a line, or -1. A `#` is a comment when it
// is at the start of (the trimmed) line or preceded by whitespace, and not
// inside double quotes (so `[Field "Issue #5"]` is safe).
export function commentIndex(line: string): number {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === '#' && !inQuote && (i === 0 || /\s/.test(line[i - 1]))) {
      // A `#` immediately followed by hex digits is a color literal (e.g.
      // `Primary: #7c5cff` in a [Style] block), not a comment — keep scanning.
      if (!/^#[0-9a-fA-F]{3,8}\b/.test(line.slice(i))) return i
    }
  }
  return -1
}
export function stripComment(line: string): string {
  const i = commentIndex(line)
  return i === -1 ? line : line.slice(0, i)
}

// Tabs count as two spaces; everything else is counted literally.
export function leadingIndent(line: string): number {
  const ws = line.match(/^[ \t]*/)[0]
  let n = 0
  for (const ch of ws) n += ch === '\t' ? 2 : 1
  return n
}

// Split a bound source that may carry a `? filter` (e.g. `Requests ? Status ==
// "Open"`) into the lowercased source name and the raw filter condition.
export function splitSourceFilter(innerSource: string | null): { source: string | null; filter: string | null } {
  let src = innerSource
  let filter: string | null = null
  if (src && src.includes('?')) {
    const i = src.indexOf('?')
    filter = src.slice(i + 1).trim() || null
    src = src.slice(0, i).trim()
  }
  return { source: src ? src.toLowerCase() : null, filter }
}

// Split a "text -> source" binding. Source may be an entity name or a URL.
export function splitBinding(str: string): { text: string; source: string | null } {
  const i = str.indexOf('->')
  if (i === -1) return { text: str.trim(), source: null }
  return { text: str.slice(0, i).trim(), source: str.slice(i + 2).trim() || null }
}

// Split a comma-separated list at the top level, leaving commas inside double
// quotes alone (so `Note = "Done, paid"` stays one assignment).
export function splitTopComma(str: string): string[] {
  const out: string[] = []
  let buf = '', inQuote = false
  for (const ch of String(str)) {
    if (ch === '"') inQuote = !inQuote
    if (ch === ',' && !inQuote) { out.push(buf); buf = '' } else buf += ch
  }
  if (buf.trim()) out.push(buf)
  return out
}

// Parse an action step's "Field = expr, Field = expr" body into assignments.
// The right-hand side is left as a raw string (evaluated at run time).
function parseAssignments(content: string): { field: string; expr: string }[] {
  return splitTopComma(content)
    .map((part) => {
      const i = part.indexOf('=')
      if (i === -1) return null
      return { field: part.slice(0, i).trim(), expr: part.slice(i + 1).trim() }
    })
    .filter((a) => a && a.field)
}

// A form-field reference may carry leading markers, in any order:
//   `!` = required, a lowercase `r` (before the Capitalized name) = read-only,
//   a digit `1`–`3` = layout width (3 = full width, the default when absent).
// e.g. `!Name`, `rDescription`, `!rTotal`, `2Email`, `!1Phone`, `3rNotes`.
// Returns the bare field name plus the flags.
export function parseFieldMarkers(raw: string): { field: string; required: boolean; readonly: boolean; width: number | null } {
  let s = String(raw).trim()
  let required = false
  let readonly = false
  let width: number | null = null
  let changed = true
  while (changed) {
    changed = false
    if (s.startsWith('!')) { required = true; s = s.slice(1).trim(); changed = true }
    else if (/^r[A-Z]/.test(s)) { readonly = true; s = s.slice(1).trim(); changed = true }
    // a width digit is only a marker when followed by the name / another marker,
    // so a field literally named "2024" isn't mistaken for a width.
    else if (/^[1-3](?=[A-Za-z!])/.test(s)) { width = Number(s[0]); s = s.slice(1).trim(); changed = true }
  }
  return { field: s, required, readonly, width }
}

// Split a [Fields] list at top-level commas, leaving commas inside a `(img, pdf)`
// accept list (or "quotes") alone.
function splitFieldsTop(str: string): string[] {
  const out: string[] = []
  let buf = '', depth = 0, inQ = false
  for (const ch of String(str)) {
    if (ch === '"') inQ = !inQ
    else if (!inQ && ch === '(') depth++
    else if (!inQ && ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && !inQ && depth === 0) { out.push(buf); buf = '' } else buf += ch
  }
  if (buf.trim()) out.push(buf)
  return out
}

// Pull a trailing `(img, pdf)` accept list off a field token (for [File]/[Files]
// fields): `fileReceipt (pdf, img)` -> base `fileReceipt`, accept `['pdf','img']`.
function extractAccept(tok: string): { base: string; accept: string[] | null } {
  const m = tok.match(/\(([^)]*)\)\s*$/)
  if (!m) return { base: tok.trim(), accept: null }
  const accept = m[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return { base: tok.slice(0, m.index).trim(), accept: accept.length ? accept : null }
}

// Parse a `{Role, !Role}` role-visibility block: bare names are an allow-list,
// `!name` excludes. If only exclusions are present, everyone else is allowed.
export function parseRoleVisibility(inner: string): RoleVisibility {
  const allow: string[] = []
  const deny: string[] = []
  for (const tok of String(inner).split(',').map((t) => t.trim()).filter(Boolean)) {
    if (tok.startsWith('!')) deny.push(tok.slice(1).trim().toLowerCase())
    else allow.push(tok.trim().toLowerCase())
  }
  return { allow, deny }
}

// A `{ ... }` role-visibility block may be embedded in ANY tag. Extract it (from
// anywhere on the line), attach it as `node.roles`, and parse the rest normally.
export function parseNode(line: string): Node {
  const rm = line.match(/\{([^}]*)\}/)
  let roles: RoleVisibility | null = null
  let rest = line
  if (rm) {
    roles = parseRoleVisibility(rm[1])
    rest = (line.slice(0, rm.index) + line.slice((rm.index ?? 0) + rm[0].length)).replace(/\s{2,}/g, ' ').trim()
    // A permission grant line under a [Permission] block: `{Role, Role} verb, verb`
    // (the braces lead the line, and what follows isn't a tag or widget).
    if (rm.index === 0 && rest && !rest.startsWith('[') && !rest.startsWith('(')) {
      return { type: 'Grant', roles, verbs: rest.split(',').map((v) => v.trim()).filter(Boolean), children: [] }
    }
  }
  const node = parseNodeInner(rest)
  if (roles) node.roles = roles
  return node
}

function parseNodeInner(line: string): Node {
  // A line that opens with `[[` is a field-interpolation text line ([[Field]]),
  // not a [Tag]. Keep it as Text so the renderer can substitute the value.
  if (line.startsWith('[[')) return { type: 'Text', value: line, children: [] }
  const tag = line.match(TAG_RE)
  if (tag) {
    // Bindings can live inside the brackets ([Table -> Schedule]) or after the
    // content ([List X] cols -> src). Parse both.
    const innerBind = splitBinding(tag[1].trim())
    const inner = innerBind.text
    const innerSource = innerBind.source
    const { text: content, source: contentSource } = splitBinding(tag[2].trim())

    const words = inner.split(/\s+/)
    const first = words[0].toLowerCase()
    const lowerInner = inner.toLowerCase()

    if (first === 'list') {
      const name = words.slice(1).join(' ') || 'List'
      // A [List] is relational: it becomes a real SQL table (typed columns).
      // Source binds with `-> x` either inside the brackets or after the columns.
      return { type: 'List', name, columns: parseFields(content), kind: 'list', source: innerSource || contentSource || name.toLowerCase(), children: [] }
    }
    if (first === 'store') {
      const name = words.slice(1).join(' ') || 'Store'
      // A [Store] is schemaless: it becomes a JSONB document collection (NoSQL).
      return { type: 'Store', name, columns: parseFields(content), kind: 'store', source: innerSource || contentSource || name.toLowerCase(), children: [] }
    }
    // An external API data source: [API] Products, with indented [URL]/[Auth]/
    // [Path]/[Map] children (themselves generic Block nodes). url/auth/path/fields
    // are filled in from those children once the tree is built (see finalizeApi in
    // tree.js / extractApi below). No secret key ever lives in the document.
    if (first === 'api') {
      return { type: 'Api', name: content.trim() || 'API', url: null, auth: null, path: null, fields: [], want: null, children: [] }
    }
    if (lowerInner === 'title') {
      return { type: 'Title', value: content, children: [] }
    }
    // An explicit text line: [Text] some words (supports [[Field]] + **bold**).
    if (first === 'text') {
      return { type: 'Text', value: content, children: [] }
    }
    // Theming for the rendered app: indented `Key: Value` lines (Size, Primary,
    // Background, …). Not rendered; collected by collectStyle.
    if (lowerInner === 'style') {
      return { type: 'Style', children: [] }
    }
    if (lowerInner === 'app name' || lowerInner === 'appname') {
      return { type: 'AppName', value: content, children: [] }
    }
    // A named, reusable rule: [Rule] IsApproved (Status == True). Reference it by
    // name anywhere a condition is accepted (a `?` filter or a show-if).
    if (first === 'rule') {
      const cm = content.match(/\(([^)]*)\)/)
      const name = (content.includes('(') ? content.slice(0, content.indexOf('(')) : content).trim()
      return { type: 'Rule', name, expr: cm ? cm[1].trim() : null, children: [] }
    }
    // Roles for access control: [Role] Admin  or  [Roles] Admin, Staff, Viewer.
    if (first === 'role' || first === 'roles') {
      const names = content.split(',').map((s) => s.trim()).filter(Boolean)
      return { type: 'Role', names, children: [] }
    }
    // A permission block under a [List]/[Store]; its indented (Role) verb lines
    // grant access:  [Permission]  /  (Admin) Read, Write, Modify.
    if (first === 'permission' || first === 'permissions') {
      return { type: 'Permission', children: [] }
    }
    // Navigation between [Display] pages. `[Top Menu Bar]`/`[Menu]`/`[Nav]` render
    // a horizontal tab bar; `[SideMenu]`/`[Side Menu]`/`[Sidebar]` render a vertical
    // rail down the left of the page. Both take a comma-separated list of pages.
    // A side menu may carry a flag: `[SideMenu static]` (always shown, the default)
    // or `[SideMenu hamburger]` (collapsed behind a ☰ button that pops it out).
    const isSide = first === 'sidemenu' || first === 'sidebar' || lowerInner.startsWith('side menu')
    if (isSide || lowerInner === 'top menu bar' || first === 'topmenu' || first === 'menu' || first === 'nav') {
      const items = content.split(',').map((s) => s.trim()).filter(Boolean)
      const flags = lowerInner.split(/\s+/)
      const collapsible = isSide && ['hamburger', 'collapse', 'collapsible', 'popout', 'pop'].some((f) => flags.includes(f))
      return { type: 'Menu', items, side: isSide, ...(collapsible ? { collapsible: true } : {}), children: [] }
    }
    // A visualization bound to a source: [Table -> Schedule], [Counter -> ...] etc.
    // A leading CRUD prefix (cudTable) makes the table interactive. A trailing
    // "? condition" filters the rows: [Checklist -> WorkOrders ? Done == False].
    const vizMatch = first.match(VIZ_RE)
    if (vizMatch) {
      const b = splitSourceFilter(innerSource)
      return { type: 'Viz', viz: vizMatch[2], crud: vizMatch[1], source: b.source, filter: b.filter, spec: content, children: [] }
    }
    // A generated item. Singular = one label; plural ([Counts]/[Slides]) = many.
    // An item may be an aggregate: [Count] Open = count(WorkOrders ? Unpaid).
    if (ITEM_TAGS[first]) {
      let items: { label: string; expr: string | null }[]
      if (content.includes('=')) {
        const i = content.indexOf('=')
        items = [{ label: content.slice(0, i).trim(), expr: content.slice(i + 1).trim() }]
      } else {
        items = content.split(',').map((s) => s.trim()).filter(Boolean).map((l) => ({ label: l, expr: null as string | null }))
      }
      return { type: 'Item', itemKind: ITEM_TAGS[first], items, children: [] }
    }
    // A computed field: [Calc] Line Total = Qty * UnitPrice (per-record arithmetic).
    if (first === 'calc') {
      const i = content.indexOf('=')
      if (i === -1) return { type: 'Calc', field: content.trim(), expr: null, children: [] }
      return { type: 'Calc', field: content.slice(0, i).trim(), expr: content.slice(i + 1).trim(), children: [] }
    }
    // A lookup field: pull a value across a link. [Lookup] CustomerPhone =
    // Customer.Phone — `Customer` is a link field on THIS entity; `Phone` is a
    // field on the entity it links to. Reference the name in any view.
    if (first === 'lookup') {
      const i = content.indexOf('=')
      const name = (i === -1 ? content : content.slice(0, i)).trim()
      const rhs = i === -1 ? '' : content.slice(i + 1).trim()
      const dot = rhs.indexOf('.')
      const via = (dot === -1 ? rhs : rhs.slice(0, dot)).trim()
      const target = dot === -1 ? null : rhs.slice(dot + 1).trim() || null
      return { type: 'Lookup', field: name, via, target, children: [] }
    }
    // A parent-child aggregate: [Rollup] Total = sum(WorkOrderItems LineTotal ? cond).
    if (first === 'rollup') {
      const i = content.indexOf('=')
      if (i === -1) return { type: 'Rollup', field: content.trim(), expr: null, children: [] }
      return { type: 'Rollup', field: content.slice(0, i).trim(), expr: content.slice(i + 1).trim(), children: [] }
    }
    // Table sub-directives, indented under a [Table]: a footer of column
    // aggregates, a sort order, and group-by sections (with per-group subtotals
    // when a [Foot] is also present).
    //   [Foot] sum Amount, count, avg Amount
    //   [Sort] Date desc
    //   [Group] Status
    if (first === 'foot' || first === 'footer') {
      const specs = splitTopComma(content)
        .map((tok) => {
          const parts = tok.trim().split(/\s+/).filter(Boolean)
          const fn = (parts[0] || '').toLowerCase()
          if (!AGG_FNS.has(fn)) return null
          return { fn, field: parts.slice(1).join(' ') || null }
        })
        .filter(Boolean)
      return { type: 'Foot', specs, children: [] }
    }
    if (first === 'sort') {
      const parts = content.trim().split(/\s+/).filter(Boolean)
      let dir = 'asc'
      if (parts.length && /^(asc|desc)$/i.test(parts[parts.length - 1])) dir = parts.pop().toLowerCase()
      return { type: 'Sort', field: parts.join(' '), dir, children: [] }
    }
    if (first === 'group') {
      return { type: 'Group', field: content.trim(), children: [] }
    }
    // A [Chart] sub-directive selecting the chart kind: [Kind] bar|line|pie|donut.
    if (first === 'kind') {
      return { type: 'Kind', kind: content.trim().toLowerCase() || 'bar', children: [] }
    }
    // Viewer-facing [Table] controls: [Search] (optional placeholder text) renders
    // a text box that live-filters rows across all columns; [Filter] Field renders
    // a distinct-value dropdown. Both narrow the rows client-side (before sort/foot).
    if (first === 'search') {
      return { type: 'Search', placeholder: content.trim(), children: [] }
    }
    if (first === 'filter') {
      return { type: 'Filter', field: content.trim(), children: [] }
    }
    // A button that opens a form: [Button -> Event] New Event.
    if (first === 'button') {
      return { type: 'Button', label: content, target: innerSource ? innerSource.toLowerCase() : null, children: [] }
    }
    // A per-row action button inside a [Table]/[Cases]: [RowButton -> Action] Label
    // (alias [RowAction]). Parses exactly like [Button] — `-> Target` names an
    // [Action], the trailing text is the label — but the renderer draws it once per
    // row with THAT row bound as `this`.
    if (first === 'rowbutton' || first === 'rowaction') {
      return { type: 'RowButton', label: content, target: innerSource ? innerSource.toLowerCase() : null, children: [] }
    }
    // A button that opens the user-management window: [User Management] Label.
    if (lowerInner === 'user management' || lowerInner === 'usermanagement') {
      return { type: 'UserManagement', label: content || 'User Management', children: [] }
    }
    // A form (a modal) that creates a record in its source: [Form -> Schedule] Title.
    if (first === 'form') {
      return { type: 'Form', title: content, source: innerSource ? innerSource.toLowerCase() : null, children: [] }
    }
    // Form fields. [Field "Label"] dataField  (quotes = label) ; [Fields] a, b.
    // Field-name markers: "!" = required, leading "r" = read-only (rDescription).
    // A "(condition)" after the label is a show-if rule; a "-> value" binding
    // auto-fills the field: [Field -> CurrentUser] By, [Field -> "Accepted"] Status.
    //   [Field "Discount" (ItemType == Discount)] !DiscountAmount
    if (first === 'field') {
      const qm = inner.match(/"([^"]*)"/)
      const cm = inner.match(/\(([^)]*)\)/)
      const showIf = cm && cm[1].trim() ? cm[1].trim() : null
      const { base, accept } = extractAccept(content) // trailing (img, pdf) for a [File] field
      const { field, required, readonly, width } = parseFieldMarkers(base)
      const autofill = innerSource ? innerSource.trim() : null
      return { type: 'FormField', entries: [{ field, label: qm ? qm[1] : field, required, showIf, readonly, autofill, width, accept }], children: [] }
    }
    if (first === 'fields') {
      const entries = splitFieldsTop(content).map((s) => s.trim()).filter(Boolean).map((tok) => {
        const { base, accept } = extractAccept(tok)
        const { field, required, readonly, width } = parseFieldMarkers(base)
        return { field, label: field, required, showIf: null as string | null, readonly, autofill: null as string | null, width, accept }
      })
      return { type: 'FormField', entries, children: [] }
    }
    // A single-record view: [Detail -> WorkOrders] Ticket, Customer, Total.
    // Shows one chosen record's fields, with nested views beneath it. Inside a
    // nested view's `?` filter, `this` refers to the chosen record (see the
    // renderer): [Table -> WorkOrderItems ? Ticket == this].
    if (first === 'detail') {
      const b = splitSourceFilter(innerSource)
      return { type: 'Detail', source: b.source, filter: b.filter, spec: content, children: [] }
    }
    // A master-detail list: [Cases -> Source ? cond] Col1, Col2. Renders a table;
    // the first column links to the record's "case" — the indented children, with
    // `this` bound to that record. Children attach generically (like [Detail]).
    if (first === 'cases') {
      const b = splitSourceFilter(innerSource)
      return { type: 'Cases', source: b.source, filter: b.filter, spec: content, children: [] }
    }
    // Read-only render of a declared [Form] for the current record (no buttons):
    // [View -> FormName] Heading. The form name is after "->"; trailing text is a
    // heading.
    if (first === 'view') {
      return { type: 'View', form: (innerSource || content).trim(), label: innerSource ? content.trim() : '', children: [] }
    }
    // A named, reusable action: a sequence of record-write steps indented under
    // it. Run by a [Button -> ActionName]. [Action] Approve All Vendors.
    if (first === 'action') {
      return { type: 'Action', name: content.trim(), children: [] }
    }
    // An automation: [Trigger -> Source ? condition] Label. The indented steps
    // run for every record in Source matching condition (a [Update]/[Delete]
    // with no source acts on the matched record). Source + `?` split like a viz.
    if (first === 'trigger') {
      const b = splitSourceFilter(innerSource)
      return { type: 'Trigger', source: b.source, condition: b.filter, label: content.trim(), children: [] }
    }
    // An action step that writes records: [Create -> Src] f = v, [Update -> Src
    // ? cond] f = v, [Delete -> Src ? cond]. Source + `?` filter parse exactly
    // like a viz binding; the content is the assignment list (none for delete).
    if (STEP_VERBS.has(first)) {
      const b = splitSourceFilter(innerSource)
      return { type: 'Step', op: first, source: b.source, filter: b.filter, assigns: first === 'delete' ? [] : parseAssignments(content), children: [] }
    }
    // Generic block: a container if children get indented under it, else a
    // labeled leaf element.
    return { type: 'Block', tag: inner, value: content, source: innerSource || contentSource, children: [] }
  }

  // An option-set definition inside [Data], configuring a drop/link field of the
  // entity above it:
  //   (Category) Venue, Catering, Flowers   -> static dropdown options
  //   (Vendors) -> Vendors Name             -> link options from another entity
  const opt = line.match(/^\(([^)]+)\)\s+(.+)$/)
  if (opt) {
    const name = opt[1].trim()
    let rest = opt[2].trim()
    // An optional "? condition" filters the options (rules engine, see rules.js).
    let where = null
    const qi = rest.indexOf('?')
    if (qi !== -1) { where = rest.slice(qi + 1).trim() || null; rest = rest.slice(0, qi).trim() }
    if (rest.startsWith('->')) {
      const target = rest.slice(2).trim() // "Source Field" -- source may be multi-word
      const parts = target.split(/\s+/).filter(Boolean)
      return {
        type: 'Options', name, children: [], where,
        // raw is kept so collectSchema can split source/field against known entities
        link: { raw: target, source: (parts[0] || '').toLowerCase(), field: parts.slice(1).join(' ') || null },
        values: null,
      }
    }
    return {
      type: 'Options', name, children: [], where,
      link: null, values: rest.split(',').map((s) => s.trim()).filter(Boolean),
    }
  }

  // Legacy widget row: one or more (Name -> source) groups, nothing else on the line.
  if (line.replace(WIDGET_RE, '').trim() === '') {
    const widgets = [...line.matchAll(WIDGET_RE)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .map((w) => splitBinding(w))
      .map(({ text, source }) => ({ name: text, source }))
    if (widgets.length) return { type: 'WidgetRow', widgets, children: [] }
  }

  return { type: 'Text', value: line, children: [] }
}
