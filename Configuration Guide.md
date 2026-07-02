# FMD Configuration Guide

A practical guide to writing **Functional Markdown** (`.fmd`) — a small language
that describes a screen and its data, and renders directly into a live,
interactive UI. You write the document; the app builds the interface.

This guide assumes no prior knowledge. Read it top to bottom the first time, then
use the **Cheat Sheet** at the end as a reference.

---

## 1. The mental model

An `.fmd` document has two halves:

1. **What you see** — one or more `[Display]` blocks. These are the screens:
   titles, menus, widgets, tables.
2. **What's behind it** — one `[Data]` block. This declares your *entities*
   (the kinds of records) and their *fields*. It is **never drawn** on screen.

> The document describes the **shape** of the app and the **shape** of the data.
> It never contains the actual records — those live in the database and load at
> runtime. You declare `[List Vendors] Name, Status`; you never paste vendor rows
> into the document.

A document looks like this:

```
[Display] Home
  [Title] My App
  [Top Menu Bar] Home, Tasks
  [Main]
    ((Task Count)
        [Counter -> Tasks] Status
            [Count] Buy flowers
    )

[Data]
  [List Tasks] txtName, boolDone
```

---

## 2. Two core rules

**Rule 1 — Structure comes from indentation.** A line's children are the lines
indented beneath it. There are **no closing tags**. Use 2 spaces (or a tab) per
level. Be consistent.

```
[Main]                 <- parent
  [Title] Hello        <- child of [Main]
```

**Rule 2 — Brackets are tags, parentheses are UI cards.**

- `[Tag]` — a structural or data tag.
- `(Name)` — a widget card (see §5).

**Comments.** Anything after a `#` is ignored — a whole line or a trailing note:

```
# this whole line is a comment
[Title] Wedding Planner   # ...and this trailing part is too
```

A `#` only starts a comment at the start of a line or after a space, and never
inside quotes — so `[Field "Issue #5"]` keeps its `#`.

---

## 2a. Theming — `[Style]`

A top-level **`[Style]`** block themes the rendered app (the preview and the
deployed `/app/<slug>`) — not the editor itself. Use **`[Size]`** for the page
width and a **`[Colors]`** sub-block of color tags:

```
[Style]
  [Size] Full
  [Font] Poppins
  [Colors]
    [Primary] #ff5a5f
    [Background] #0d1117
    [Text] #e6edf3
```

**`[Font]`** — the app font. Keywords use built-in stacks (no download):
`System`/`Sans`, `Serif`, `Mono`. There are also curated Google-Font names loaded
automatically: `Inter`, `Roboto`, `Poppins`, `Lato`, `Montserrat`, `Nunito`,
`Open Sans`, `Work Sans`, `Merriweather`, `Playfair Display`, `Source Code Pro`.
Any other name is treated as a Google Font too — an unknown one simply falls back
to a sans-serif.

**`[Size]`** — the content width: **`Compact`** (~760px, narrow/reading),
**`Standard`** (~1100px, the default), or **`Full`** (edge-to-edge, fills the
screen). *(This app-wide `[Size]` differs from a `[Form]`'s own `[Size]`, which
is `Compact`/`Standard`/`Wide` — see §8.)*

**`[Colors]`** (aka **`[Palette]`** / **`[Theme]`**) wraps the color tags. The
palette is deliberately **basic — six keys make a whole theme.** Values can be a
CSS color name (`White`), a `#hex` (the `#` is fine here — it's not treated as a
comment), or a bare hex (`ff5a5f`):

| Canonical tag | What it colors |
|---------------|----------------|
| `[Background]` | the app page background |
| `[Foreground]` | panels + card/widget interiors (the surfaces in front of the background) |
| `[Text]` | body text — **auto-derives** muted text and headings from it |
| `[Lines]` | borders and dividers |
| `[Primary]` | buttons, active tabs, links, the brand accent — **auto-derives** button-text contrast (black vs. white) |
| `[Secondary]` | the secondary accent / highlight |

That's it — muted text, headings, and readable button text are computed from the
six, so you rarely need more. Set only the tags you want; anything omitted keeps
the default dark theme. The style applies to the whole app subtree (no per-page
styling yet).

> **See `THEMES.md` for 5 ready-made themes** you can paste in.

**Back-compat aliases.** Older, finer-grained keys still work but the six above
are canonical: `[Surface]` = `[Foreground]`; `[Card]`/`[Widget]` set just the
card interior; `[Muted]`, `[Heading]`, `[ButtonText]`, and `[Border]` (= `[Lines]`)
override the auto-derived values. Prefer the six basics for new configs.

## 2b. Variables — `[_Name] = value`

Define a **reusable constant** once and reference it anywhere by name — so you
don't repeat the same color, label, condition, or source over and over. A
variable name starts with an underscore; every later `_Name` token is replaced
with its value **before** the document is parsed:

```
[_Accent]   = #ff5a5f
[_Open]     = Status == "Open"
[_Brand]    = Acme Field Service

[Style]
  [Colors]
    [Primary] _Accent
[Display] Orders
  [Title] _Brand
  [Table -> Orders ? _Open] Customer, Total       # reuse the same filter everywhere
```

- The value is everything after `=` (a color, string, condition, number, source…).
- A variable's value may reference **earlier** variables (`[_Hi] = Welcome to _Brand`).
- Substitution is whole-token: `_Brand` is replaced, but `My_Brand` is left alone.
- Definition lines aren't rendered — they just feed the expansion.

## 3. Pages and navigation

Each top-level **`[Display] Name`** block is a **page**. The **`[Top Menu Bar]`**
lists tab names; clicking a tab shows the `[Display]` whose name matches.

```
[Display] Home
  [Top Menu Bar] Home, Schedule
  [Title] Wedding Planner
  [Main]
    ...widgets for the Home page...

[Display] Schedule
  [Table -> Schedule] Time, Activity
```

- Only the **active page** is shown.
- The menu **persists** on every page (so you can always navigate). Declare
  `[Top Menu Bar]` once — it carries across all pages automatically.
- A tab with **no matching `[Display]`** (e.g. an "Inventory" tab with no
  `[Display] Inventory`) shows a friendly "create this page" placeholder — that's
  your cue to add the page.
- A single, unnamed `[Display]` (no name after it) also works, for a one-page app.

**Vertical nav — `[SideMenu]`.** Swap `[Top Menu Bar]` for **`[SideMenu]`**
(aliases `[Sidebar]`, `[Side Menu]`) to render the exact same comma-separated page
list as a **vertical rail down the left**, with the page content in a right-hand
column, instead of a top tab strip. On phones it collapses back to the tab strip
automatically.

```
[SideMenu] Dashboard, Orders, Settings
```

By default the rail is **static** (always visible). Add a **`hamburger`** flag to
hide it behind a ☰ button that pops it out as a drawer (giving the content full
width) — clicking a page navigates and closes it. `static` is also accepted to be
explicit.

```
[SideMenu hamburger] Dashboard, Orders, Settings
[SideMenu static] Dashboard, Orders, Settings
```

**Recognized structural tags**

