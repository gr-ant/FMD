// Barrel: runtime data is split into ./state/contexts.js (React contexts +
// useSource) and ./fmd/detect.js (pure field-shape helpers). Re-exported here so
// existing `./data.js` imports keep working.
export { DataContext, SchemaContext, FormsContext, RulesContext, ActionsContext, ApiContext, RolesContext, UserMgmtContext, RecordContext, FormsListContext, CaseNavContext, useSource, useRefresh, useRules, useActions, useApiBase, useVisibilityRoles, useUserMgmt, useRecord, useCase, useFormsList, useCaseNav } from './state/contexts'
export { keysOf, pickField, isNum } from './fmd/detect'
