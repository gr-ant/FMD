// Tag/line node parsing: regexes, comment handling, and parseNode().
// -------------------------------------------------------------

import { parseFields } from './fields.js'

export const TAG_RE = /^\[([^\]]+)\]\s*(.*)$/
export const WIDGET_RE = /\(([^)]*)\)/g
export const WIDGET_LINE_RE = /^\(([^)]+)\)$/

export const VIZ_TAGS = new Set(['table', 'counter', 'checklist', 'slider', 'board', 'calendar'])
export const ITEM_TAGS = { count: 'count', counts: 'count', slide: 'slide', slides: 'slide' }

// A viz tag may carry CRUD flags as a prefix: cTable (create), uTable (update),
// dTable (delete), rTable/Table (read), in any combination -> udTable, cudTable.
export const VIZ_RE = new RegExp('^([crud]*)(' + [...VIZ_TAGS].join('|') + ')$')

// Index where a `#` comment begins on a line, or -1. A `#` is a comment when it
// is at the start of (the trimmed) line or preceded by whitespace, and not
// inside double quotes (so `[Field "Issue #5"]` is safe).
export function commentIndex(line) {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === '#' && !inQuote && (i === 0 || /\s/.test(line[i - 1]))) return i
  }
  return -1
}
export function stripComment(line) {
  const i = commentIndex(line)
  return i === -1 ? line : line.slice(0, i)
}

// Tabs count as two spaces; everything else is counted literally.
export function leadingIndent(line) {
  const ws = line.match(/^[ \t]*/)[0]
  let n = 0
  for (const ch of ws) n += ch === '\t' ? 2 : 1
  return n
}

// Split a "text -> source" binding. Source may be an entity name or a URL.
export function splitBinding(str) {
  const i = str.indexOf('->')
  if (i === -1) return { text: str.trim(), source: null }
  return { text: str.slice(0, i).trim(), source: str.slice(i + 2).trim() || null }
}

export function parseNode(line) {
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
      return { type: 'List', name, columns: parseFields(content), kind: 'list', source: contentSource || name.toLowerCase(), children: [] }
    }
    if (first === 'store') {
      const name = words.slice(1).join(' ') || 'Store'
      // A [Store] is schemaless: it becomes a JSONB document collection (NoSQL).
      return { type: 'Store', name, columns: parseFields(content), kind: 'store', source: contentSource || name.toLowerCase(), children: [] }
    }
    if (lowerInner === 'title') {
      return { type: 'Title', value: content, children: [] }
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
    if (lowerInner === 'top menu bar' || first === 'topmenu' || first === 'menu' || first === 'nav') {
      const items = content.split(',').map((s) => s.trim()).filter(Boolean)
      return { type: 'Menu', items, children: [] }
    }
    // A visualization bound to a source: [Table -> Schedule], [Counter -> ...] etc.
    // A leading CRUD prefix (cudTable) makes the table interactive. A trailing
    // "? condition" filters the rows: [Checklist -> WorkOrders ? Done == False].
    const vizMatch = first.match(VIZ_RE)
    if (vizMatch) {
      let src = innerSource
      let filter = null
      if (src && src.includes('?')) {
        const i = src.indexOf('?')
        filter = src.slice(i + 1).trim() || null
        src = src.slice(0, i).trim()
      }
      return {
        type: 'Viz',
        viz: vizMatch[2],
        crud: vizMatch[1],
        source: src ? src.toLowerCase() : null,
        filter,
        spec: content,
        children: [],
      }
    }
    // A generated item. Singular = one label; plural ([Counts]/[Slides]) = many.
    // An item may be an aggregate: [Count] Open = count(WorkOrders ? Unpaid).
    if (ITEM_TAGS[first]) {
      let items
      if (content.includes('=')) {
        const i = content.indexOf('=')
        items = [{ label: content.slice(0, i).trim(), expr: content.slice(i + 1).trim() }]
      } else {
        items = content.split(',').map((s) => s.trim()).filter(Boolean).map((l) => ({ label: l, expr: null }))
      }
      return { type: 'Item', itemKind: ITEM_TAGS[first], items, children: [] }
    }
    // A computed field: [Calc] Line Total = Qty * UnitPrice (per-record arithmetic).
    if (first === 'calc') {
      const i = content.indexOf('=')
      if (i === -1) return { type: 'Calc', field: content.trim(), expr: null, children: [] }
      return { type: 'Calc', field: content.slice(0, i).trim(), expr: content.slice(i + 1).trim(), children: [] }
    }
    // A parent-child aggregate: [Rollup] Total = sum(WorkOrderItems LineTotal ? cond).
    if (first === 'rollup') {
      const i = content.indexOf('=')
      if (i === -1) return { type: 'Rollup', field: content.trim(), expr: null, children: [] }
      return { type: 'Rollup', field: content.slice(0, i).trim(), expr: content.slice(i + 1).trim(), children: [] }
    }
    // A button that opens a form: [Button -> Event] New Event.
    if (first === 'button') {
      return { type: 'Button', label: content, target: innerSource ? innerSource.toLowerCase() : null, children: [] }
    }
    // A form (a modal) that creates a record in its source: [Form -> Schedule] Title.
    if (first === 'form') {
      return { type: 'Form', title: content, source: innerSource ? innerSource.toLowerCase() : null, children: [] }
    }
    // Form fields. [Field "Label"] dataField  (quotes = label) ; [Fields] a, b.
    // A leading "!" on the field name marks it REQUIRED. A "(condition)" after
    // the label is a show-if rule evaluated against the form's current values:
    //   [Field "Discount" (ItemType == Discount)] !DiscountAmount
    if (first === 'field') {
      const qm = inner.match(/"([^"]*)"/)
      const cm = inner.match(/\(([^)]*)\)/)
      const showIf = cm && cm[1].trim() ? cm[1].trim() : null
      let raw = content.trim()
      const required = raw.startsWith('!')
      if (required) raw = raw.slice(1).trim()
      return { type: 'FormField', entries: [{ field: raw, label: qm ? qm[1] : raw, required, showIf }], children: [] }
    }
    if (first === 'fields') {
      const entries = content.split(',').map((s) => s.trim()).filter(Boolean).map((tok) => {
        const required = tok.startsWith('!')
        const f = required ? tok.slice(1).trim() : tok
        return { field: f, label: f, required, showIf: null }
      })
      return { type: 'FormField', entries, children: [] }
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
