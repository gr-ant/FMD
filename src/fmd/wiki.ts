// App-wiki generator for FMD.
// Walks the parsed AST + collected schema and produces a structured, human-
// readable description of the whole app. Purely read-only — never touches DSL
// semantics or runtime data.
// -----------------------------------------------------------------------

import type { Node, RootNode, BlockNode, ActionStep, VizNode, ItemNode, FilterNode, MenuNode } from './types'
import type { Schema } from './types'

// Bracket tags that are pure structural containers (no user-facing prose of their
// own); the guide recurses into them rather than describing them as content.
const STRUCTURAL_TAGS = new Set(['main', 'display', 'title', 'section', 'row', 'col', 'group', 'data', 'style'])
import { collectForms, collectActions, collectTriggers, collectRoles } from './parse/schema'
import { fieldName } from '../parser'

// ---- Output types -------------------------------------------------------

export interface WikiFieldRow {
  name: string
  label: string | null     // declared "quoted" display label, if any
  type: string
  computed: 'Calc' | 'Rollup' | 'Lookup' | null
  formula: string | null
  options: string | null   // for drop/link/msel
  required: boolean
}

export interface WikiFormField {
  label: string
  field: string
  required: boolean
  readonly: boolean
  autofill: string | null
  showIf: string | null
}

export interface WikiLineItems {
  source: string | null
  cols: string[]
}

export interface WikiTotal {
  name: string
  expr: string
}

export interface WikiEntity {
  name: string
  source: string
  kind: 'list' | 'store' | 'api'
  fields: WikiFieldRow[]
  gaps: string[]
}

