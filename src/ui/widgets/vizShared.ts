// Shared, JSX-free helpers used across the viz renderers (viz.tsx) and the chart
// (vizChart.tsx). Kept in a third module so viz.tsx and vizChart.tsx can both
// import them without a circular dependency.
import { useContext } from 'react'
import { fieldName } from '../../parser'
import { passes } from '../../fmd/rules'
import { keysOf, SchemaContext } from '../../data'
import type { Field, FmdRecord } from '../../fmd/types'

// A resolved field reference (declared name + canonical key + validity flag).
export type ResolvedField = { name: string; key: string | null; ok: boolean }

// Filter rows by a view's `? condition` (a named rule or inline expression).
export const filterRows = (
  rows: FmdRecord[] | null,
  cond: string | null,
  rules: Record<string, unknown>,
): FmdRecord[] | null => (rows && cond ? rows.filter((r) => passes(cond, r, rules)) : rows)

// Declared field names for a source, from the [Data] model.
export function useFields(source: string | null): Field[] | null {
  const schema = useContext(SchemaContext)
  return schema?.[source]?.fields || null
}

// STRICT field-reference resolution. A reference must match a declared field
// name exactly (prefix stripped, case-insensitive). Returns { name, key, ok }.
// `ok` is false when the reference resolves to no declared field -> an "issue".
// When the source is undeclared (no model and no rows) we can't validate, so
// `ok` is true to avoid false positives.
export function resolveField(fields: Field[] | null, rows: FmdRecord[] | null, ref: string): ResolvedField {
  const name = fieldName(ref)
  if (!name) return { name: '', key: null, ok: false }
  const declared = fields && fields.length ? fields.map((f) => f.name) : null
  const rowKeys = rows && rows.length ? keysOf(rows) : null
  const pool = declared || rowKeys
  if (!pool) return { name, key: name, ok: true }
  const ok = pool.some((k) => k.toLowerCase() === name.toLowerCase())
  // Index records by their ACTUAL key (case-insensitive) so a declared field name
  // whose case differs from the data key — e.g. Authentik's lowercase user keys —
  // still reads its value. Falls back to the declared name.
  const key =
    (rowKeys && rowKeys.find((k) => k.toLowerCase() === name.toLowerCase())) ||
    (declared && declared.find((k) => k.toLowerCase() === name.toLowerCase())) ||
    name
  // Prefer a declared "quoted" display label for the shown NAME (data stays keyed
  // by `key`), so `txtTicketNo "Ticket #"` renders "Ticket #" as the header.
  const decl = fields?.find((f) => f.name.toLowerCase() === name.toLowerCase())
  return { name: (decl && decl.label) || name, key, ok }
}
