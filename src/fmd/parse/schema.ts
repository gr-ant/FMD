// Schema collection from [Data], plus form/rule collection.
// -------------------------------------------------------------
import type {
  Node,
  RootNode,
  Schema,
  Entity,
  Field,
  OptionsNode,
  CalcNode,
  RollupNode,
  LookupNode,
  AutoNode,
  ActionStep,
  PostStepNode,
  TriggerNode,
  FormNode,
  FormFieldNode,
  LineItemsNode,
  TotalNode,
  PermissionNode,
  PermissionVerb,
  EntityPermissions,
  ApiNode,
  ApiSpec,
} from '../types'

// Named rules: { name -> expression }. Referenceable in any condition by name.
export function collectRules(root: RootNode): Record<string, string | null> {
  const rules: Record<string, string | null> = {}
  for (const n of root.children) if (n.type === 'Rule' && n.name) rules[n.name] = n.expr
  return rules
}

// All declared role names: bare top-level [Role]/[Roles], or [Role]s nested in a
// top-level [Permissions] section. De-duplicated, first-seen order.
export function collectRoles(root: RootNode): string[] {
  const out: string[] = []
  const add = (names: string[]) => { for (const name of names) if (!out.includes(name)) out.push(name) }
  for (const n of root.children) {
    if (n.type === 'Role') add(n.names)
    else if (n.type === 'Permission') for (const c of n.children) if (c.type === 'Role') add(c.names)
  }
  return out
}

// Permission verb synonyms -> canonical CRUD verbs.
const VERB: Record<string, PermissionVerb | 'all'> = {
  read: 'read', view: 'read', list: 'read', see: 'read',
  write: 'create', create: 'create', add: 'create', insert: 'create', new: 'create',
  modify: 'update', update: 'update', edit: 'update', change: 'update',
  delete: 'delete', remove: 'delete', destroy: 'delete',
  all: 'all', full: 'all', manage: 'all', admin: 'all',
}
function normVerbs(values: string[] | null): PermissionVerb[] {
  const out = new Set<PermissionVerb>()
  for (const v of values || []) {
    const c = VERB[String(v).trim().toLowerCase()]
    if (c === 'all') (['read', 'create', 'update', 'delete'] as PermissionVerb[]).forEach((x) => out.add(x))
    else if (c) out.add(c)
  }
  return [...out]
}

// Add grant lines to an entity's permission map. Grants use `{Role, Role} verb,
// verb`; legacy `(Role) verb, verb` option lines also work.
function bindGrants(entity: Entity, children: Node[]): void {
  const perms: EntityPermissions = entity.permissions || {}
  for (const child of children) {
    if (child.type === 'Grant') {
      const verbs = normVerbs(child.verbs)
      for (const r of child.roles.allow) perms[r] = { role: r, verbs }
    } else if (child.type === 'Options' && child.name) {
      perms[child.name.trim().toLowerCase()] = { role: child.name.trim(), verbs: normVerbs(child.values) }
    }
  }
  entity.permissions = perms
}
function bindPermissions(entity: Entity, permNode: PermissionNode): void {
  bindGrants(entity, permNode.children)
}

// One collected [Action]: its display name and ordered write steps.
interface CollectedAction {
  name: string
  steps: ActionStep[]
}

// A [Post]/[Call] step forms its request body from INDENTED `Field = expr` lines
// (attached as child Text nodes after parsing) plus any inline assigns. Merge the
// indented lines into `assigns` so the executor + server see a uniform step.
function fillPostAssigns(step: PostStepNode): PostStepNode {
  const fromChildren = step.children
    .filter((c) => c.type === 'Text')
    .map((c) => (c as { value: string }).value)
    .map((v) => { const i = v.indexOf('='); return i === -1 ? null : { field: v.slice(0, i).trim(), expr: v.slice(i + 1).trim() } })
    .filter((a): a is { field: string; expr: string } => !!a && !!a.field)
  return fromChildren.length ? { ...step, assigns: [...step.assigns, ...fromChildren] } : step
}

