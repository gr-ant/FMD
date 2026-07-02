// Shared domain types for the FMD app.
// -------------------------------------------------------------
// These describe (1) the data MODEL produced by the schema collector
// (Field/Entity/Schema) and (2) the parser AST (the Node discriminated
// union). The shapes here mirror the literal objects produced in
// fmd/parse/nodes.js, tree.js, fields.js and fmd/parse/schema.js.

// ---- Data model --------------------------------------------------------

export type FieldType =
  | 'text'
  | 'memo'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'date'
  | 'drop'
  | 'link'
  | 'msel'
  | 'file'   // a single uploaded file (image/pdf/…) stored as a {id,name,mime} descriptor
  | 'files'  // several uploaded files, stored as an array of descriptors

// A runtime record from a source. Loose by design (columns vary per entity),
// with the synthetic primary key the CRUD API assigns.
export type FmdRecord = Record<string, unknown> & { _id?: number | string }

// The bound options on a drop/link field (after schema collection resolves
// any (option) lines against the source registry).
export interface FieldOptions {
  kind: 'static' | 'link'
  values?: string[]
  source?: string
  field?: string | null
  where?: string | null
}

// A column in an entity. `type` is required; the rest are attached later by
// the schema collector ([Calc]/[Rollup]/[Lookup]/(options)).
export interface Field {
  name: string
  type: FieldType
  options?: FieldOptions
  calc?: string
  rollup?: string
  lookup?: { via: string; target: string | null }
}

// An entity declared in [Data]. `kind` drives storage: list -> SQL table,
// store -> JSONB document collection.
export type PermissionVerb = 'read' | 'create' | 'update' | 'delete'
// Per-role grants on an entity: lowercased role name -> { role, verbs }.
export type EntityPermissions = Record<string, { role: string; verbs: PermissionVerb[] }>

// The connection spec for an external [API] data source. Carried on the entity
// so the apply payload can hand it to the server (which holds the secret key).
export interface ApiSpec {
  url: string | null
  auth: string | null // 'bearer' | 'header:Name' | 'query:Name'
  path: string | null // dot-path to the record array in the response
  fields: { field: string; jsonPath: string }[]
  want: string | null // optional natural-language hint of desired fields (for AI)
}

export interface Entity {
  name: string
  fields: Field[]
  kind: 'list' | 'store' | 'api'
  permissions?: EntityPermissions
  api?: ApiSpec // present only when kind === 'api'
}

// The source registry, keyed by lowercased source name.
export type Schema = Record<string, Entity>

// ---- Parser AST --------------------------------------------------------

// Every node carries its indentation-derived children. `indent` is set while
// the tree is being built.
// A `{Role, !Role}` visibility block: `allow` = only these roles see it;
// `deny` = these roles don't. If only `deny` is set, everyone else is allowed.
export interface RoleVisibility {
  allow: string[]
  deny: string[]
}

export interface BaseNode {
  children: Node[]
  indent?: number
  line?: number // 0-based source line, set while the tree is built
  roles?: RoleVisibility // optional {Role, !Role} visibility block
}

// The document root.
export interface RootNode extends BaseNode {
  type: 'Root'
}

// Generic bracket tag: a container if children indent under it, else a leaf.
export interface BlockNode extends BaseNode {
  type: 'Block'
  tag: string
  value: string
  source: string | null
}

export interface TitleNode extends BaseNode {
  type: 'Title'
  value: string
}

export interface AppNameNode extends BaseNode {
  type: 'AppName'
  value: string
}

export interface MenuNode extends BaseNode {
  type: 'Menu'
  items: string[]
  side?: boolean // [SideMenu]/[Sidebar] -> a vertical rail instead of a top tab bar
  collapsible?: boolean // [SideMenu hamburger] -> hidden behind a ☰ toggle (else static)
}

// Legacy widget row: one or more (Name -> source) groups on a line.
export interface WidgetRowNode extends BaseNode {
  type: 'WidgetRow'
  widgets: { name: string; source: string | null }[]
}

// A widget card header inside a paren row.
export interface WidgetNode extends BaseNode {
  type: 'Widget'
  name: string
}

// A row of widget cards (from outer parens).
export interface RowNode extends BaseNode {
  type: 'Row'
}

// A relational entity declaration ([List Foo] cols).
export interface ListNode extends BaseNode {
  type: 'List'
  name: string
  columns: Field[]
  kind: 'list'
  source: string
}

// A schemaless entity declaration ([Store Foo] cols).
export interface StoreNode extends BaseNode {
  type: 'Store'
  name: string
  columns: Field[]
  kind: 'store'
  source: string
}

