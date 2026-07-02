// Structural validation for the editor's warnings panel: things that aren't a
// field-reference typo (that's lint.ts) but mean the document is missing
// mandatory pieces or wired up wrong. Some warnings carry a `fix` that
// auto-populates the missing section.
import type { Node, RootNode, Schema } from './types'
import { collectForms, collectActions } from './parse/schema'

export interface Warning {
  level: 'error' | 'warn'
  message: string
  line?: number
  fix?: { label: string; append: string }
  block?: boolean // a hard error that prevents Save → rebuild DB / Deploy
}

const DATA_SCAFFOLD = '\n[Data]\n  [List Items] txtName, numCount\n'
const DISPLAY_SCAFFOLD =
  '\n[Display] Home\n  [Title] Home\n  [TopMenu] Home\n  [Main]\n    ((Items)\n      [Table -> Items] Name, Count\n    )\n'
const APPNAME_SCAFFOLD = '[App Name] My App\n'
// The required Authentik-backed users list (fields the user-management proxy needs).
const USERS_SCAFFOLD = '\n[Data]\n  [List Users] txtUsername, txtName, txtEmail, mselRoles, boolActive\n'
const USERS_REQUIRED = ['username', 'roles']

const isUrl = (s: unknown): boolean => /^https?:\/\//.test(String(s ?? ''))

function walk(node: Node, fn: (n: Node) => void): void {
  fn(node)
  for (const c of node.children || []) walk(c, fn)
}

export function collectWarnings(root: RootNode, schema: Schema): Warning[] {
  const out: Warning[] = []
  const all: Node[] = []
  walk(root, (n) => all.push(n))

  const sources = new Set(Object.keys(schema))
  const top = root.children || []
  const isBlock = (n: Node, tag: string) => n.type === 'Block' && n.tag.toLowerCase() === tag

  // ---- mandatory top-level pieces (with auto-populate fixes) ----
  if (!top.some((n) => isBlock(n, 'display'))) {
    out.push({ level: 'error', message: 'No [Display] — the app has no screen to render.', fix: { label: 'Add [Display]', append: DISPLAY_SCAFFOLD } })
  }
  if (!top.some((n) => isBlock(n, 'data'))) {
    out.push({ level: 'warn', message: 'No [Data] block — declare entities so views can bind to data.', fix: { label: 'Add [Data]', append: DATA_SCAFFOLD } })
  }
  if (!top.some((n) => n.type === 'AppName')) {
    out.push({ level: 'warn', message: 'No [App Name] — give the app a title.', fix: { label: 'Add [App Name]', append: APPNAME_SCAFFOLD } })
  }

  // ---- [User Management] requires a [List Users] entity (BLOCKS save/deploy) ----
  if (all.some((n) => n.type === 'UserManagement')) {
    const users = schema.users
    if (!users) {
      out.push({ level: 'error', block: true, message: '[User Management] requires a [List Users] entity — add it to use it.', fix: { label: 'Add [List Users]', append: USERS_SCAFFOLD } })
    } else {
      const have = new Set(users.fields.map((f) => f.name.toLowerCase()))
      const missing = USERS_REQUIRED.filter((r) => !have.has(r))
      if (missing.length) {
        out.push({ level: 'error', block: true, message: `[List Users] is missing required field(s): ${missing.join(', ')}.` })
      }
    }
  }

  // ---- bindings & wiring ----
  const forms = collectForms(root)
  const actions = collectActions(root)
  const formTitles = forms.map((f) => f.title.toLowerCase())
  const formSources = new Set(forms.map((f) => f.source).filter(Boolean) as string[])
  const actionNames = new Set(Object.keys(actions))

  for (const n of all) {
    if (n.type === 'Viz' && n.source && !isUrl(n.source) && !sources.has(n.source)) {
      out.push({ level: 'error', message: `[${n.viz}] binds to “${n.source}”, which isn’t a declared [Data] source.`, line: n.line })
    } else if (n.type === 'Detail' && n.source && !sources.has(n.source)) {
      out.push({ level: 'error', message: `[Detail] binds to “${n.source}”, which isn’t a declared [Data] source.`, line: n.line })
    } else if (n.type === 'Form' && n.source && !sources.has(n.source)) {
      out.push({ level: 'warn', message: `[Form] “${n.title}” binds to “${n.source}”, not a declared source.`, line: n.line })
    } else if (n.type === 'Button') {
      const target = (n.target || '').toLowerCase()
      const label = (n.label || '').toLowerCase()
      const opensForm = formTitles.includes(label) || (!!target && formTitles.some((t) => t.includes(target))) || formSources.has(target)
      const opensAction = actionNames.has(target) || actionNames.has(label)
      if (!opensForm && !opensAction) {
        out.push({ level: 'warn', message: `Button “${n.label}” opens nothing — no matching [Form] or [Action].`, line: n.line })
      }
    } else if (n.type === 'List' || n.type === 'Store') {
      if (n.source && n.source.startsWith('_')) {
        out.push({ level: 'error', message: `[${n.type} ${n.name}] uses a reserved name (leading “_”) — rename it.`, line: n.line })
      }
      if (!n.columns || !n.columns.length) {
        out.push({ level: 'warn', message: `[${n.type} ${n.name}] declares no fields.`, line: n.line })
      }
    } else if (n.type === 'Step' && n.source && !sources.has(n.source)) {
      out.push({ level: 'warn', message: `Action step [${n.op}] targets “${n.source}”, not a declared source.`, line: n.line })
    }
  }
  return out
}