| Tag | Meaning |
|-----|---------|
| `[App Name] text` | The app's global title (shown on top, above the pages). Renaming it **fully rewrites the database** — see §13. |
| `[Display] Name` | A page. The root of what is rendered. |
| `[Title] text` | A heading. Supports inline `**bold**` / `*italic*`. |
| `[Text] text` | A paragraph of body text. Supports inline `**bold**` / `*italic*` (and `[[Field]]` in a case). |
| `[Top Menu Bar] a, b, c` | Navigation tabs (also `[TopMenu]` / `[Menu]` / `[Nav]`). |
| `[SideMenu] a, b, c` | A vertical left nav rail (also `[Sidebar]` / `[Side Menu]`). |
| `[Main]` | The main content area (holds widget rows). |
| `[Data]` | The data model. **Never rendered.** |
| `[AnyOther]` | A generic container or labeled element. |

---

## 4. Laying out widgets: rows and cards

Inside `[Main]`, **parentheses build the layout**:

- An **outer `( … )`** groups widgets into **one horizontal row**.
- Each **`(Name)`** inside is a **widget card** with that title.
- Indented under a card is its **visualization** (§5).

The outer row opens with `((` (the first `(` opens the row, the second begins the
first card) and closes with a lone `)`:

```
[Main]
  ((Schedule Timeline)              <- row opens, first card
      [Table -> Schedule] Time, Activity
   (Inventory Counts)               <- second card, same row
      [Counter -> Inventory] Category
          [Count] Folding Chairs
  )                                 <- row closes
  ((Vendor Checklist)               <- a new row
      [Checklist -> Vendors] Name / Status
  )
```

Result: two cards side by side in the first row, one card in the second.

> **Best practice — group with `( )` cards (but don't over-card).** A card
> supplies the padding around a view, so wrap tables/checklists/etc. in a
> `(Card)`. **Buttons are the exception:** a card containing only buttons
> renders as a compact **action bar**, not a full card — so group *all* of a
> screen's buttons into **one** `(Actions)` card instead of a card per button
> (one card per button wastes space):
>
> ```
> ((Actions)                         # collapses to a slim button bar
>     [Button -> New Event] New Event
>     [Button -> New Vendor] New Vendor
> )
> ((Schedule)                        # a real card around the table
>     [Table -> Schedule] Time, Activity
> )
> ```
>
> A "New …" button that belongs to a specific view can also sit inside that
> view's card (above its table).

**`( )` and `[ ]` are interchangeable for a view.** `(Table -> Schedule)` renders
the same table as `[Table -> Schedule]` — any viz keyword works in parentheses
(`(Board -> X)`, `(Calendar -> X)`, …). The difference: the `[ ]` form takes a
column spec after the bracket (`[Table -> X] ColA, ColB`); the bare `( )` form
shows all columns. Use a `((Card))` wrapper only to put a **titled card** around a
view. A `(Name -> source)` whose name **isn't** a viz keyword (e.g.
`(Inventory Counts -> inventory)`) **doesn't render** — a view needs an explicit
viz keyword. Write `(Counter -> inventory)` (or any of the seven keywords), not a
bare descriptive name, to draw a visualization.

---

## 5. Visualizations

A visualization is a `[Tag -> Source]` placed under a card. The **binding lives
inside the brackets** (`-> Source`), and the source is an entity from `[Data]`.

There are **six** core kinds — `table`, `counter`, `checklist`, `slider`,
`board`, `calendar` — plus a seventh, **`[Chart]`** (below). Each adapts to the
records of its bound source.

### `[Table -> Source] colA, colB`
A table. The spec is the comma-separated **columns** to show. Shows every record.

```
[Table -> Schedule] Time, Activity
```

**Sort, group & totals.** A table accepts three **indented sub-directives**
(their own lines beneath it, keeping the binding clean):

```
[Table -> WorkOrders] Ticket, Customer, Total
    [Sort] Date desc            # order rows; `asc` (default) or `desc`
    [Group] Status              # collapse into sections, one per value, with a count
    [Foot] sum Total, count     # a footer row of column aggregates
```

- `[Sort] Field [asc|desc]` — sorts rows by a column (numbers numerically, text
  alphabetically; computed `[Calc]` columns work too).
- `[Group] Field` — splits the table into labelled sections by that field's
  value. With a `[Foot]` present, each group also gets a **subtotal** row.
- `[Foot] fn Field, …` — a footer of aggregates: `sum`/`avg`/`min`/`max Field`,
  or bare `count`. Each lands under its column; `count` sits in the first column.

**Viewer search & filter.** Two more indented sub-directives add *reader-facing*
controls above the table (they narrow the visible rows on the client, **before**
sort/group/`[Foot]` — so subtotals reflect what's shown):

```
[Table -> Orders] Customer, Status, Total
    [Search] Find an order…       # a text box; substring-matches ANY column
    [Filter] Status               # a dropdown of Status's distinct values
    [Filter] Customer             # a second filter — multiple [Filter]s AND together
```

- `[Search]` — a live text box that substring-matches across every column.
  Trailing text is a custom placeholder (default `Search…`).
- `[Filter] Field` — a dropdown listing that column's distinct values (`All …`
  plus each value). Stacking `[Filter]` lines narrows by all of them at once.

**Per-row buttons — `[RowButton]`.** Indent a `[RowButton -> Action] Label`
(alias `[RowAction]`) under a `[Table]` (or `[Cases]`) to add a small button on
**every row** that runs the named `[Action]` (§9) with **that row bound as
`this`**. Destructive (delete) actions auto-confirm before running.

```
[Table -> Orders] Customer, Status, Total
    [RowButton -> Approve Order] Approve       # one Approve button per row

[Action] Approve Order
    [Update] Status = "Approved"               # no -> source: acts on THIS row
```

Because each button carries its own row as `this`, the `[Update]`/`[Delete]`
steps default to that record (exactly like a `[Trigger]` step, §9a) — no `?`
filter needed to target the clicked row.

### `[Counter -> Source] SubField`
Stat cards. You **list which records to show** with `[Count]` items (§6); each
card shows that record's number, with `SubField` as a small sub-label.

```
[Counter -> Inventory] Category
    [Count] Folding Chairs
    [Count] Round Tables
```

### `[Checklist -> Source] Label / Status`
An interactive checklist. The spec is `labelField / statusField`. Shows every
record.

```
[Checklist -> Vendors] Name / Status
```

### `[Slider -> Source] Label Spent / Cap`
Progress bars. The spec is `labelField spentField / capField`. You list which
records to show with `[Slide]` items (§6).

```
[Slider -> Budget] Category Spent / Cap
    [Slide] Venue
    [Slide] Catering
```