// Collect the ordered steps under an [Action]/[Trigger]: record-writes ([Step])
// and outbound calls ([PostStep], with its indented body merged in).
function collectSteps(children: Node[]): ActionStep[] {
  return children
    .filter((c): c is ActionStep => c.type === 'Step' || c.type === 'PostStep')
    .map((c) => (c.type === 'PostStep' ? fillPostAssigns(c) : c))
}

// Named [Action] definitions, keyed (lowercased) by name. Each carries its
// ordered [Create]/[Update]/[Delete] steps, run when a [Button] targets it.
export function collectActions(root: RootNode): Record<string, CollectedAction> {
  const actions: Record<string, CollectedAction> = {}
  for (const n of root.children) {
    if (n.type === 'Action' && n.name) {
      actions[n.name.toLowerCase()] = {
        name: n.name,
        steps: collectSteps(n.children),
      }
    }
  }
  return actions
}

// [Style] block -> CSS custom properties to apply on the rendered app's root.
// Keys map to the theme variables; Size maps to the content max-width.
//
// The palette is deliberately BASIC — six color keys cover a whole theme:
//   Background        the page behind everything            (--bg)
//   Foreground        panels + card surfaces in front of it (--panel, --panel-2)
//   Text              body text                             (--text)
//   Lines             borders + dividers                    (--line)
//   Primary Buttons   the primary accent                    (--accent)
//   Secondary Buttons the secondary accent                  (--accent-2)
// Muted text, headings, and button-text contrast are DERIVED from those (see
// apply() below), so a theme needs nothing more. Older, finer-grained keys
// (surface/card/muted/heading/...) are still honored for back-compat.
const STYLE_VAR: Record<string, string[]> = {
  // --- the six basics ---
  background: ['--bg'], bg: ['--bg'],
  foreground: ['--panel', '--panel-2'], fg: ['--panel', '--panel-2'],
  text: ['--text'],
  lines: ['--line'], line: ['--line'],
  'primary buttons': ['--accent'], 'primary button': ['--accent'], primary: ['--accent'],
  'secondary buttons': ['--accent-2'], 'secondary button': ['--accent-2'], secondary: ['--accent-2'],
  // --- back-compat aliases (older configs); not advertised ---
  surface: ['--panel', '--panel-2'], panel: ['--panel', '--panel-2'],
  card: ['--panel-2'], widget: ['--panel-2'],
  muted: ['--muted'], border: ['--line'],
  heading: ['--heading'], headings: ['--heading'], title: ['--heading'],
  buttontext: ['--btn-text'], accenttext: ['--btn-text'], 'button text': ['--btn-text'],
}

// Common color names we can judge luminance for, so button text auto-contrasts
// even when the palette uses a name rather than a hex value.
const NAMED_HEX: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#007fff',
  navy: '#001f3f', teal: '#008080', purple: '#6f42c1', orange: '#fd7e14', yellow: '#ffd700',
  gold: '#ffd700', gray: '#808080', grey: '#808080', silver: '#c0c0c0', slate: '#334155',
  indigo: '#4b0082', pink: '#ff69b4', maroon: '#800000', lime: '#a4f000', cyan: '#00bcd4',
}
// Pick black or white text for a button of the given color, by perceived
// luminance. Returns '' when we can't tell (leave the default).
function contrastText(raw: string): string {
  let hex = raw.trim().toLowerCase()
  if (NAMED_HEX[hex]) hex = NAMED_HEX[hex]
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) return ''
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1a1a1a' : '#ffffff'
}
const SIZE_MAX: Record<string, string> = { compact: '760px', standard: '1100px', full: 'none' }
const normColor = (v: string): string => (/^[0-9a-fA-F]{3,8}$/.test(v.trim()) ? '#' + v.trim() : v.trim())

