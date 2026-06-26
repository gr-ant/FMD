// Barrel: runtime data is split into ./state/contexts.js (React contexts +
// useSource) and ./fmd/detect.js (pure field-shape helpers). Re-exported here so
// existing `./data.js` imports keep working.
export { DataContext, SchemaContext, FormsContext, RulesContext, useSource, useRefresh, useRules } from './state/contexts.js'
export { keysOf, pickField, firstText, firstNumber, isNum } from './fmd/detect.js'
