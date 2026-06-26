// Schema collection from [Data], plus form/rule collection.
// -------------------------------------------------------------

// Named rules: { name -> expression }. Referenceable in any condition by name.
export function collectRules(root) {
  const rules = {}
  for (const n of root.children) if (n.type === 'Rule' && n.name) rules[n.name] = n.expr
  return rules
}

// Top-level [Form] definitions, with their flattened fields.
export function collectForms(root) {
  return root.children
    .filter((n) => n.type === 'Form')
    .map((f) => ({
      title: f.title,
      source: f.source,
      fields: f.children.filter((c) => c.type === 'FormField').flatMap((c) => c.entries),
    }))
}

// Pull the [Data] entities out of a parsed tree so the app can build its
// source registry (and so the renderer can skip them).
export function isDataBlock(node) {
  return node.type === 'Block' && node.tag && node.tag.toLowerCase() === 'data'
}

const normName = (s) => String(s ?? '').toLowerCase().replace(/s$/, '')

// Split "Source Field" where Source may be multi-word, by matching the longest
// leading run of tokens that is a known entity. Falls back to first-token source.
function resolveLink(raw, sources) {
  const parts = String(raw ?? '').split(/\s+/).filter(Boolean)
  for (let n = parts.length - 1; n >= 1; n--) {
    const src = parts.slice(0, n).join(' ').toLowerCase()
    if (sources.has(src)) return { source: src, field: parts.slice(n).join(' ') }
  }
  return { source: (parts[0] || '').toLowerCase(), field: parts.slice(1).join(' ') || null }
}

// Attach an (option) line to a drop/link field of its entity: prefer a name
// match (singular/plural tolerant), else the first un-configured drop/link.
function bindOption(entity, opt, sources) {
  const isOpt = (f) => f.type === 'drop' || f.type === 'link'
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

// Bind a [Calc]/[Rollup] expression to its (already-declared) field.
function bindCalc(entity, calc) {
  const target = entity.fields.find((f) => f.name.toLowerCase() === String(calc.field).toLowerCase())
  if (target) target.calc = calc.expr
}
function bindRollup(entity, r) {
  const target = entity.fields.find((f) => f.name.toLowerCase() === String(r.field).toLowerCase())
  if (target) target.rollup = r.expr
}

export function collectSchema(root) {
  const schema = {}
  const pending = [] // {entity, opt} — bound in a second pass so links can resolve
  for (const node of root.children) {
    if (!isDataBlock(node)) continue
    let current = null
    for (const child of node.children) {
      if (child.type === 'List' || child.type === 'Store') {
        // kind drives storage: 'list' -> SQL table, 'store' -> JSONB document.
        current = { name: child.name, fields: child.columns.map((f) => ({ ...f })), kind: child.kind }
        schema[child.source] = current
        // (option)/[Calc] lines may be indented UNDER the entity (its children)...
        for (const sub of child.children) {
          if (sub.type === 'Options') pending.push({ entity: current, opt: sub })
          if (sub.type === 'Calc') bindCalc(current, sub)
          if (sub.type === 'Rollup') bindRollup(current, sub)
        }
      } else if (child.type === 'Options' && current) {
        // ...or written as a SIBLING right below it. Both are accepted.
        pending.push({ entity: current, opt: child })
      } else if (child.type === 'Calc' && current) {
        bindCalc(current, child)
      } else if (child.type === 'Rollup' && current) {
        bindRollup(current, child)
      }
    }
  }
  const sources = new Set(Object.keys(schema))
  for (const { entity, opt } of pending) bindOption(entity, opt, sources)
  return schema
}