### `[Board -> Source] GroupField`
A kanban board: one column per distinct value of `GroupField` (its dropdown
options become the column order, if it's a `drop` field), with a card per record.

```
[Board -> WorkOrders] Status
```

### `[Calendar -> Source] DateField`
A month calendar placing each record on its `DateField` day.

```
[Calendar -> Appointments] Date
```

### `[Chart -> Source] LabelField / ValueField`
A chart. The spec is `labelField / valueField`; the chart **aggregates (sums) the
numeric value by label**, so duplicate labels merge into one bar/slice. Add an
indented **`[Kind]`** to choose the shape — `bar` (default), `line`, `pie`, or
`donut` — and an optional **`[Sort]`** (by the value field, else alphabetically
by label). Renders as dependency-free inline SVG that follows your theme colors.

```
[Chart -> Sales] Month / Total
    [Kind] bar
    [Sort] Total desc          # order by value; omit for source order

[Chart -> Sales] Region / Total
    [Kind] donut               # pie / donut get a legend of label + value
```

> **A visualization needs an explicit `-> Source`.** Without it, it renders empty.
> Any view can also take a `? condition` to filter its rows (see §12).

### `[Detail -> Source] colA, colB`

A **single-record** view: a record picker, the chosen record's fields, then any
**nested views** beneath it. Inside a nested view's `? condition`, the token
`this` refers to the chosen record — so a detail can show a record together with
its related children:

```
[Detail -> WorkOrders] Ticket, Customer, Total
    [Table -> WorkOrderItems ? Ticket == this] Description, LineTotal
    [Table -> Payments ? WorkOrder == this.Ticket] Date, Amount
```

- The spec lists the **header fields** to show (computed/lookup fields included).
- A dropdown at the top chooses which record (defaults to the first).
- `this` resolves to the chosen record: a bare `this` means "the parent's value
  of the field on the other side of the comparison" (`Ticket == this` → the
  parent's `Ticket`); `this.Field` reads a named field explicitly.

### `[Cases -> Source] colA, colB` — a master-detail list

A **`[Cases]`** view is a **table** of records whose **first column is a link**.
Clicking it opens that record's **"case"** — a full drill-in page built from the
`[Cases]` block's indented children (anything a `[Display]` has), with `this`
bound to that record. A **← Back** returns to the list.

```
[Cases -> Users] Name, Email, Status
    [View -> Edit User] Profile                  # read-only form of this user
    [Title] [[Name]]'s tickets                   # [[Field]] inlines a value (see below)
    (Table -> Tickets ? Owner == this)           # nested view scoped to the case
```

It's `[Detail]` turned inside-out: instead of a dropdown picker, you pick a record
by clicking it in a table, and the detail is a drill-in page rather than inline.
The same `this` rules apply to nested views. An indented **`[Sort] Field [desc]`**
orders the list (just like in a `[Table]`), and a **`[RowButton]`** (above) adds a
per-row action button to it too.

### `[View -> FormName]` — a form as read-only info

Renders a declared **`[Form]`'s fields read-only** (label + value, no inputs or
buttons) for the **current case record**. Use it inside a `[Cases]`/`[Detail]` to
show a record's details with the same field layout as its edit form. Optional
trailing text is a heading.

### `[[Field]]` — inline a field's value as text

Inside a case, write **`[[FieldName]]`** in any `[Title]`, `[Text]`, or label and
it's replaced with that record's value — e.g. `[Title] [[Name]]'s tickets`. A
missing field renders empty; outside a case the token is left as-is.

---

## 6. Generated items: singular vs. plural

`[Counter]` and `[Slider]` are driven by **item tags** that name which records to
display. Items come in two forms:

- **Singular** — one item: `[Count] Venue`
- **Plural** — a generator that expands a comma list into many:
  `[Counts] Photography, Flowers` is the same as writing `[Count] Photography`
  and `[Count] Flowers`.

| Singular | Plural (generates many) | Used by |
|----------|-------------------------|---------|
| `[Count] Label` | `[Counts] A, B, C` | `[Counter]` |
| `[Slide] Label` | `[Slides] A, B, C` | `[Slider]` |

**How an item finds its value:** the item's text is matched to a record by that
source's label/name field, and the matching record supplies the number.
`[Slide] Venue` finds the `Budget` row whose category is "Venue" and draws its
`Spent / Cap` bar. So your item labels should match real values in the data.

**Aggregate (KPI) items** — instead of matching a label, a `[Count]` item can be
a live aggregate over an entity, which is far more robust than hand-keyed labels:

```
[Counter -> KPIs]
    [Count] Open Tickets = count(WorkOrders ? Done == False)
    [Count] Revenue = sum(Payments Amount ? Status == Paid)
```

Functions: `count`, `sum`, `avg`, `min`, `max`. Form: `fn(Entity [Field] ? cond)`
— `count` needs no field; the others aggregate that field. The number recomputes
from the data, so the dashboard is never stale.

---

## 7. Interactive tables (CRUD)

Add a **CRUD-letter prefix** to `Table` to make it editable, spreadsheet/Notion
style. Combine letters in any order.

| Prefix letter | Enables |
|---------------|---------|
| `c` | **Create** — a faux empty bottom row; type across it and press Enter to add |
| `u` | **Update** — cells become inline-editable; edits save on blur/Enter |
| `d` | **Delete** — a per-row delete (×) control |
| `r` (or none) | **Read** — display only |

Examples:

```
[cTable -> Schedule] Time, Activity      # can add new rows
[uTable -> Schedule] Time, Activity      # can edit cells
[udTable -> Vendors] Name, Status        # edit + delete
[cudTable -> Vendors] Name, Status       # full create/update/delete
```

Edits, additions, and deletions are written straight to the database. (The combo
is just letters before `Table`; `e` is **not** a CRUD letter — update+delete is
`udTable`.)

> **Prefer buttons + forms for everyday data entry.** A focused `[Button]` that
> opens a `[Form]` (§8) is calmer and clearer for end users than an editable
> grid: it shows one labeled field at a time, validates types, and avoids
> accidental edits. Reach for CRUD-prefixed tables mainly in **admin / back-office
> views** — places where someone needs to scan and edit many rows quickly and
> thoroughly. Rule of thumb: **user-facing screens → buttons + forms; admin
> screens → `cudTable`.** A plain read-only `[Table]` is great anywhere you just
> need to show records.

---

## 8. Forms & buttons

A **form** is a modal for creating records; a **button** opens it.

### Defining a form

Declare a form at the **top level** — a sibling of `[Display]` and `[Data]`, not
inside a page. It binds to the entity it creates records in:

```
[Form -> Schedule] New Event
    [Field "Start of Event"] Time
    [Fields] Activity, Vendor
```

- `[Form -> Source] Title` — a modal titled `Title` that inserts a record into
  `Source` on submit.
- `[Field "Label"] field` — one input. The **quoted string is the label**; the
  token after the brackets is the data field it writes (here, `Time`).
- `[Fields] a, b, c` — shorthand for several inputs at once; each label is just
  the field name. (Singular vs. plural, like `[Count]`/`[Counts]`.)

**Form width — `[Size]`.** Indent a `[Size]` line under a `[Form]` to set the
modal's width: `Compact`, `Standard` (default), or `Wide`. Pair a `Wide` form
with field widths (above) to lay several inputs across each row:

```
[Form -> Orders] New Order
    [Size] Wide
    [Fields] 1Customer, 1Status, 2Notes
```

**Required fields** — prefix the field name with `!`. Submit is blocked until
every required (and visible) field is filled:

```
[Fields] !Name, Phone            # Name required, Phone optional
[Field "Email"] !Email           # also works on a single field
```