// An external API data source ([API] Name) with indented [URL]/[Auth]/[Path]/
// [Map] children. Records are fetched at runtime by the server (which holds the
// secret key — no key ever lives in the document). `url`/`auth`/`path`/`fields`
// are filled in from the children once the tree is built (see parseFMD).
export interface ApiNode extends BaseNode {
  type: 'Api'
  name: string
  url: string | null
  auth: string | null // 'bearer' | 'header:Name' | 'query:Name'
  path: string | null // dot-path to the array
  fields: { field: string; jsonPath: string }[]
  want: string | null // optional natural-language hint of desired fields
}

// A visualization bound to a source ([Table -> X], [Counter -> Y], [Chart -> Z], ...).
export interface VizNode extends BaseNode {
  type: 'Viz'
  viz: string
  crud: string
  source: string | null
  filter: string | null
  spec: string
}

// A generated item ([Count]/[Counts]/[Slide]/[Slides]).
export interface ItemNode extends BaseNode {
  type: 'Item'
  itemKind: string
  items: { label: string; expr: string | null }[]
}

// A button that opens a form or runs an action.
export interface ButtonNode extends BaseNode {
  type: 'Button'
  label: string
  target: string | null
}

// A per-row action button inside a [Table]/[Cases]: [RowButton -> Action] Label
// (alias [RowAction]). Same label/target shape as [Button], but rendered once per
// row in a trailing actions column, with THAT row bound as `this` when it runs.
export interface RowButtonNode extends BaseNode {
  type: 'RowButton'
  label: string
  target: string | null
}

// A form (modal) that creates a record in its source.
export interface FormNode extends BaseNode {
  type: 'Form'
  title: string
  source: string | null
}

// One or more form-field declarations ([Field]/[Fields]).
export interface FormFieldNode extends BaseNode {
  type: 'FormField'
  entries: {
    field: string
    label: string
    required: boolean
    showIf: string | null
    readonly: boolean
    // Auto-fill spec from `[Field -> X]`: a quoted "literal", or a token
    // (CurrentUser, Today, Now). Resolved to a value when the form opens.
    autofill: string | null
    // Layout width in a 3-column grid: 1, 2, or 3 (full). null = full width.
    width: number | null
    // Allowed file types for a [File]/[Files] field, from a trailing `(img, pdf)`
    // list on the field token. Shorthands (img/pdf/…) + bare extensions. null = any.
    accept: string[] | null
  }[]
}

// A repeating line-item grid inside a [Form]: [LineItems -> OrderLines] Item, Qty, Price.
// Each grid row is saved to `source` on submit, linked back to the newly-created
// parent record. Columns parse exactly like [Fields] (same entry shape).
export interface LineItemsNode extends BaseNode {
  type: 'LineItems'
  source: string | null
  cols: FormFieldNode['entries']
}

// A computed total inside a [Form]: [Total] Grand = Subtotal + Tax. `expr` may use
// sum()/avg()/min()/max()/count() over the line-item rows and reference earlier
// totals by name; the result is stored on the parent record on submit.
export interface TotalNode extends BaseNode {
  type: 'Total'
  name: string
  expr: string
}

// A named, reusable rule.
export interface RuleNode extends BaseNode {
  type: 'Rule'
  name: string
  expr: string | null
}

// Role declarations: [Role] Admin / [Roles] Admin, Staff.
export interface RoleNode extends BaseNode {
  type: 'Role'
  names: string[]
}

// A button that opens the user-management window: [User Management] Label.
export interface UserManagementNode extends BaseNode {
  type: 'UserManagement'
  label: string
}

// A permission block. At the top level it holds [Role] declarations; under an
// entity it holds grant lines (Grant or legacy Options).
export interface PermissionNode extends BaseNode {
  type: 'Permission'
}

// A grant line under a [Permission] block: {Role, Role} verb, verb.
export interface GrantNode extends BaseNode {
  type: 'Grant'
  roles: RoleVisibility
  verbs: string[]
}

// A computed per-record field.
export interface CalcNode extends BaseNode {
  type: 'Calc'
  field: string
  expr: string | null
}

// A parent-child aggregate field.
export interface RollupNode extends BaseNode {
  type: 'Rollup'
  field: string
  expr: string | null
}

// A field pulled across a link.
export interface LookupNode extends BaseNode {
  type: 'Lookup'
  field: string
  via: string
  target: string | null
}

// An option-set definition configuring a drop/link field.
export interface OptionsNode extends BaseNode {
  type: 'Options'
  name: string
  where: string | null
  link: { raw: string; source: string; field: string | null } | null
  values: string[] | null
}

