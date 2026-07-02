// Field type prefixes and name/field-list parsing.
// -------------------------------------------------------------

import type { Field, FieldType } from '../types'

// Field type prefixes in [Data]: `txtTime`, `numCount`, `curPrice`, `boolStatus`,
// `dateDeadline`. The prefix declares the type; the rest is the display name. A
// multi-word name prefixes each word: `txtRelated txtVendor` -> "Related Vendor".
const TYPE_PREFIX_RE = /^(txt|memo|num|cur|bool|date|drop|link|msel)([A-Z].*)$/
const PREFIX_TYPE: Record<string, FieldType> = {
  txt: 'text', num: 'number', cur: 'currency', bool: 'boolean', date: 'date',
  memo: 'memo',   // large/multi-line text -> renders a textarea
  drop: 'drop',   // dropdown with a fixed list of options
  link: 'link',   // relationship: options come from another entity
  msel: 'msel',   // multi-select: choose several from a fixed list
}

function cleanWord(w: string): { word: string; type: FieldType | null } {
  const m = w.match(TYPE_PREFIX_RE)
  return m ? { word: m[2], type: PREFIX_TYPE[m[1]] } : { word: w, type: null }
}

// Clean a single field REFERENCE down to its plain name, stripping any type
// prefix. References in the view (e.g. [Table] Time, Activity) use plain names;
// this also tolerates a stray prefix (txtTime -> Time).
export function fieldName(ref: unknown): string {
  return String(ref || '').split(/\s+/).filter(Boolean).map((w) => cleanWord(w).word).join(' ')
}

// Parse a comma-separated field list into [{ name, type }], stripping prefixes.
export function parseFields(content: string): Field[] {
  if (!content) return []
  return content.split(',').map((s) => s.trim()).filter(Boolean).map((field) => {
    const words = field.split(/\s+/).filter(Boolean).map(cleanWord)
    const name = words.map((w) => w.word).join(' ')
    const found = words.find((w) => w.type)
    const type: FieldType = (found && found.type) || 'text'
    return { name, type }
  })
}
