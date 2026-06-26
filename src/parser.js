// Functional Markdown (.fmd) parser -- public API barrel.
// -------------------------------------------------------------
// The implementation is split under ./parse/:
//   fields.js  field type prefixes, fieldName, parseFields
//   nodes.js   line/tag node parsing (parseNode) and comment handling
//   tree.js    parseFMD -- the indentation-based tree builder
//   schema.js  collectSchema/collectForms/collectRules and isDataBlock
//   lint.js    lintReferences -- the editor reference linter
// -------------------------------------------------------------

export { fieldName, parseFields } from './fmd/parse/fields.js'
export { commentIndex } from './fmd/parse/nodes.js'
export { parseFMD } from './fmd/parse/tree.js'
export { lintReferences } from './fmd/parse/lint.js'
export { collectRules, collectForms, isDataBlock, collectSchema } from './fmd/parse/schema.js'