**Conditional fields** — add a `(condition)` after the label to show the field
only when the condition is true (evaluated against the form's current values):

```
[Form -> WorkOrderItems] Add Item
    [Field "Item Type"] ItemType
    [Field "Discount" (ItemType == Discount)] !DiscountAmount   # shows only for discounts
```

Hidden fields aren't submitted and aren't required while hidden.

**Read-only fields** — prefix the field name with a lowercase `r` (followed by
the Capitalized name) to show a value the user can't edit. Combines with `!`:

```
[Field] rDescription             # shown, not editable
[Field "Internal"] !rNote        # required + read-only (paired with auto-fill below)
```

**Auto-fill** — bind a field with `-> value` and it's pre-populated when the form
opens. Pair with `r` to lock it. The value is either a token or a quoted literal:

```
[Field -> CurrentUser] rSubmittedBy   # the signed-in user's name (dev mode: blank)
[Field -> "Accepted"] rStatus         # a literal string
[Field -> Today] rDate                # today's date (also: Now = timestamp)
```

Tokens: `CurrentUser`, `Today`, `Now`. Anything in `"quotes"` (or a bare word) is
a literal. Auto-filled values are submitted like any other field.

**File fields — `(allowed types)`.** A `file`/`files` field (§10) renders as an
upload picker with thumbnail previews. Add an allowed-types list right after the
field to restrict what can be picked — `img` (any image), `pdf`, or bare
extensions like `png`, `docx`, `csv`; omit it to allow anything:

```
[Fields] Title, Attachment (img, pdf), Photos (img)
```

**Field widths — a leading `1`/`2`/`3`.** Prefix a field with a digit to set how
many columns it spans in a **3-wide grid**: `1` = a third, `2` = two-thirds, `3`
(or no digit) = full width. It combines with `!` (required) and `r` (read-only)
in any order:

```
[Fields] 1First, 1Last, 2Email, 3Notes   # two thirds share a row, then full rows
[Field "Phone"] !1Phone                  # required + one-third wide
[Field] 3rNotes                          # full-width + read-only
```

Widths work in `[Field]`/`[Fields]`, in a **`[Detail]` spec column**
(`[Detail -> Orders] 1Ticket, 1Customer, 2Notes`), and in the read-only
**`[View]`** panel (which mirrors the form's own layout).

Each input renders by the field's declared type: a `drop` field becomes a
dropdown, a `link` field becomes a relationship picker (filtered by its `?`
rule), everything else is a text box. **Submit** creates the record and the UI
refreshes; **Cancel** closes the modal.

### Opening a form with a button

```
[Button -> Event] New Event
```

`[Button -> target] Label` renders a button. Clicking it opens a form, matched
by the button's **label** first (`New Event` = the form's title), then its
`-> target`. Put a button anywhere a view can go — inside a widget card, or
directly on a page.

Putting it together:

```
[Display] Home
  [Main]
    ((Schedule)
        [Button -> Event] New Event       # opens the form below
        [Table -> Schedule] Time, Activity

[Form -> Schedule] New Event              # top-level modal
    [Field "Start of Event"] Time
    [Fields] Activity, Vendor
```

---

## 9. Actions — buttons that write data

A **form** creates one record from user input (§8). An **action** is the other
thing a button can do: run a named, fixed sequence of **writes** on click — no
modal, no typing. Reach for it for one-tap operations like "Approve all", "Mark
ready", or "Archive completed".

### Defining an action

Declare an action at the **top level** (a sibling of `[Form]` and `[Display]`),
then list its steps indented beneath it:

```
[Action] Approve All Vendors
  [Update -> Vendors ? Status == False] Status = true
```

Run it from a button whose `-> target` (or label) names the action:

```
[Button -> Approve All Vendors] Approve All Vendors
```

A `[Button]` opens a `[Form]` when its target is a form (§8); when the target is
an **action**, the same button runs it instead (actions are matched first). Put
the button anywhere a view can go — on a page or inside a widget card.

### The three write steps

Each step targets an entity with `-> Source` and runs against the database in
order, top to bottom. When all steps finish, the UI refetches so every view
reflects the writes.

```
[Create -> Schedule] Activity = "Setup", Time = now      # insert one new record
[Update -> Vendors ? Status == False] Status = true      # patch all matching rows
[Delete -> Drafts ? Stale == True]                       # remove all matching rows
```

- `[Create -> Source] Field = value, …` — inserts **one** record with the given
  field values.
- `[Update -> Source ? cond] Field = value, …` — sets those fields on **every**
  row matching `cond`.
- `[Delete -> Source ? cond]` — deletes **every** row matching `cond`.

The `? condition` uses the same rules engine as view filters and `[Rule]`s
(§10), and it is the **safety**: it chooses which rows a step touches. An
`[Update]` or `[Delete]` **with no `? condition` matches every row** in the
source — always filter unless you truly mean "all".

### Values

The right-hand side of `Field = value` is evaluated per row:

- **Literals** — `"a string"`, `42`, `true` / `false`.
- **Dates** — `today` and `now`, with day math: `today + 7`, `now - 1`.
- **Another field** — a bare field name copies that field's current value
  (`Status = PriorStatus`).
- **Arithmetic** — `+ - * / ( )` over the row's numeric fields, exactly like
  `[Calc]` (§10): `Count = Count + 1`, `Total = Qty * UnitPrice`.

### What it deliberately doesn't do (yet)

- **No per-row context.** A button sits on a page, not on a table row, so a step
  acts on whatever its `?` filter selects — there is no implicit "this row".
  (A **`[Trigger]`** — next section — *does* give steps a per-record context.)
- **Writes need the backend.** Like every data write, steps hit the API/database;
  with the offline `data.json` fallback (no API running) they have nowhere to go.

To run steps **automatically** (when a condition becomes true, not on a click),
use a `[Trigger]` instead of a `[Button]` — see the next section.

---

## 9a. Triggers — run steps automatically

A **trigger** runs steps on its own when records match a condition — no button.
Use it for automations like "flag overdue checkouts" or "archive closed tickets".

```
[Trigger -> Checkouts ? DueDate < today && Overdue == False] Mark overdue
    [Update] Overdue = True
    [Create -> OverdueLog] Item = Title, Due = DueDate
```

- `[Trigger -> Source ? condition] Label` — declare it at the **top level** (a
  sibling of `[Data]`/`[Action]`). It scans `Source` and, for **each record**
  matching `condition`, runs the indented steps with that record as context.
- **Steps default to the matched record.** Under a trigger, an `[Update]` or
  `[Delete]` with **no `-> source`** acts on the matched record itself; a
  `[Create -> Other]` (or any step naming a source) writes there, reading the
  matched record's fields (`Item = Title` copies the checkout's Title).
- Steps, values, and the `? condition` work exactly as in §9.

**When triggers fire:** the **server** evaluates every trigger on a **60-second
sweep** — so a time-based condition like "past due" fires within a minute of
becoming true **even when nobody has the app open** (it runs against the editor's
data and every deployed `/app/<slug>`). They also run **right after each action**
(the app pokes the server, then refetches), so effects show immediately while
you're using it. *(Editor triggers fire only after you **Save → rebuild DB**,
which is when they're sent to the server.)*

**Make conditions self-limiting** so a trigger doesn't re-fire forever: include a
guard the trigger itself clears. Above, `&& Overdue == False` means once a row is
flagged it no longer matches — so it's marked, and logged, exactly **once**.

---

## 10. The data model — `[Data]`

The `[Data]` block declares your entities. There are two kinds, and **the kind
you choose decides where it's stored** — you never write "SQL" or "NoSQL":

| Declaration | Becomes | Use for |
|-------------|---------|---------|
| `[List Name] fields` | a **relational table** (typed columns) | regular, tabular data |
| `[Store Name] fields` | a **JSONB document collection** | schemaless / varied-shape records |

```
[Data]
  [List Schedule] txtTime, txtActivity
  [Store Inventory] txtTitle, txtCategory, numCount, curPrice
  [List Vendors] txtName, boolStatus
```

### Field type prefixes

Every field name carries a short **type prefix**. The prefix sets the column
type; the rest is the field's display name.