export interface WikiViz {
  viz: string           // 'table', 'counter', 'checklist', etc.
  source: string | null
  filter: string | null
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export interface WikiButton {
  label: string
  target: string | null  // action or form name
}

export interface WikiPage {
  name: string
  // Natural-language, task-oriented instructions for using this page — the
  // end-user guide ("To add a work order, click New Work Order and fill out …").
  // Each string is one imperative sentence; **bold** marks a clickable label.
  guide: string[]
  vizzes: WikiViz[]
  buttons: WikiButton[]
  gaps: string[]
}

export interface WikiForm {
  title: string
  source: string | null
  size: string
  fields: WikiFormField[]
  lineItems: WikiLineItems | null
  totals: WikiTotal[]
  gaps: string[]
}

export interface WikiStep {
  op: string
  source: string | null
  filter: string | null
  // Set only for an outbound [Post]/[Call] step: the named connection + request path.
  connection?: string | null
  path?: string | null
  assigns: { field: string; expr: string }[]
}

// Normalize either step kind (record-write [Step] or outbound [PostStep]) into a
// flat WikiStep the renderer can display uniformly.
function toWikiStep(s: ActionStep): WikiStep {
  if (s.type === 'PostStep') {
    return { op: s.op, source: null, filter: null, connection: s.connection, path: s.path, assigns: s.assigns }
  }
  return { op: s.op, source: s.source, filter: s.filter, assigns: s.assigns }
}

export interface WikiAction {
  name: string
  steps: WikiStep[]
  narrative: string   // plain-English "what happens" when the action runs
  gaps: string[]
}

export interface WikiTrigger {
  label: string
  source: string
  condition: string | null
  steps: WikiStep[]
  narrative: string   // plain-English "when X happens, the app …"
}

export interface WikiPermEntry {
  entity: string
  entityName: string
  grants: { role: string; verbs: string[] }[]
}

export interface AppWiki {
  appName: string
  pages: WikiPage[]
  entities: WikiEntity[]
  forms: WikiForm[]
  actions: WikiAction[]
  triggers: WikiTrigger[]
  // How to get around the app (the top/side menu), in plain English.
  navigation: string[]
  roles: string[]
  permMatrix: WikiPermEntry[]
  // Plain-English "who can do what" — one sentence per role. **bold** marks a role.
  permSummary: string[]
  topGaps: string[]  // top-level documentation gaps (no pages, no data, etc.)
}

// ---- Helpers ------------------------------------------------------------

/** Walk a node tree depth-first; call visitor for each node (including the root). */
function walk(node: Node, visitor: (n: Node) => void): void {
  visitor(node)
  for (const child of node.children) walk(child, visitor)
}

/** Capitalise + humanise a camelCase or TitleCase field name. */
function humanise(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase -> camel Case
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

/** Describe a field type in plain prose. */
function typeLabel(type: string): string {
  const MAP: Record<string, string> = {
    text: 'Text', number: 'Number', currency: 'Currency', boolean: 'Yes/No',
    date: 'Date', drop: 'Dropdown', link: 'Link', msel: 'Multi-select',
    file: 'File upload', files: 'File uploads', memo: 'Long text',
  }
  return MAP[type] || type
}

/** Describe CRUD flags as plain English. */
function crudLabel(crud: string): string {
  const ops: string[] = []
  if (crud.includes('c')) ops.push('create')
  if (crud.includes('u')) ops.push('edit')
  if (crud.includes('d')) ops.push('delete')
  return ops.length ? `${ops.join('/')} enabled` : 'read-only'
}

// ---- Page traversal -----------------------------------------------------

/** Collect all Viz / Button / RowButton nodes from a subtree. */
function collectPageElements(root: Node): { vizzes: WikiViz[]; buttons: WikiButton[] } {
  const vizzes: WikiViz[] = []
  const buttons: WikiButton[] = []

  walk(root, (n) => {
    if (n === root) return
    if (n.type === 'Viz') {
      vizzes.push({
        viz: n.viz,
        source: n.source,
        filter: n.filter,
        canCreate: n.crud.includes('c'),
        canUpdate: n.crud.includes('u'),
        canDelete: n.crud.includes('d'),
      })
    }
    if (n.type === 'Button' || n.type === 'RowButton') {
      buttons.push({ label: n.label, target: n.target })
    }
  })

  return { vizzes, buttons }
}

// ---- Natural-language page guide ----------------------------------------

/** The display name of a source (the declared entity name, humanised). */
function sourceName(schema: Schema, source: string | null): string {
  if (!source) return 'records'
  const e = schema[source.toLowerCase()]
  return humanise(e?.name || source)
}

/** Naive singular ("Work Orders" -> "Work Order") for prose like "add a …". */
function singular(s: string): string {
  return /ies$/i.test(s) ? s.replace(/ies$/i, 'y') : /s$/i.test(s) && !/ss$/i.test(s) ? s.replace(/s$/i, '') : s
}

/** Oxford-comma join: ["a","b","c"] -> "a, b, and c". */
function oxford(items: string[], conj = 'and'): string {
  const xs = items.filter(Boolean)
  if (xs.length <= 1) return xs[0] || ''
  if (xs.length === 2) return `${xs[0]} ${conj} ${xs[1]}`
  return `${xs.slice(0, -1).join(', ')}, ${conj} ${xs[xs.length - 1]}`
}

/** Resolve a field reference to its declared "quoted" label, or a humanised name. */
function fieldLabelOf(schema: Schema, source: string | null, ref: string): string {
  const bare = fieldName(ref)
  const entity = source ? schema[source.toLowerCase()] : null
  const f = entity?.fields.find((ff) => ff.name.toLowerCase() === bare.toLowerCase())
  return (f && f.label) || humanise(bare)
}

/** A viz `spec`'s columns as their declared labels (falling back to humanised names). */
function specCols(schema: Schema, source: string | null, spec: string): string[] {
  return String(spec || '').split(',').map((s) => s.trim()).filter(Boolean).map((ref) => fieldLabelOf(schema, source, ref))
}

// ---- declarative action/trigger narrative ("what happens", in plain English) ----

/** A value expression in reader-friendly form: unquote literals, `this.X` -> "the X". */
function cleanValue(expr: string): string {
  return String(expr || '').trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\bthis\.([A-Za-z0-9_]+)/g, (_m, f) => `the ${humanise(f)}`)
    .replace(/\bthis\b/g, 'this record')
}
/** A step's assignments as "Label = value, Label = value" using declared labels. */
function assignsText(schema: Schema, source: string | null, assigns: { field: string; expr: string }[]): string {
  return oxford(assigns.map((a) => `${fieldLabelOf(schema, source, a.field)} = ${cleanValue(a.expr)}`))
}
/** One step as a plain-English clause revealing the table it changes and how. */
function stepClause(schema: Schema, s: WikiStep): string {
  const one = singular(sourceName(schema, s.source)).toLowerCase()
  const detail = s.assigns.length ? ` (${assignsText(schema, s.source, s.assigns)})` : ''
  if (s.op === 'create') return `creates a ${one}${detail}`
  if (s.op === 'update') return `updates the ${one}${detail}`
  if (s.op === 'delete') return `removes the matching ${one}`
  if (s.op === 'post') return `sends a message via ${s.connection || 'the connection'}${detail}`
  return `changes the ${one}`
}
/** The whole action as a sequential journey: "updates X …, then creates Y …". */
function actionNarrative(schema: Schema, steps: WikiStep[]): string {
  return steps.length ? oxford(steps.map((s) => stepClause(schema, s)), 'then') : 'has no steps yet'
}
/** A `? condition` as a clause: `Status == "Done"` -> "Status is Done". */
function conditionText(cond: string | null): string {
  if (!cond) return ''
  return String(cond)
    .replace(/==/g, ' is ').replace(/!=/g, ' is not ')
    .replace(/>=/g, ' is at least ').replace(/<=/g, ' is at most ')
    .replace(/>/g, ' is over ').replace(/</g, ' is under ')
    .replace(/["']/g, '').replace(/\s+/g, ' ').trim()
}

// Turn a single page's elements into task-oriented, end-user instructions.
// Deterministic prose from the config's own labels — no generated filler.
function buildPageGuide(
  page: Node,
  schema: Schema,
  forms: WikiForm[],
  actions: WikiAction[],
): string[] {
  const tasks: string[] = []
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
  const actionByName = new Map(actions.map((a) => [a.name.toLowerCase(), a]))

  // A [Button -> X] may name the form by its title, or by the source it writes to
  // (with the label matching the title). Resolve either way.
  const findForm = (label: string, target: string | null): WikiForm | null => {
    const t = String(target || '').toLowerCase()
    const l = String(label || '').toLowerCase()
    return forms.find((f) => f.title.toLowerCase() === t)
      || forms.find((f) => (f.source || '').toLowerCase() === t && f.title.toLowerCase() === l)
      || forms.find((f) => (f.source || '').toLowerCase() === t)
      || forms.find((f) => f.title.toLowerCase() === l)
      || null
  }

  // The action's declarative journey ("updates the ticket …, then creates a
  // payment …, then updates the customer …") — reveals every table it changes.
  const actionSummary = (target: string | null): string | null => {
    const a = actionByName.get(String(target || '').toLowerCase())
    return a && a.steps.length ? a.narrative : null
  }

  // Describe a button. `prefix` frames it (e.g. "On the ticket's page,"); empty
  // for a page-level button. Form buttons open a form; action buttons summarise
  // every table the action changes.
  const describeButton = (label: string, target: string | null, prefix = ''): void => {
    const form = findForm(label, target)
    if (form) {
      const thing = singular(sourceName(schema, form.source)).toLowerCase()
      const fieldList = form.fields.map((f) => f.label).filter(Boolean)
      let s = `To add a ${thing}, click **${label}** and fill out the form`
      if (fieldList.length) s += ` (${fieldList.join(', ')})`
      if (form.lineItems && form.lineItems.cols.length) {
        s += `, adding a line for each item (${form.lineItems.cols.join(', ')})`
      }
      s += '.'
      if (form.totals.length) {
        const names = form.totals.map((t) => t.name)
        s += ` The ${oxford(names)} ${names.length > 1 ? 'are' : 'is'} worked out for you.`
      }
      tasks.push(s)
      return
    }
    const summary = actionSummary(target)
    const core = summary
      ? `click **${label}** — this ${summary}`
      : `click **${label}** to run the “${target}” action`
    tasks.push(prefix ? `${prefix} ${core}.` : `${cap(core)}.`)
  }

  // Labels of the [Count]/[Slide] KPI items nested in a counter/slider.
  const itemLabels = (n: VizNode): string[] =>
    n.children.filter((c): c is ItemNode => c.type === 'Item').flatMap((c) => c.items.map((it) => it.label)).filter(Boolean)

  const describeViz = (n: VizNode): void => {
    const src = sourceName(schema, n.source)
    const cols = specCols(schema, n.source, n.spec)
    if (n.viz === 'table') {
      let s = `The **${src}** table lists ${cols.length ? oxford(cols) : `your ${src.toLowerCase()}`}.`
      const ops: string[] = []
      if (n.crud.includes('c')) ops.push('add a new one in the empty bottom row')
      if (n.crud.includes('u')) ops.push('edit any value by clicking the cell')
      if (n.crud.includes('d')) ops.push('remove a row with its ✕ button')
      if (ops.length) s += ` You can ${oxford(ops)}.`
      tasks.push(s)
      // Viewer controls: [Search] box and [Filter] dropdowns.
      const hasSearch = n.children.some((c) => c.type === 'Search')
      const filterFields = n.children.filter((c): c is FilterNode => c.type === 'Filter').map((c) => humanise(c.field))
      const ctrl: string[] = []
      if (hasSearch) ctrl.push('search it')
      if (filterFields.length) ctrl.push(`filter it by ${oxford(filterFields)}`)
      if (ctrl.length) tasks.push(`You can ${oxford(ctrl)}.`)
    } else if (n.viz === 'board') {
      tasks.push(`${src} are shown on a board grouped by **${cols[0] || 'status'}** — each column is a stage and shows how many items it holds.`)
    } else if (n.viz === 'calendar') {
      tasks.push(`${src} appear on a month calendar, placed by their **${cols[0] || 'date'}** date.`)
    } else if (n.viz === 'counter') {
      const labels = itemLabels(n)
      tasks.push(labels.length
        ? `The **${src}** summary shows ${oxford(labels)}.`
        : `The **${src}** summary shows key totals at the top of the page.`)
    } else if (n.viz === 'checklist') {
      tasks.push(`${src} are shown as a checklist — tick an item to mark it done.`)
    } else if (n.viz === 'chart') {
      tasks.push(`A chart summarises ${src}${cols.length ? ` by ${cols[0]}` : ''}.`)
    } else if (n.viz === 'slider') {
      const labels = itemLabels(n)
      tasks.push(labels.length
        ? `Progress bars track ${oxford(labels)} for ${src}.`
        : `${src} are shown as progress bars.`)
    }
    for (const c of n.children) {
      if (c.type === 'RowButton') tasks.push(`Each ${singular(src.toLowerCase())} row has a **${c.label}** button that runs an action just for that row.`)
    }
  }

  // Walk the page, describing each interactive element. Don't descend into a
  // [Cases]/[Detail]'s children (that content lives on the record's own sub-page).
  const recurse = (node: Node): void => {
    for (const c of node.children) {
      switch (c.type) {
        case 'Viz': describeViz(c); break
        case 'Cases': {
          const cols = specCols(schema, c.source, c.spec)
          const link = cols[0] || 'first column'
          const thing = singular(sourceName(schema, c.source).toLowerCase())
          tasks.push(`To open a ${thing}, click its **${link}** in the ${sourceName(schema, c.source)} list — that opens the full record page.`)
          // Buttons declared under the [Cases] render ON the opened record page.
          // Describe each (an action button reveals every table it changes).
          const caseButtons: { label: string; target: string | null }[] = []
          const collectBtns = (node: Node): void => {
            for (const ch of node.children) {
              if (ch.type === 'Button' || ch.type === 'RowButton') caseButtons.push({ label: ch.label, target: ch.target })
              else collectBtns(ch)
            }
          }
          collectBtns(c)
          for (const btn of caseButtons) describeButton(btn.label, btn.target, `On a ${thing}'s page,`)
          break
        }
        case 'Detail':
          tasks.push(`Choose a ${sourceName(schema, c.source)} record from the dropdown to see its full details.`)
          break
        case 'View':
          tasks.push(`This shows the “${c.form}” details, read-only.`)
          break
        case 'AIChat':
          tasks.push(`Ask the assistant about ${oxford((c.sources || []).map((s) => sourceName(schema, s)))} — it can look things up for you but never changes your data.`)
          break
        case 'Button': describeButton(c.label, c.target); break
        case 'UserManagement':
          tasks.push('Manage people and their access here — invite users and set what each role can do.')
          break
        case 'Menu': break // navigation is described once, app-level (AppWiki.navigation)
        case 'Text':
          if (c.value && c.value.trim()) tasks.push(`The page shows a note: “${c.value.trim()}”.`)
          break
        case 'Widget':
          // A named card grouping content — name it, then describe what's inside.
          if (c.children.length) {
            tasks.push(`The **${c.name}** card groups:`)
            recurse(c)
          } else {
            tasks.push(`The **${c.name}** card.`)
          }
          break
        default:
          // A generic labelled leaf ([Note] text, [Highlight] …) with content but
          // no children — describe it so every element is covered.
          if (c.type === 'Block' && c.value && c.value.trim() && !c.children.length
            && !STRUCTURAL_TAGS.has(c.tag.toLowerCase())) {
            tasks.push(`The page shows **${humanise(c.tag)}**: “${c.value.trim()}”.`)
          } else {
            recurse(c)
          }
      }
    }
  }
  recurse(page)
  return tasks
}

// ---- Section generators -------------------------------------------------

function buildEntities(schema: Schema): WikiEntity[] {
  return Object.entries(schema).map(([source, entity]) => {
    const gaps: string[] = []
    if (!entity.fields.length) {
      gaps.push(`Entity "${entity.name}" has no declared fields.`)
    }

    const fields: WikiFieldRow[] = entity.fields.map((f) => {
      const row: WikiFieldRow = {
        name: f.name,
        label: f.label || null,
        type: typeLabel(f.type),
        computed: null,
        formula: null,
        options: null,
        required: false,
      }

      if (f.calc != null) {
        row.computed = 'Calc'
        row.formula = f.calc || '(no expression)'
      } else if (f.rollup != null) {
        row.computed = 'Rollup'
        row.formula = f.rollup || '(no expression)'
      } else if (f.lookup) {
        row.computed = 'Lookup'
        row.formula = `${f.lookup.via}.${f.lookup.target ?? '?'}`
      }

      if (f.options) {
        if (f.options.kind === 'static') {
          row.options = (f.options.values ?? []).join(', ') || '(empty list)'
        } else {
          // link options
          const src = f.options.source || '?'
          const fld = f.options.field || ''
          row.options = fld ? `From ${humanise(src)} · ${humanise(fld)}` : `From ${humanise(src)}`
        }
      }

      if (!f.name) {
        gaps.push('A field is missing a name — add an explicit name.')
      }

      return row
    })

    return { name: entity.name, source, kind: entity.kind, fields, gaps }
  })
}

// Describe how to move around the app: the top/side menu (found anywhere in the
// tree), or a note when pages are just listed. App-level, so it's said once.
function buildNavigation(root: RootNode, pageNames: string[]): string[] {
  let menu: MenuNode | null = null
  const find = (n: Node): void => {
    if (menu) return
    if (n.type === 'Menu') { menu = n; return }
    for (const c of n.children) find(c)
  }
  root.children.forEach(find)
  if (menu) {
    const m: MenuNode = menu
    const items = m.items && m.items.length ? m.items : pageNames
    if (!items.length) return []
    const where = m.side ? 'the side menu on the left' : 'the top menu bar'
    const hint = m.collapsible ? ' (tap the ☰ button to open it)' : ''
    return [`Use ${where}${hint} to move between pages: ${items.join(', ')}.`]
  }
  if (pageNames.length > 1) {
    return [`Move between the app's pages — ${pageNames.join(', ')} — from the navigation.`]
  }
  return []
}

function buildPages(root: RootNode, schema: Schema, forms: WikiForm[], actions: WikiAction[]): WikiPage[] {
  const pages: WikiPage[] = []

  for (const n of root.children) {
    if (n.type !== 'Block') continue
    const block = n as BlockNode
    if (block.tag.toLowerCase() !== 'display') continue

    const name = block.value?.trim() || ''
    const gaps: string[] = []
    if (!name) {
      gaps.push('[Display] is missing a page name.')
    }

    const { vizzes, buttons } = collectPageElements(n)
    const guide = buildPageGuide(n, schema, forms, actions)

    if (!guide.length) {
      gaps.push(`Page "${name || '(unnamed)'}" has nothing on it yet.`)
    }

    pages.push({ name: name || '(unnamed)', guide, vizzes, buttons, gaps })
  }

  return pages
}

function buildForms(root: RootNode): WikiForm[] {
  const collected = collectForms(root)
  return collected.map((f) => {
    const gaps: string[] = []
    if (!f.title) {
      gaps.push('[Form] is missing a title.')
    }
    if (!f.source) {
      gaps.push(`Form "${f.title || '(untitled)'}" is not bound to a data source (add [Form -> SourceName]).`)
    }
    if (!f.fields.length && !f.lineItems) {
      gaps.push(`Form "${f.title || '(untitled)'}" has no fields declared.`)
    }

    const fields: WikiFormField[] = f.fields.map((e) => ({
      label: e.label || e.field,
      field: e.field,
      required: e.required,
      readonly: e.readonly,
      autofill: e.autofill,
      showIf: e.showIf,
    }))

    const lineItems: WikiLineItems | null = f.lineItems
      ? { source: f.lineItems.source, cols: f.lineItems.cols.map((c) => humanise(fieldName(c.field) || c.field)) }
      : null

    const totals: WikiTotal[] = f.totals.map((t) => ({ name: t.name, expr: t.expr }))

    return {
      title: f.title || '(untitled)',
      source: f.source,
      size: f.size,
      fields,
      lineItems,
      totals,
      gaps,
    }
  })
}

function buildActions(root: RootNode, schema: Schema): WikiAction[] {
  const collected = collectActions(root)
  return Object.values(collected).map((a) => {
    const gaps: string[] = []
    if (!a.name) gaps.push('[Action] is missing a name.')
    if (!a.steps.length) gaps.push(`Action "${a.name || '(unnamed)'}" has no steps.`)

    const steps: WikiStep[] = a.steps.map(toWikiStep)

    return { name: a.name, steps, narrative: actionNarrative(schema, steps), gaps }
  })
}

function buildTriggers(root: RootNode, schema: Schema): WikiTrigger[] {
  const collected = collectTriggers(root)
  return collected.map((t) => {
    const steps = t.steps.map(toWikiStep)
    const src = singular(sourceName(schema, t.source)).toLowerCase()
    const when = t.condition ? `'s ${conditionText(t.condition)}` : ' changes'
    return {
      label: t.label || '(no label)',
      source: t.source,
      condition: t.condition,
      steps,
      narrative: `When a ${src}${when}, the app ${actionNarrative(schema, steps)}.`,
    }
  })
}

// Verbs in plain English: full set -> "fully manage"; otherwise "view/add/edit/delete".
function humanVerbs(verbs: string[]): string {
  const has = (v: string) => verbs.includes(v)
  if (has('read') && has('create') && has('update') && has('delete')) return 'fully manage'
  const map: Record<string, string> = { read: 'view', create: 'add', update: 'edit', delete: 'delete' }
  const words = ['read', 'create', 'update', 'delete'].filter(has).map((v) => map[v])
  return words.length ? oxford(words) : 'see'
}

// A plain-English "who can do what" — one sentence per declared role. Falls back
// to a single line when no per-entity grants are configured (the app is open).
function buildPermSummary(schema: Schema, roles: string[]): string[] {
  const withPerms = Object.values(schema).filter((e) => e.permissions && Object.keys(e.permissions).length > 0)
  if (!withPerms.length) {
    return ['No role restrictions are configured — anyone who can open the app can view and edit all data.']
  }
  const out: string[] = []
  for (const role of roles) {
    const rl = role.toLowerCase()
    // Group entities that share the same verb phrase, so "fully manage Orders and
    // fully manage Customers" collapses to "fully manage Orders and Customers".
    const byPhrase = new Map<string, string[]>()
    for (const e of withPerms) {
      const g = e.permissions![rl]
      if (g && g.verbs.length) {
        const ph = humanVerbs(g.verbs)
        if (!byPhrase.has(ph)) byPhrase.set(ph, [])
        byPhrase.get(ph)!.push(humanise(e.name))
      }
    }
    const parts = [...byPhrase.entries()].map(([ph, ents]) => `${ph} ${oxford(ents)}`)
    out.push(parts.length
      ? `**${role}** can ${oxford(parts)}.`
      : `**${role}** has no special access — they see only what’s open to everyone.`)
  }
  return out
}

function buildPermMatrix(schema: Schema, roles: string[]): WikiPermEntry[] {
  return Object.entries(schema)
    .filter(([, e]) => e.permissions && Object.keys(e.permissions).length > 0)
    .map(([source, entity]) => ({
      entity: source,
      entityName: entity.name,
      grants: Object.values(entity.permissions!).map((p) => ({
        role: p.role,
        verbs: p.verbs,
      })),
    }))
}

// ---- Main entry point ---------------------------------------------------

/**
 * Generate a full app wiki from a parsed FMD document.
 * Call this with the RootNode from `parseFMD` and the Schema from
 * `collectSchema`. Both are already computed in App.tsx, so no re-parsing.
 */
export function generateWiki(root: RootNode, schema: Schema): AppWiki {
  const appNameNode = root.children.find((n) => n.type === 'AppName')
  const appName = (appNameNode && 'value' in appNameNode ? (appNameNode as { value: string }).value : '') || ''

  const roles = collectRoles(root)
  const entities = buildEntities(schema)
  const forms = buildForms(root)
  const actions = buildActions(root, schema)
  const pages = buildPages(root, schema, forms, actions)
  const triggers = buildTriggers(root, schema)
  const navigation = buildNavigation(root, pages.map((p) => p.name))
  const permMatrix = buildPermMatrix(schema, roles)
  const permSummary = buildPermSummary(schema, roles)

  const topGaps: string[] = []
  if (!appName) topGaps.push('No [App Name] declared — add one so the wiki has a title.')
  if (!pages.length) topGaps.push('No [Display] pages found — add at least one to give the app a UI.')
  if (!Object.keys(schema).length) topGaps.push('No [Data] entities found — add a [Data] block to define the data model.')

  return { appName, pages, entities, forms, actions, triggers, navigation, roles, permMatrix, permSummary, topGaps }
}

// ---- Plain-text export (for offline testing) ----------------------------

/** Render a wiki as plain markdown text (for offline esbuild smoke-tests). */
export function wikiToMarkdown(wiki: AppWiki): string {
  const lines: string[] = []
  const h1 = (t: string) => lines.push(`# ${t}`, '')
  const h2 = (t: string) => lines.push(`## ${t}`, '')
  const h3 = (t: string) => lines.push(`### ${t}`, '')
  const p = (t: string) => lines.push(t, '')
  const gap = (t: string) => lines.push(`> [Doc gap] ${t}`, '')
  const li = (t: string) => lines.push(`- ${t}`)

  h1(wiki.appName || 'App Wiki')
  if (wiki.topGaps.length) wiki.topGaps.forEach(gap)

  // Overview
  h2('Overview')
  if (wiki.appName) p(`**App name:** ${wiki.appName}`)
  if (wiki.pages.length) { p('**Pages:**'); wiki.pages.forEach((pg) => li(pg.name)) }
  if (wiki.roles.length) { lines.push(''); p('**Roles:** ' + wiki.roles.join(', ')) }
  lines.push('')

  // Data model
  h2('Data model')
  for (const e of wiki.entities) {
    h3(`${e.name} (${e.kind === 'api' ? 'external API' : e.kind === 'store' ? 'document store' : 'table'})`)
    e.gaps.forEach(gap)
    if (e.fields.length) {
      lines.push('| Field | Type | Computed | Formula/Options |')
      lines.push('|-------|------|----------|-----------------|')
      for (const f of e.fields) {
        const computed = f.computed ? `[${f.computed}]` : ''
        const extra = f.formula || f.options || ''
        const name = f.label ? `${f.label} (${f.name})` : f.name
        lines.push(`| ${name} | ${f.type} | ${computed} | ${extra} |`)
      }
      lines.push('')
    }
  }

  // Using the app — the natural-language, task-oriented page guide.
  h2('Using the app')
  if (wiki.pages.length) p(`This app has ${wiki.pages.length} ${wiki.pages.length === 1 ? 'page' : 'pages'}: ${wiki.pages.map((pg) => pg.name).join(', ')}.`)
  wiki.navigation.forEach((s) => li(s))
  if (wiki.navigation.length) lines.push('')
  for (const pg of wiki.pages) {
    h3(pg.name)
    pg.gaps.forEach(gap)
    if (pg.guide.length) pg.guide.forEach((t) => li(t.replace(/\*\*/g, '')))
    else p('This page has no interactive elements yet.')
    lines.push('')
  }

  // Forms
  h2('Forms')
  for (const f of wiki.forms) {
    h3(`${f.title}${f.source ? ` (→ ${f.source})` : ''}`)
    f.gaps.forEach(gap)
    for (const ff of f.fields) {
      const flags = [ff.required && 'required', ff.readonly && 'read-only', ff.autofill && `auto-fills: ${ff.autofill}`].filter(Boolean).join(', ')
      li(`${ff.label}${flags ? ` [${flags}]` : ''}`)
    }
    if (f.lineItems) {
      lines.push('', `**Line items (→ ${f.lineItems.source || '?'}):** ${f.lineItems.cols.join(', ')}`)
    }
    for (const t of f.totals) {
      li(`Total — ${t.name} = ${t.expr}`)
    }
    lines.push('')
  }

  // Automations — declarative "what happens", not a step table.
  if (wiki.actions.length || wiki.triggers.length) {
    h2('Automations')
    for (const a of wiki.actions) {
      h3(a.name)
      a.gaps.forEach(gap)
      p(`When you run ${a.name}, the app ${a.narrative}.`)
    }
    for (const t of wiki.triggers) {
      h3(t.label)
      p(t.narrative)
    }
  }

  // Permissions — plain-English "who can do what", then the per-entity detail.
  h2('Who can do what')
  wiki.permSummary.forEach((s) => li(s.replace(/\*\*/g, '')))
  lines.push('')
  for (const row of wiki.permMatrix) {
    h3(row.entityName)
    for (const g of row.grants) li(`${g.role}: ${g.verbs.join(', ')}`)
    lines.push('')
  }

  return lines.join('\n')
}