// [Font] -> a font stack (--app-font) + an optional Google Fonts family to load.
// Keywords use system stacks (no network); everything else is treated as a font
// name and loaded from Google (a miss just falls back to sans-serif).
const SYS_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const FONTS: Record<string, { stack: string; google?: string }> = {
  system: { stack: SYS_SANS }, sans: { stack: SYS_SANS }, default: { stack: SYS_SANS },
  serif: { stack: "Georgia, 'Times New Roman', serif" },
  mono: { stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  monospace: { stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  inter: { stack: "'Inter', sans-serif", google: 'Inter:wght@400;500;600;700' },
  roboto: { stack: "'Roboto', sans-serif", google: 'Roboto:wght@400;500;700' },
  poppins: { stack: "'Poppins', sans-serif", google: 'Poppins:wght@400;500;600;700' },
  lato: { stack: "'Lato', sans-serif", google: 'Lato:wght@400;700' },
  montserrat: { stack: "'Montserrat', sans-serif", google: 'Montserrat:wght@400;500;600;700' },
  nunito: { stack: "'Nunito', sans-serif", google: 'Nunito:wght@400;600;700' },
  'open sans': { stack: "'Open Sans', sans-serif", google: 'Open+Sans:wght@400;600;700' },
  'work sans': { stack: "'Work Sans', sans-serif", google: 'Work+Sans:wght@400;500;600' },
  merriweather: { stack: "'Merriweather', serif", google: 'Merriweather:wght@400;700' },
  'playfair display': { stack: "'Playfair Display', serif", google: 'Playfair+Display:wght@400;600;700' },
  'source code pro': { stack: "'Source Code Pro', monospace", google: 'Source+Code+Pro:wght@400;600' },
}
function resolveFont(name: string): { stack: string; google?: string } {
  const key = name.trim().toLowerCase()
  if (FONTS[key]) return FONTS[key]
  const fam = name.trim()
  return { stack: `'${fam}', sans-serif`, google: fam.replace(/\s+/g, '+') + ':wght@400;500;600;700' }
}

export interface StyleSpec { size: string | null; font: string | null; vars: Record<string, string> }

export function collectStyle(root: RootNode): StyleSpec {
  const spec: StyleSpec = { size: null, font: null, vars: {} }
  const node = root.children.find((n) => n.type === 'Style')
  if (!node) return spec
  const apply = (rawKey: string, rawVal: string): void => {
    const key = rawKey.trim().toLowerCase().replace(/\s+/g, ' ')
    const val = String(rawVal || '').trim()
    if (!val) return
    if (key === 'size') { const s = val.toLowerCase(); if (SIZE_MAX[s]) { spec.size = s; spec.vars['--app-max'] = SIZE_MAX[s] } }
    else if (key === 'font') { const f = resolveFont(val); spec.vars['--app-font'] = f.stack; if (f.google) spec.font = f.google }
    else if (STYLE_VAR[key]) {
      const cssVars = STYLE_VAR[key]
      const color = normColor(val)
      for (const cssVar of cssVars) spec.vars[cssVar] = color
      // Derive companion vars so the six basics alone make a full theme.
      // (Explicit older keys, if present, still override by block order.)
      if (cssVars.includes('--text')) {
        spec.vars['--muted'] = `color-mix(in srgb, ${color} 60%, transparent)`
        spec.vars['--heading'] = color
      }
      if (cssVars.includes('--accent')) {
        const t = contrastText(val); if (t) spec.vars['--btn-text'] = t
      }
    }
  }
  // Walk the block: [Size] Full and [Primary] White are tags with a value;
  // [Colors]/[Theme] is a wrapper whose children are the color tags. Also
  // tolerate flat `Key: Value` text lines.
  const visit = (n: Node): void => {
    for (const c of n.children) {
      if (c.type === 'Block') {
        const tag = c.tag.trim().toLowerCase()
        if (tag === 'colors' || tag === 'color' || tag === 'theme' || tag === 'palette') visit(c)
        else apply(c.tag, String((c as { value?: string }).value || ''))
      } else if (c.type === 'Text') {
        // `Key: Value` flat line, OR `[Text] <color>` — the latter parses to a
        // Text node (the [Text] element tag), so a colon-less value inside a
        // style block is the text color.
        const i = c.value.indexOf(':')
        if (i !== -1) apply(c.value.slice(0, i), c.value.slice(i + 1))
        else if (c.value.trim()) apply('text', c.value)
      }
    }
  }
  visit(node)
  return spec
}

// One collected [Trigger]: the source it scans, the per-record condition, and
// its ordered steps. Run automatically (after actions + on a periodic sweep).
export interface CollectedTrigger {
  source: string
  condition: string | null
  label: string
  steps: ActionStep[]
}
export function collectTriggers(root: RootNode): CollectedTrigger[] {
  return root.children
    .filter((n): n is TriggerNode => n.type === 'Trigger')
    .map((t) => ({
      source: t.source || '',
      condition: t.condition,
      label: t.label,
      steps: collectSteps(t.children),
    }))
    .filter((t) => t.source) // a trigger needs a source to scan
}

// One collected [Form]: its title, bound source, modal size, and flattened
// fields. `size` is the modal width: 'compact' | 'standard' | 'wide'.
export type FormSize = 'compact' | 'standard' | 'wide'
interface CollectedForm {
  title: string
  source: string | null
  size: FormSize
  fields: FormFieldNode['entries']
  // An optional repeating line-item grid ([LineItems]) and computed [Total] lines.
  lineItems: { source: string | null; cols: FormFieldNode['entries'] } | null
  totals: { name: string; expr: string }[]
}

// A `[Size] Wide` line indented under a [Form] sets its modal width.
function formSize(form: FormNode): FormSize {
  const sz = form.children.find(
    (c): c is Node & { value?: string } => c.type === 'Block' && !!c.tag && c.tag.toLowerCase() === 'size',
  )
  const v = String(sz?.value || '').trim().toLowerCase()
  return v === 'compact' || v === 'wide' ? v : 'standard'
}

// Top-level [Form] definitions, with their flattened fields.
export function collectForms(root: RootNode): CollectedForm[] {
  return root.children
    .filter((n): n is FormNode => n.type === 'Form')
    .map((f) => ({
      title: f.title,
      source: f.source,
      size: formSize(f),
      fields: f.children
        .filter((c): c is FormFieldNode => c.type === 'FormField')
        .flatMap((c) => c.entries),
      lineItems: (() => {
        const li = f.children.find((c): c is LineItemsNode => c.type === 'LineItems')
        return li ? { source: li.source, cols: li.cols } : null
      })(),
      totals: f.children
        .filter((c): c is TotalNode => c.type === 'Total')
        .map((t) => ({ name: t.name, expr: t.expr })),
    }))
}

// Pull the [Data] entities out of a parsed tree so the app can build its
// source registry (and so the renderer can skip them).
export function isDataBlock(node: Node): boolean {
  // [API] sources are data (fetched at runtime, never rendered), so they're
  // skipped by the renderer and excluded from display just like a [Data] block.
  return node.type === 'Api' || (node.type === 'Block' && !!node.tag && node.tag.toLowerCase() === 'data')
}

// Read an [API] node's indented [URL]/[Auth]/[Path]/[Map] children (generic Block
// nodes) into an ApiSpec. No secret key lives in the document — the server holds
// it; here we only carry url/auth/path and the field<-dot-path mappings.
function extractApi(node: ApiNode): ApiSpec {
  let url: string | null = null
  let auth: string | null = null
  let path: string | null = null
  let want: string | null = null
  const fields: { field: string; jsonPath: string }[] = []
  for (const child of node.children) {
    if (child.type !== 'Block' || !child.tag) continue
    const tag = child.tag.trim().toLowerCase()
    const val = String((child as { value?: unknown }).value ?? '').trim()
    if (tag === 'url') url = val || null
    else if (tag === 'auth') auth = val || null
    else if (tag === 'path') path = val || null
    else if (tag === 'want') want = val || null
    else if (tag === 'map') {
      // [Map] FmdField = json.dot.path  — split on the first '='.
      const eq = val.indexOf('=')
      if (eq > 0) {
        const field = val.slice(0, eq).trim()
        const jsonPath = val.slice(eq + 1).trim()
        if (field && jsonPath) fields.push({ field, jsonPath })
      }
    }
  }
  return { url, auth, path, fields, want }
}

// Register an [API] source as a schema entity (kind 'api'). Its declared [Map]
// fields become text fields so views/lint can reference them; the ApiSpec rides
// along on `entity.api` for the apply payload + the server proxy.
function registerApi(schema: Schema, node: ApiNode): void {
  const spec = extractApi(node)
  schema[node.name.toLowerCase()] = {
    name: node.name,
    kind: 'api',
    fields: spec.fields.map((m) => ({ name: m.field, type: 'text' as const })),
    api: spec,
  }
}

const normName = (s: unknown): string => String(s ?? '').toLowerCase().replace(/s$/, '')

// Split "Source Field" where Source may be multi-word, by matching the longest
// leading run of tokens that is a known entity. Falls back to first-token source.
function resolveLink(raw: unknown, sources: Set<string>): { source: string; field: string | null } {
  const parts = String(raw ?? '').split(/\s+/).filter(Boolean)
  for (let n = parts.length - 1; n >= 1; n--) {
    const src = parts.slice(0, n).join(' ').toLowerCase()
    if (sources.has(src)) return { source: src, field: parts.slice(n).join(' ') }
  }
  return { source: (parts[0] || '').toLowerCase(), field: parts.slice(1).join(' ') || null }
}

// Attach an (option) line to a drop/link field of its entity: prefer a name
// match (singular/plural tolerant), else the first un-configured drop/link.
function bindOption(entity: Entity, opt: OptionsNode, sources: Set<string>): void {
  const isOpt = (f: Field): boolean => f.type === 'drop' || f.type === 'link' || f.type === 'msel'
  const target =
    entity.fields.find((f) => isOpt(f) && normName(f.name) === normName(opt.name)) ||
    entity.fields.find((f) => isOpt(f) && !f.options)
  if (!target) return
  if (opt.link) {
    const { source, field } = resolveLink(opt.link.raw, sources)
    target.options = { kind: 'link', source, field, where: opt.where || null }
  } else {
    target.options = { kind: 'static', values: opt.values, where: opt.where || null }
  }
}

// Bind a [Calc]/[Rollup] expression to its field — declaring it (as a computed
// field) if it isn't already in the entity, just like [Lookup]. A pre-declared
// field keeps its declared type/format (e.g. `curTotal`, `dateDue`). For an
// auto-created field: a [Calc] defaults to TEXT (a calc may yield a string, date,
// or number — text displays any of them as-is), while a [Rollup] is always a
// numeric aggregate, so it defaults to number.
function bindCalc(entity: Entity, calc: CalcNode): void {
  let target = entity.fields.find((f) => f.name.toLowerCase() === String(calc.field).toLowerCase())
  if (!target) { target = { name: calc.field, type: 'text' }; entity.fields.push(target) }
  target.calc = calc.expr
}
function bindRollup(entity: Entity, r: RollupNode): void {
  let target = entity.fields.find((f) => f.name.toLowerCase() === String(r.field).toLowerCase())
  if (!target) { target = { name: r.field, type: 'number' }; entity.fields.push(target) }
  target.rollup = r.expr
}
// A [Lookup] adds a virtual (non-stored) field if one isn't already declared,
// then records the link field + target to resolve at render time.
function bindLookup(entity: Entity, l: LookupNode): void {
  let target = entity.fields.find((f) => f.name.toLowerCase() === String(l.field).toLowerCase())
  if (!target) { target = { name: l.field, type: 'text' }; entity.fields.push(target) }
  target.lookup = { via: l.via, target: l.target }
}
// An [Auto] directive marks a (usually text) field as server-auto-numbered: the
// field is filled on create from a sequence, formatted by `pattern`. Declare the
// field if it isn't already present (defaults to text — the formatted id is a
// string). The counter itself lives server-side, keyed per source+field.
function bindAuto(entity: Entity, a: AutoNode): void {
  if (!a.field) return
  let target = entity.fields.find((f) => f.name.toLowerCase() === String(a.field).toLowerCase())
  if (!target) { target = { name: a.field, type: 'text' }; entity.fields.push(target) }
  target.auto = a.pattern
}

export function collectSchema(root: RootNode): Schema {
  const schema: Schema = {}
  const pending: { entity: Entity; opt: OptionsNode }[] = [] // bound in a second pass so links can resolve
  for (const node of root.children) {
    if (node.type === 'Api') { registerApi(schema, node); continue }
    if (!isDataBlock(node)) continue
    let current: Entity | null = null
    for (const child of node.children) {
      if (child.type === 'Api') {
        registerApi(schema, child)
      } else if (child.type === 'List' || child.type === 'Store') {
        // kind drives storage: 'list' -> SQL table, 'store' -> JSONB document.
        current = { name: child.name, fields: child.columns.map((f) => ({ ...f })), kind: child.kind }
        schema[child.source] = current
        // (option)/[Calc] lines may be indented UNDER the entity (its children)...
        for (const sub of child.children) {
          if (sub.type === 'Options') pending.push({ entity: current, opt: sub })
          if (sub.type === 'Calc') bindCalc(current, sub)
          if (sub.type === 'Rollup') bindRollup(current, sub)
          if (sub.type === 'Lookup') bindLookup(current, sub)
          if (sub.type === 'Auto') bindAuto(current, sub)
          if (sub.type === 'Permission') bindPermissions(current, sub)
        }
      } else if (child.type === 'Options' && current) {
        // ...or written as a SIBLING right below it. Both are accepted.
        pending.push({ entity: current, opt: child })
      } else if (child.type === 'Calc' && current) {
        bindCalc(current, child)
      } else if (child.type === 'Rollup' && current) {
        bindRollup(current, child)
      } else if (child.type === 'Lookup' && current) {
        bindLookup(current, child)
      } else if (child.type === 'Auto' && current) {
        bindAuto(current, child)
      } else if (child.type === 'Permission' && current) {
        bindPermissions(current, child)
      }
    }
  }
  const sources = new Set(Object.keys(schema))
  for (const { entity, opt } of pending) bindOption(entity, opt, sources)

  // The reserved `users` entity ([List Users]) is backed by Authentik. Its Roles
  // (msel) field draws its options from the declared [Role]s automatically.
  if (schema.users) {
    const declared = collectRoles(root)
    for (const f of schema.users.fields) {
      if (f.type === 'msel' && f.name.toLowerCase() === 'roles') {
        f.options = { kind: 'static', values: declared, where: null }
      }
    }
  }
  return schema
}

// The auto-number model for server-side generation, mirroring how permissions
// are derived from the collected schema. Shape: { [source]: { [field]: pattern } }.
// The server (server/autonumber.js) reads this from `_fmd_configs.autonumbers` and
// fills any empty auto field on create with the next sequential formatted value.
export function collectAutoNumbers(schema: Schema): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [src, def] of Object.entries(schema)) {
    for (const f of def.fields) {
      if (f.auto != null && f.auto !== '') {
        ;(out[src] ||= {})[f.name] = f.auto
      }
    }
  }
  return out
}