| Prefix | Type | `numCount` → name | column type |
|--------|------|-------------------|-------------|
| `txt` | text (single line) | `txtTime` → **Time** | text |
| `memo` | large/multi-line text | `memoNotes` → **Notes** | text (renders a textarea) |
| `num` | number | `numCount` → **Count** | numeric |
| `cur` | currency | `curPrice` → **Price** | numeric(12,2) |
| `bool` | boolean | `boolDone` → **Done** | boolean |
| `date` | date | `dateDeadline` → **Deadline** | date |
| `drop` | dropdown | `dropCategory` → **Category** | text (+ option list) |
| `link` | relationship | `linkVendor` → **Vendor** | text (+ linked entity) |
| `msel` | multi-select | `mselTags` → **Tags** | text (+ option list) |
| `file` | a single file upload | `fileResume` → **Resume** | json descriptor |
| `files` | several file uploads | `filesPhotos` → **Photos** | json descriptor list |

**Multi-word field names:** only the **first** word needs the prefix —
`txtRelated Vendor` → the single field **"Related Vendor"**. Prefixing every word
(`txtRelated txtVendor`) works but is redundant. Prefer **single-word names**
where you can (`txtWorkOrder`) — they're simpler and avoid edge cases.

No prefix? The field is treated as text.

**How each type renders:** `cur` → `$8,000.00`, `date` → `Jun 25, 2026` (date
picker on input), `bool` → a **Yes/No checkbox** when editable, `drop` →
dropdown, `link` → relationship picker, `msel` → checkbox chips, `memo` → a
multi-line **textarea** (resizable). Use `memo` for descriptions, notes,
addresses — anything longer than a single line; plain `txt` is a one-line input.
You store the raw value; the UI formats/edits it by type. In **read contexts** —
`[Detail]`, `[Cases]`, and `[View]` — a `bool` renders as a colored **Yes/No
pill** (green/grey) rather than a checkbox.
(Editable cells show the formatted value and reveal the raw value when clicked.)

### File uploads — `file` / `files` fields

Two more prefixes let a record carry **uploaded files** — a résumé, a photo, a
signed PDF. `file` holds **one** file; `files` holds **several**. Declare them in
`[Data]` exactly like any other field:

```
[List Docs] txtTitle, fileAttachment, filesPhotos
```

**Use it in a form.** Reference the field by its plain display name (the FMD
convention — `Attachment`, not `fileAttachment`; a prefixed name works too), and
add an optional **`(allowed types)`** list right after it to restrict the picker:

```
[Form -> Docs] Add Doc
    [Fields] Title, Attachment (img, pdf), Photos (img)
```

- The `(…)` list restricts the file picker **and** validates the choice. It
  accepts `img` (any image), `pdf`, or bare extensions like `png`, `jpg`,
  `docx`, `csv`. **Omit it to allow any type.**
- This is the same field the read views (`[Table]`, `[Cases]`, `[Detail]`,
  `[View]`) render — see below.

**Upload.** The input is a picker with **live thumbnail previews** (images) or
**named links** (PDF/other). A `file` field shows **Replace**; a `files` field
shows **+ Add file** so you can stack several. Each attached file has a remove
(×).

**View (read contexts — `[Table]`, `[Cases]`, `[Detail]`, `[View]`).** Files
render as image thumbnails plus clickable names. When a `files` field holds **2+
files**, a small viewer toggle switches between **cards** (a thumbnail grid, the
default) and a **list** (rows with name + download). *(In table cells the toggle
is hidden to save space.)*

**Download.** Every file is a link — images open inline, PDFs and other types
download.

**Under the hood — a few honest notes:**

- Files are stored **server-side in Postgres**; the record itself only holds a
  small `{id, name, mime}` descriptor.
- Uploading requires **sign-in** on a deployed app (anonymous upload is blocked).
  The editor author can upload while building.
- **Downloads are permission-checked.** Each file remembers the entity it was
  uploaded under, and a download re-checks the viewer's **read** permission on
  that source — the *same* check the source's records use. So a document is
  exactly as accessible as the record it belongs to: give `read` on the source
  to the roles who may see its files. (Because a browser can't send an auth
  header on an `<img>`, files are fetched through the authenticated app, not a
  bare URL.) A file uploaded outside a form — with no owning source — stays an
  unguessable capability link.
- **Limits:** ~25 MB per file. Best for images, PDFs, and documents.

### Computed fields — `[Calc]`

A field can be **computed** from other fields on the same record. A `[Calc]` line
**declares its own field** — you don't need to also list it in the entity header
(the same as `[Rollup]` and `[Lookup]`). A `[Calc]` can yield a **string, date, or
number**, so an auto-created Calc field defaults to **text** (it shows the
computed value as-is). List the field in the header **only** to pin a
type/format — `curLineTotal` for currency, `dateDue` for a date. (A `[Rollup]` is
always a numeric aggregate, so it defaults to a number.)

```
[Store WorkOrderItems] numQty, curUnitPrice
  [Calc] LineTotal = Qty * UnitPrice          # LineTotal is created automatically

[Store Invoices] curTotal                     # declare curTotal to format it as currency
  [Calc] Total = Subtotal + Tax
```

A `[Calc]` does more than arithmetic — it can build a label, age a date, or
branch:

```
[Calc] Vehicle  = Year + " " + Make + " " + Model     # string concatenation
[Calc] DaysOpen = today - Date                         # date difference (in days)
[Calc] Due      = Date + 7                             # date + N days -> a date
[Calc] Tier     = if(Total > 1000, "VIP", "Standard")  # conditional (or Total > 1000 ? "VIP" : "Standard")
```

- **Numbers** — `+ - * / ( )`.
- **Strings** — `+` concatenates when either side is text; helpers `upper()`,
  `lower()`.
- **Dates** — `today`/`now`; `date - date` → whole days; `date + N` / `date - N`
  → a shifted date.
- **Comparisons & logic** — `== != < <= > >=`, `&&`, `||`, used inside
  `if(cond, a, b)` or a `cond ? a : b` ternary. `round()` rounds a number.

Operands are numbers, `"strings"`, or **single-word** field names. The value is
computed live (read-only — it shows as `auto` in entry rows), so it never goes
stale.

### Roll-ups — `[Rollup]` (parent totals from children)

A `[Rollup]` aggregates a **child entity's rows** onto a parent row, using the
relationship the child already declares with a `link`. Declare the field, then
add a `[Rollup]` line under the **parent**:

```
[List WorkOrders] txtWorkOrder, ..., curTotal
  [Rollup] Total = sum(WorkOrderItems LineTotal)

[Store WorkOrderItems] linkWorkOrder, dropType, numQty, curUnitPrice, curLineTotal
  (WorkOrder) -> WorkOrders WorkOrder      # this link IS the join
  [Calc] LineTotal = Qty * UnitPrice
```

Same functions as KPI items (`count`/`sum`/`avg`/`min`/`max`); form
`fn(ChildEntity Field)`. The engine scopes to children whose link points back to
the current row — no join syntax. Refinements:

- **Filter children** — reuse `?`: `sum(WorkOrderItems LineTotal ? Type != Discount)`.
- **`via`** — when a child links to the parent more than one way, name the child's
  link field: `sum(WorkOrderItems LineTotal via WorkOrder)`.
- **Chaining** — a child `[Calc]` feeds a parent `[Rollup]` (the example above:
  `Total` sums each item's computed `LineTotal`).

Read-only (`auto` in entry rows). Empty children → `0` for `count`/`sum`, blank
for `avg`/`min`/`max`. Model fees and tax as line-item rows and the rollup *is*
the correct total — no hardcoded rates.

> **Join caveat:** the link matches on the parent's *display value* (e.g. the
> `WorkOrder` number), so that field must be **unique per parent** for the rollup
> to attach the right children.

