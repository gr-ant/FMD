// Functional Markdown (.fmd) parser
// -------------------------------------------------------------
// Structure is defined by INDENTATION. A line's children are the lines
// indented beneath it -- there are no closing tags for [bracket] tags.
//
//   [Display]                         A bracket tag. If lines are indented
//     [Title] Wedding Planner         under it, it is a CONTAINER; otherwise
//     [Top Menu Bar] a, b, c          it is a leaf element.
//     [Main]
//       ((Schedule Timeline)          Parens build the UI: an outer ( ) groups
//           [Table -> Schedule] ...   widgets into a ROW; each (Name) is a
//       (Inventory Counts)            widget card; an indented [Viz -> Source]
//           [Counter -> Inventory] C  tag is the widget's visualization.
//               [Count] Folding Chairs   singular item -> one entry
//               [Counts] A, B            plural item  -> generates many entries
//       )                             a lone ) closes the row.
//
//   [Data]                            The data MODEL -- declares entities.
//     [List Inventory] Title, Count   NOT rendered; it is the source registry.
//
// Visualization tags carry their binding INSIDE the brackets:
//   [Table -> Schedule] Time, Activity        table of records
//   [Counter -> Inventory] Category           stat cards (curated by [Count]s)
//   [Checklist -> Vendors] Name / Status       interactive checklist
//   [Slider -> Budget] Category Spend / Cap    progress bars (curated by [Slide]s)
//
// Records for each source are loaded at RUNTIME (the API/Postgres, or a
// `-> https://` URL) -- never written in the document itself.
// -------------------------------------------------------------

import { WIDGET_LINE_RE, stripComment, leadingIndent, parseNode } from './nodes.js'

export function parseFMD(src) {
  const lines = (src || '').split(/\r?\n/)

  const root = { type: 'Root', indent: -1, children: [] }
  const stack = [root]
  let row = null          // the currently open widget Row (from outer parens)
  let rowParentLen = 0    // stack length to restore to when the row closes

  const attachByIndent = (node, indent) => {
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    node.indent = indent
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  for (const rawLine of lines) {
    const raw = stripComment(rawLine)
    if (!raw.trim()) continue
    const indent = leadingIndent(raw)
    let trimmed = raw.trim()

    // A lone ')' closes the current widget row.
    if (trimmed === ')') {
      if (row) { stack.length = rowParentLen; row = null }
      continue
    }

    // A leading '((' opens a row AND declares its first widget on the same line.
    let openRow = false
    if (trimmed.startsWith('((')) { openRow = true; trimmed = trimmed.slice(1) }

    // A widget header: a single (Name) filling the whole line.
    const wm = trimmed.match(WIDGET_LINE_RE)
    if (wm) {
      const widget = { type: 'Widget', name: wm[1].trim(), indent, children: [] }
      if (openRow) {
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
        row = { type: 'Row', indent, children: [] }
        stack[stack.length - 1].children.push(row)
        rowParentLen = stack.length      // restore point: parent is on top, row is off-stack
        row.children.push(widget)
        stack.push(widget)               // widget's [Viz] children attach by indent
      } else if (row) {
        stack.length = rowParentLen      // back up to the row's parent...
        row.children.push(widget)        // ...add the next widget to the same row
        stack.push(widget)
      } else {
        attachByIndent(widget, indent)   // a stray widget with no row
      }
      continue
    }

    const node = parseNode(trimmed)
    if (!node) continue
    attachByIndent(node, indent)
  }

  return root
}