// A named, reusable action (a sequence of write steps).
export interface ActionNode extends BaseNode {
  type: 'Action'
  name: string
}

// A record-write step inside an action ([Create]/[Update]/[Delete]).
export interface StepNode extends BaseNode {
  type: 'Step'
  op: string
  source: string | null
  filter: string | null
  assigns: { field: string; expr: string }[]
}

// An outbound integration step inside an [Action]/[Trigger]:
//   [Post -> @connection/path]  (alias [Call])
//     Text = "Hello [[Name]]"
// Calls OUT to a named server-side connection (see server/connections.js). The
// indented assign lines form the request body (evaluated per row, like a
// [Create] step). Executed via POST /api/_call/<connection> so the connection's
// secret key stays server-side and never reaches the client.
export interface PostStepNode extends BaseNode {
  type: 'PostStep'
  op: 'post'
  connection: string // named connection (lowercased)
  path: string // request path appended to the connection's baseUrl
  method: string // HTTP method, default POST
  assigns: { field: string; expr: string }[]
}

// A step in an [Action]/[Trigger]: a record-write ([Create]/[Update]/[Delete])
// or an outbound integration call ([Post]/[Call]).
export type ActionStep = StepNode | PostStepNode

// An automation: when records in `source` match `condition`, run the indented
// steps for each matched record (its [Update]/[Delete] without a source act on
// the matched record; [Create -> X] reads its fields). Evaluated after every
// action and on a periodic sweep. [Trigger -> Source ? condition] Label.
export interface TriggerNode extends BaseNode {
  type: 'Trigger'
  source: string | null
  condition: string | null
  label: string
}

// Top-level [Style] block: theming for the rendered app (page size + colors).
// Its children are `Key: Value` lines (Size, Primary, Background, …).
export interface StyleNode extends BaseNode {
  type: 'Style'
}

// A table footer of column aggregates.
export interface FootNode extends BaseNode {
  type: 'Foot'
  specs: { fn: string; field: string | null }[]
}

// A table sort directive.
export interface SortNode extends BaseNode {
  type: 'Sort'
  field: string
  dir: string
}

// A table group-by directive.
export interface GroupNode extends BaseNode {
  type: 'Group'
  field: string
}

// A [Chart] sub-directive selecting the chart kind: bar | line | pie | donut.
export interface KindNode extends BaseNode {
  type: 'Kind'
  kind: string
}

// A viewer-facing [Search] box above a table: live case-insensitive substring
// match across every displayed column. `placeholder` is the optional inline text.
export interface SearchNode extends BaseNode {
  type: 'Search'
  placeholder: string
}

// A viewer-facing [Filter] Field dropdown above a table: pick one of the field's
// distinct values to narrow the rows (multiple [Filter]s are AND-ed).
export interface FilterNode extends BaseNode {
  type: 'Filter'
  field: string
}

// A single-record view.
export interface DetailNode extends BaseNode {
  type: 'Detail'
  source: string | null
  filter: string | null
  spec: string
}

// A master-detail list: a table of `source` records whose first column links to
// that record's "case" — the children rendered (like a [Display] page) with the
// record as the `this` context. [Cases -> Source ? cond] Col1, Col2, …
export interface CasesNode extends BaseNode {
  type: 'Cases'
  source: string | null
  filter: string | null
  spec: string
}

// Renders a declared [Form]'s fields READ-ONLY (no inputs/buttons) for the
// current record (e.g. inside a [Cases] case). [View -> FormName] Heading.
export interface ViewNode extends BaseNode {
  type: 'View'
  form: string
  label: string
}

// A plain text / fallback line.
export interface TextNode extends BaseNode {
  type: 'Text'
  value: string
}

export type Node =
  | RootNode
  | BlockNode
  | TitleNode
  | AppNameNode
  | MenuNode
  | WidgetRowNode
  | WidgetNode
  | RowNode
  | ListNode
  | StoreNode
  | ApiNode
  | VizNode
  | ItemNode
  | ButtonNode
  | RowButtonNode
  | FormNode
  | FormFieldNode
  | LineItemsNode
  | TotalNode
  | RuleNode
  | RoleNode
  | PermissionNode
  | GrantNode
  | UserManagementNode
  | CalcNode
  | RollupNode
  | LookupNode
  | OptionsNode
  | ActionNode
  | StepNode
  | PostStepNode
  | TriggerNode
  | StyleNode
  | FootNode
  | SortNode
  | GroupNode
  | KindNode
  | SearchNode
  | FilterNode
  | DetailNode
  | CasesNode
  | ViewNode
  | TextNode