### Lookups — `[Lookup]` (pull a value across a link)

Where `[Rollup]` aggregates *many* children onto a parent, a `[Lookup]` pulls a
*single* field from the entity a row **links to** — e.g. show a customer's phone
on each work-order row without re-typing it. Add it under the entity that has the
link:

```
[List WorkOrders] txtTicket, linkCustomer, curTotal
  (Customer) -> Customers Name          # the link being followed
  [Lookup] CustomerPhone = Customer.Phone
```

`[Lookup] Name = LinkField.TargetField` — `LinkField` is a `link` field on this
entity; `TargetField` is a field on the entity it points at. The name becomes a
referenceable (read-only) field you can put in any table column. It resolves per
row at render time (so it isn't sortable/groupable/totalled like a stored field).

### Dropdowns, relationships, and option lists

`drop` and `link` fields get their choices from an **option line** placed in
`[Data]` directly **below the entity** that owns the field. Two forms:

```
[List Budget] dropCategory, curSpent, curCap, dateDeadline
  (Category) Venue, Catering, Photography, Flowers      # static dropdown options

[List Schedule] txtTime, txtActivity, linkVendor
  (Vendors) -> Vendors Name                             # options from another entity
```

- `(FieldName) a, b, c` — a **static dropdown**: the listed values are the choices.
- `(Name) -> Source Field` — a **relationship**: choices are pulled live from the
  `Source` entity, showing its `Field` (e.g. each Vendor's `Name`).

The option line may be either a **sibling** of the entity or **indented under
it** — both bind to the entity above:

```
[List Appointments] linkCustomer, dropStatus
  (Customer) -> Customers Name        # indented under the entity — fine
  (Status) Scheduled, Completed       #   "
```

A `Source` may be multi-word (`-> Work Orders Work Order` resolves to the
`Work Orders` entity, field `Work Order`), but single-word entity names are
simpler and less error-prone.

The `(Name)` binds to a `drop`/`link` field of the entity right above it (matched
by name, singular/plural tolerant — `(Vendors)` configures the `Vendor` field).
In an **editable table** (`u`/`c`), these fields render as a real dropdown /
relationship picker.

### Filtering options — the rules engine

Append `? condition` to an option line to filter the choices with JS-like logic:

```
(Vendors) -> Vendors Name ? Status == True       # only confirmed vendors
```

Operators: `==  !=  <  <=  >  >=` combined with `&&` and `||`. Operands are field
names (looked up on each record) or literals (`"text"`, numbers, `true`/`false`).
A bare word that isn't a field is treated as text, so `ItemType == Discount`
works without quotes. Booleans are smart about "yes" values, so `Status == True`
also matches `Confirmed`/`Done`/`Paid`. A malformed rule simply lets everything
through.

**Dates & time.** `today` and `now` are reserved operands, with day arithmetic
(`+ N` / `- N` days). Dates compare by day:

```
[Table -> Appointments ? Date == today] Time, Customer
[Table -> Compliance ? Due <= today + 7] Item, Due      # due within a week
```

The **same condition syntax works in three places**:

```
[Slider -> Budget ? Spent < Cap] Category Spent / Cap   # 1. filter VIEW rows
(Vendors) -> Vendors Name ? Status == True              # 2. filter option choices
[Field "Discount" (ItemType == Discount)] Amount        # 3. show-if on a form field
```

- **View filter** — `[Viz -> Source ? condition]` shows only matching rows.
  e.g. `[Checklist -> WorkOrders ? Done == False]` = only open work orders.

### Named rules

Define a reusable rule at the **top level** and use it by name anywhere a
condition is accepted — keeps logic in one place:

```
[Rule] IsOpen (Done == False)
[Rule] IsApprovedVendor (Status == True)

[Display] Work Orders
  [Main]
    ((Open)
        [Checklist -> WorkOrders ? IsOpen] WorkOrder / Done
    )
```

`? IsOpen` resolves to `Done == False`. Named rules work in view filters, option
filters, and form show-if conditions alike.

### External data — `[API]`

An **`[API]`** block declares a data source backed by an external REST endpoint
instead of your database. It registers like any entity — bind views to it by name
(`[Table -> Products]`) — but its rows are fetched live through the app's server
proxy. Declare it at the **top level** (a sibling of `[Data]`), or inside
`[Data]`, with indented sub-tags:

```
[API] Products
    [URL]  https://api.example.com/v1/products
    [Auth] Bearer                       # how the server attaches the secret key
    [Path] data.items                   # dot-path to the array in the response
    [Map]  Name  = title                # FMD field  <-  JSON dot-path
    [Map]  Price = pricing.amount
    [Want] 50                           # optional: how many records to pull
```

- `[URL]` — the endpoint to call.
- `[Auth]` — the auth scheme the **server** uses to attach the credential.
- `[Path]` — the dot-path to the record array inside the JSON response.
- `[Map] Field = json.dot.path` — one per field; the left side becomes a
  referenceable (text) field, the right reads from each JSON record.
- `[Want]` — an optional record count.

The **secret key never lives in the document** — it stays server-side and is
injected by the `/api/_ext` proxy. The mapped fields are what your views and the
linter can reference. *(In the editor, the ⚙ wizard helps fill these in.)*

---

## 11. Roles & permissions

Roles control two things: **who can read/write data** (server-enforced) and
**which elements are visible** (in the UI).

### Declaring roles — `[Permissions]`

Declare the roles your app uses in a top-level `[Permissions]` block:

```
[Permissions]
  [Role] Admin
  [Role] Supervisor
  [Role] Viewer
```

Or declare several at once with **`[Roles] A, B, C`** — `[Roles] Admin,
Supervisor, Viewer` is the same as three `[Role]` lines.

These are the roles that appear when you assign users (see *User management*
below) and that you reference everywhere else.

### Granting CRUD — `[Permission]` inside `[Data]`

Grant access per entity with `{Role} verbs` lines in a `[Permission]` block under
the entity. The four verbs are **Read, Create, Update, Delete**, and each accepts
synonyms so grants read naturally:

| Verb | Synonyms |
|------|----------|
| Read | `read`, `view`, `list`, `see` |
| Create | `create`, `write`, `add`, `insert`, `new` |
| Update | `update`, `modify`, `edit`, `change` |
| Delete | `delete`, `remove`, `destroy` |

`All` (or `Full` / `Manage` / `Admin`) is shorthand for **all four** verbs —
`{Admin} All` grants everything.

```
[Data]
  [List Orders] txtItem, curTotal
    [Permission]
      {Admin} Read, Create, Update, Delete
      {Supervisor} Read, Create
      {Viewer} Read
```

- One line may grant several roles: `{Supervisor, Viewer} Read`.
- The **API rejects** unauthorized writes (a Viewer's create → 403). GET = Read,
  POST = Create, PATCH = Update, DELETE = Delete.
- An entity with **no `[Permission]` block is open** to everyone (backward
  compatible) — add a block only where you want to restrict.

### Hiding elements — `{Role, !Role}` on any tag

Append a `{ }` block to **any** element — `[Tag]` lines **and** `( )` widgets /
cards alike — to control visibility by role. Bare names **allow**, `!name`
**denies**; if only denials are present, everyone else is allowed. Hiding an
element hides its entire subtree:

```
[Table -> Orders {Supervisor, !Viewer}] Item, Total   # only Supervisor (never Viewer)
[Button -> New Order {!Viewer}] New Order             # everyone except Viewer

(Card) {Admin}                  # the whole card — and everything in it — only for Admin
  (Counter -> Orders)
{Staff} (Board -> Tickets)      # the block may lead or trail the ( ) header
```

**Tip:** while authoring, use the editor header's **👁 as** selector to preview
the UI as any declared role (or “Signed out”) without deploying — that's how you
confirm a `{ }` block hides what you expect.

### Where roles come from

Roles map to the signed-in user's groups from the identity provider (Authentik).
**In dev (no sign-in configured) the role is `*`** — everything is visible and
all CRUD is allowed, so you can build without logging in. Enforcement and hiding
take effect once sign-in is turned on.

### User management — `[User Management]`

Add a button that opens an in-app window to add/edit/delete users and assign them
the roles you declared — no identity-provider admin UI required:

```
[Display] Admin
  [User Management] Manage Users
```

The role checkboxes are exactly your `[Permissions]` roles.

---

## 12. Bindings and field references

**Binding** connects a view to a data entity:

- `(Card)` → `[Table -> schedule]` — bind by entity name.
- `[List Vendors]` with no `->` — implicit source is the name lowercased
  (`vendors`).
- `[Table -> https://api.example.com/items]` — bind to a live URL instead.

**Field references** (the columns/fields named in a view spec) use the **plain
field name — no prefix**. In `[Data]` you write `curSpent`; everywhere you
*reference* it you write `Spent`.

References are **strict**: a reference must match a declared field exactly. If it
doesn't, the **editor underlines it** (red wavy underline) and shows a count of
issues. For example, writing `Spend` when the field is `Spent`:

```
[Slider -> Budget] Category Spend / Cap
                            ^^^^^  underlined: unknown field "Spend"
```

Fix the spelling and the underline disappears live. This is your safety net
against typos.

---

## 13. Where the data comes from

Records are **never** in the `.fmd` file. They load at runtime from the database
(via the app's API), or from a bound URL. The document is the *contract*; the
data is separate.

When you change the `[Data]` model (add a field, add a `[List]`, change a type),
click **Save → rebuild DB** in the header — or press **Ctrl/⌘+S**. This
reconstructs the database to match your model exactly:

- new fields/entities are **created** (with their declared types),
- fields/entities you removed are **dropped**,
- overlapping data is **preserved** (existing rows survive; only removed columns
  are lost).

### Renaming the app = a clean slate

The `[App Name]` doubles as the app's identity. If you change it and Save, the
database is **completely rewritten** — every table and store collection is
dropped and rebuilt empty from the model. This prevents data from a *different*
app/config (e.g. a same-named entity with different fields) from lingering. Keep
the name stable while iterating on one app; change it only when you mean "this is
a new app, start fresh." (The document itself is also persisted to the database
on Save, so your edits survive a reload; "Reset to file" reloads the bundled
`app.fmd`.)

---

## 14. Cheat sheet

```
PAGES
  [App Name] text           global app title; renaming it WIPES + rebuilds the DB
  [Display] Name            a page; matched to a menu tab by name
  [Title] text              heading      (inline **bold** / *italic*)
  [Text] text               paragraph    (inline **bold** / *italic* / [[Field]])
  [TopMenu] a, b, c         top navigation tabs (aka [Top Menu Bar]/[Menu]/[Nav])
  [SideMenu] a, b, c        vertical left nav rail (aka [Sidebar]/[Side Menu])
  [Main]                    content area

LAYOUT (inside [Main])
  ((Card A)  ...  (Card B)  ...  )    a row of widget cards (outer parens)
  (Card)                             one widget card

VISUALIZATIONS (indented under a card; binding inside the brackets)
  [Table    -> Src] col, col
  [Counter  -> Src] SubField        + [Count]/[Counts] items
  [Checklist-> Src] Label / Status
  [Slider   -> Src] Label Spent / Cap   + [Slide]/[Slides] items
  [Board    -> Src] GroupField      kanban grouped by a field
  [Calendar -> Src] DateField       month calendar on a date field
  [Chart    -> Src] Label / Value   + [Kind] bar|line|pie|donut, [Sort]; sums by label
  [Detail   -> Src] col, col        one chosen record + nested views (`this`)
  [Cases    -> Src] col, col        master-detail list; row click -> drill-in page
  (a plain read-only bare name that ISN'T a viz keyword no longer renders)

TABLE EXTRAS (indented under a [Table]; [Sort]/[RowButton] also work in [Cases])
  [Sort] Field desc                 order rows (asc default)
  [Group] Field                     sections by value (+ subtotals with [Foot])
  [Foot] sum Amount, count          footer of column aggregates
  [Search] placeholder              viewer text box; substring-matches any column
  [Filter] Field                    viewer dropdown of a column's values (stack = AND)
  [RowButton -> Action] Label       per-row button; runs Action with that row as `this`

ITEMS
  [Count] Label      [Counts] A, B     (for [Counter])
  [Slide] Label      [Slides] A, B     (for [Slider])
  [Count] L = count(Entity ? cond)    live aggregate (sum/avg/min/max too)

INTERACTIVE TABLE PREFIXES
  c create · u update · d delete · r/none read     e.g. cudTable, udTable

FORMS & BUTTONS
  [Form -> Source] Title           a modal that creates a Source record
    [Size] Compact|Standard|Wide   modal width (indented under the [Form])
    [Field "Label"] field          one input (quotes = label)
    [Field "L" (cond)] field       show this field only when cond is true
    [Fields] !Name, Phone          several inputs;  !name = required
    [Field] rNote                  r prefix = read-only (not editable)
    [Fields] 1First, 1Last, 2Email leading 1/2/3 = column span in a 3-wide grid
    [Field -> CurrentUser] rBy     auto-fill: CurrentUser / Today / Now / "literal"
  markers combine: !1Phone (required, 1/3) · 3rNotes (full, read-only)
  widths also work in [Detail] spec cols and the [View] panel
  [Button -> target] Label         a button that opens the matching form
                                   (or runs an [Action] of that name)

ACTIONS (a button runs a named write sequence; top-level, like [Form])
  [Action] Name                    define; list write steps indented below
    [Create -> Src] F = v, F = v   insert one record
    [Update -> Src ? cond] F = v   set fields on every row matching cond
    [Delete -> Src ? cond]         delete every row matching cond
  values: "text" · 12 · true · today/now (+N) · OtherField · Qty * Price
  no ? filter on update/delete = ALL rows;  writes need the backend

TRIGGERS (run steps automatically on the SERVER — every 60s + after each action)
  [Trigger -> Src ? cond] Label     for each Src record matching cond, run steps
    [Update] F = v                  no source = act on the MATCHED record
    [Create -> Other] F = Field     create elsewhere, reading the matched record
  make cond self-limiting (e.g. ...&& Done == False) so it fires once per record

CONDITIONS (same syntax everywhere)
  [Viz -> Source ? cond] ...       filter the rows a view shows
  (Opt) -> Src Field ? cond        filter dropdown/link choices
  [Field "L" (cond)] f             show-if on a form field
  [Rule] Name (expr)               name a rule; use it as `? Name`
  ops: == != < <= > >= && ||   operands: fields, "text", 12, true/false, bareWord
  dates: today, now, today + 7, Due <= today - 3   (compared by day)

DATA MODEL
  [List Name] fields     -> SQL table
  [Store Name] fields    -> JSONB collection
  [Calc] Field = Qty * UnitPrice    computed: numbers, "strings", dates, if(c,a,b)
  [Rollup] Total = sum(Children Field ? cond via Link)   parent total from children
  [Lookup] CustPhone = Customer.Phone   pull a field across a link (read-only)
  [API] Name             external REST source (server holds the secret key)
    [URL] .. · [Auth] .. · [Path] arr.path · [Map] Field = json.dot · [Want] N

THEMING (top-level [Style]; applies to the whole app)
  [Size] Compact|Standard|Full     content width
  [Font] Inter|Poppins|Serif|…     app font (curated Google fonts + system stacks)
  [Colors] (aka [Palette]/[Theme]) wraps the six basics:
    [Background] [Foreground] [Text] [Lines] [Primary] [Secondary]  (hex or name)
    (Text auto-derives muted+headings; Primary auto-derives button-text)
  back-compat: [Surface] [Card] [Muted] [Heading] [ButtonText] [Border]
  see THEMES.md for 5 ready-made themes

ROLES & PERMISSIONS
  [Permissions]                 declare roles
    [Role] Admin                (or [Roles] Admin, Supervisor, Viewer — many at once)
  [List Orders] ...             grant CRUD per entity (verbs: Read/Create/Update/Delete)
    [Permission]
      {Admin} All               All/Full/Manage/Admin = all four verbs
      {Viewer} Read             synonyms: read=view/list/see · create=write/add/insert/new
                                update=modify/edit/change · delete=remove/destroy
  {Role, !Role} on any tag      visibility: allow / !deny (deny-only = everyone else)
  [User Management] Label       button → in-app add/edit/delete users + assign roles

FIELD TYPE PREFIXES
  txt text · memo multi-line · num number · cur currency · bool boolean · date date
  drop dropdown · link relationship · msel multi-select
  file one uploaded file · files several uploaded files
  full set: txt | memo | num | cur | bool | date | drop | link | msel | file | files
  multi-word: "txtRelated Vendor" -> "Related Vendor"

FILE UPLOADS (file = one, files = several; declared in [Data])
  [List Docs] txtTitle, fileAttachment, filesPhotos
  [Fields] Attachment (img, pdf)     form input; (types) restricts + validates
                                     types: img | pdf | png/jpg/docx/csv…; omit = any
  read views show thumbnails + links; files 2+ toggles cards/list; ~25 MB/file
  stored server-side in Postgres; upload needs sign-in on a deployed app

OPTIONS (a line under the entity, configuring a drop/link field)
  (Category) Venue, Catering, Flowers        static dropdown choices
  (Vendors) -> Vendors Name                  choices from another entity
  (Vendors) -> Vendors Name ? Status == True filtered (rules engine)
  rules ops: == != < <= > >= && ||  (fields, "strings", numbers, true/false)

RULES
  - structure = indentation; no closing tags;  # starts a comment
  - wrap items in ( ) cards for proper spacing (bare items render cramped)
  - field references use the PLAIN name (no prefix); strict — typos get underlined
  - cur/date values auto-format ($8,000.00 · Jun 25, 2026)
  - records load at runtime; the document never contains data
  - after editing [Data], Save -> rebuild DB  (or Ctrl/Cmd+S)
```

---

## 15. A complete annotated example

```
[Display] Home                                  # page 1 (the "Home" tab)
  [Title] Wedding Planner
  [Top Menu Bar] Home, Schedule, Vendors        # tabs -> pages by name
  [Main]
    ((Schedule Timeline)                        # row 1, card 1
        [Table -> Schedule] Time, Activity
     (Inventory Counts)                         # row 1, card 2
        [Counter -> Inventory] Category         # stat cards, Category sub-label
            [Count] Folding Chairs
            [Counts] Centerpieces, String Lights
    )
    ((Vendor Checklist)                         # row 2, card 1
        [Checklist -> Vendors] Name / Status
     (Budget Summary)                           # row 2, card 2
        [Slider -> Budget] Category Spent / Cap
            [Slide] Venue
            [Slides] Catering, Flowers
    )

[Display] Schedule                              # page 2 (the "Schedule" tab)
  [cuTable -> Schedule] Time, Activity, Vendor  # add rows + edit; Vendor is a picker

[Display] Budget                                # page 3 (the "Budget" tab)
  [Table -> Budget] Category, Spent, Cap, Deadline   # $ + dates auto-format

[Data]                                          # the model (never drawn)
  [List Schedule] txtTime, txtActivity, linkVendor
    (Vendors) -> Vendors Name ? Status == True  # Vendor links to confirmed vendors
  [Store Inventory] txtTitle, dropCategory, numCount, curPrice, txtRelated Vendor
  [List Vendors] txtName, boolStatus
  [List Budget] dropCategory, curSpent, curCap, dateDeadline
    (Category) Venue, Catering, Photography, Flowers   # dropdown options
```

To build from scratch: start with the `[Data]` block (decide your entities and
fields), add a `[Display]` with a `[Title]` and `[Top Menu Bar]`, drop
visualizations into `(Card)`s under `[Main]`, then **Save → rebuild DB** so the
database matches your model.

---

## 16. Tips & gotchas

- **Indent consistently.** Mixing widths breaks nesting; 2 spaces per level is
  the convention. And **close every row**: each `((` needs a matching `)` on its
  own line.
- **Don't double up create paths.** A `[Button]`+`[Form]` *and* a `cudTable` for
  the same entity in the same view is redundant — pick one (form for user
  screens, `cudTable` for admin).
- **Always filter an `[Action]` update/delete.** A step with no `? condition`
  rewrites or deletes **every** row in the source. Write the `?` filter that
  scopes it (`? Status == False`) unless you genuinely mean all of them.
- **Titles are display text — use spaces.** `(Card Title)`, `[Title]`,
  `[App Name]`, menu items, and dropdown *values* are labels: write them readably
  (`(Today Appointments)`, not `(TodayAppointments)`). Only **entity names**
  (`[List X]`) and **field names** are identifiers where single tokens are
  simplest.
- **Views don't filter rows by their title.** A `? condition` filters
  dropdown/link *options* and the rows a view shows only when written *in the
  brackets*; naming a card "Open Work Orders" doesn't filter it. Use
  `[Viz -> Source ? cond]` to actually filter rows.
- **Reference plain field names.** Use `Spent`, not `curSpent`, in view specs —
  and watch the editor for underlines.
- **Item labels must match data.** `[Slide] Venue` only shows a value if a record
  named "Venue" exists in the bound source.
- **Two stores, one choice.** `[List]` for tabular data, `[Store]` for
  free-form/varied records. You never specify SQL vs. NoSQL — the declaration
  decides.
- **Option lines go *under* their entity.** `(Category) …` / `(Vendors) -> …`
  must sit directly below the `[List]`/`[Store]` whose `drop`/`link` field they
  configure.
- **Use emojis in titles.** There are no auto-icons — put an emoji right in a
  `[Title]` or `(Card Name)`, e.g. `[Title] 💍 Wedding Planner`.
- **Tables go mobile automatically.** On phones, a wide `[Table]`/`[Cases]`/`[List]`
  reflows so each row becomes a **labeled card** (the column header shown beside
  each value) instead of running off-screen. No syntax — it just happens.