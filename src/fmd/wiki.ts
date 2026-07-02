// App-wiki generator for FMD.
// Walks the parsed AST + collected schema and produces a structured, human-
// readable description of the whole app. Purely read-only — never touches DSL
// semantics or runtime data.
// -----------------------------------------------------------------------

import type { Node, RootNode, BlockNode, ActionStep } from './types'
import type { Schema } from './types'
import { collectForms, collectActions, collectTriggers, collectRoles } from './parse/schema'

// ---- Output types -------------------------------------------------------

export interface WikiFieldRow {
  name: string
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
  gaps: string[]
}

export interface WikiTrigger {
  label: string
  source: string
  condition: string | null
  steps: WikiStep[]
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
  roles: string[]
  permMatrix: WikiPermEntry[]
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

function buildPages(root: RootNode): WikiPage[] {
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

    if (!vizzes.length && !buttons.length) {
      gaps.push(`Page "${name || '(unnamed)'}" has no visualisations or buttons yet.`)
    }

    pages.push({ name: name || '(unnamed)', vizzes, buttons, gaps })
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
      ? { source: f.lineItems.source, cols: f.lineItems.cols.map((c) => c.label || c.field) }
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

function buildActions(root: RootNode): WikiAction[] {
  const collected = collectActions(root)
  return Object.values(collected).map((a) => {
    const gaps: string[] = []
    if (!a.name) gaps.push('[Action] is missing a name.')
    if (!a.steps.length) gaps.push(`Action "${a.name || '(unnamed)'}" has no steps.`)

    const steps: WikiStep[] = a.steps.map(toWikiStep)

    return { name: a.name, steps, gaps }
  })
}

function buildTriggers(root: RootNode): WikiTrigger[] {
  const collected = collectTriggers(root)
  return collected.map((t) => ({
    label: t.label || '(no label)',
    source: t.source,
    condition: t.condition,
    steps: t.steps.map(toWikiStep),
  }))
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
  const pages = buildPages(root)
  const forms = buildForms(root)
  const actions = buildActions(root)
  const triggers = buildTriggers(root)
  const permMatrix = buildPermMatrix(schema, roles)

  const topGaps: string[] = []
  if (!appName) topGaps.push('No [App Name] declared — add one so the wiki has a title.')
  if (!pages.length) topGaps.push('No [Display] pages found — add at least one to give the app a UI.')
  if (!Object.keys(schema).length) topGaps.push('No [Data] entities found — add a [Data] block to define the data model.')

  return { appName, pages, entities, forms, actions, triggers, roles, permMatrix, topGaps }
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
        lines.push(`| ${f.name} | ${f.type} | ${computed} | ${extra} |`)
      }
      lines.push('')
    }
  }

  // Pages
  h2('Pages')
  for (const pg of wiki.pages) {
    h3(pg.name)
    pg.gaps.forEach(gap)
    for (const v of pg.vizzes) {
      const src = v.source ? `→ ${v.source}` : '(no source)'
      const filter = v.filter ? ` where ${v.filter}` : ''
      const crud = v.canCreate || v.canUpdate || v.canDelete ? ` · ${crudLabel(
        (v.canCreate ? 'c' : '') + (v.canUpdate ? 'u' : '') + (v.canDelete ? 'd' : '')
      )}` : ''
      li(`${v.viz} ${src}${filter}${crud}`)
    }
    for (const b of pg.buttons) {
      li(`Button: "${b.label}"${b.target ? ` → ${b.target}` : ''}`)
    }
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

  // Automations
  if (wiki.actions.length || wiki.triggers.length) {
    h2('Automations')
    for (const a of wiki.actions) {
      h3(`Action: ${a.name}`)
      a.gaps.forEach(gap)
      for (const s of a.steps) {
        const src = s.source ? ` on ${s.source}` : ''
        const cond = s.filter ? ` where ${s.filter}` : ''
        const assigns = s.assigns.map((x) => `${x.field} = ${x.expr}`).join(', ')
        li(`${s.op.toUpperCase()}${src}${cond}${assigns ? `: ${assigns}` : ''}`)
      }
      lines.push('')
    }
    for (const t of wiki.triggers) {
      h3(`Trigger: ${t.label}`)
      li(`Scans: ${t.source}${t.condition ? ` where ${t.condition}` : ''}`)
      for (const s of t.steps) {
        const src = s.source ? ` on ${s.source}` : ''
        const assigns = s.assigns.map((x) => `${x.field} = ${x.expr}`).join(', ')
        li(`${s.op.toUpperCase()}${src}${assigns ? `: ${assigns}` : ''}`)
      }
      lines.push('')
    }
  }

  // Permissions
  if (wiki.permMatrix.length) {
    h2('Permissions')
    for (const row of wiki.permMatrix) {
      h3(row.entityName)
      for (const g of row.grants) {
        li(`${g.role}: ${g.verbs.join(', ')}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
