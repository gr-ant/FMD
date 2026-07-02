// Functional Markdown (.fmd) parser -- public API barrel.
// -------------------------------------------------------------
// The implementation is split under ./parse/:
//   fields.js  field type prefixes, fieldName, parseFields
//   nodes.js   line/tag node parsing (parseNode) and comment handling
//   tree.js    parseFMD -- the indentation-based tree builder
//   schema.js  collectSchema/collectForms/collectRules and isDataBlock
//   lint.js    lintReferences -- the editor reference linter
// -------------------------------------------------------------

export { fieldName } from './fmd/parse/fields'
export { commentIndex } from './fmd/parse/nodes'
export { parseFMD } from './fmd/parse/tree'
export { lintReferences } from './fmd/parse/lint'
export { collectRules, collectForms, collectActions, collectTriggers, collectStyle, collectRoles, collectAutoNumbers, isDataBlock, collectSchema } from './fmd/parse/schema'
export type { StyleSpec } from './fmd/parse/schema'
export { collectWarnings } from './fmd/validate'
export type { Warning } from './fmd/validate'
export { visibleForRoles } from './fmd/visibility'
