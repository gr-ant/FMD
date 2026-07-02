// Field type prefixes and name/field-list parsing.
// -------------------------------------------------------------

import type { Field, FieldType } from '../types'

// Field type prefixes in [Data]: `txtTime`, `numCount`, `curPrice`, `boolStatus`,
// `dateDeadline`. The prefix declares the type; the rest is the display name. A
// multi-word name prefixes each word: `txtRelated txtVendor` -> "Related Vendor".
// `files` before `file` so `filesPhotos` reads as the plural (the trailing
// `[A-Z]` anchor already disambiguates, but ordering keeps it obvious).
const TYPE_PREFIX_RE = /^(txt|memo|num|cur|bool|date|drop|link|msel|files|file)([A-Z].*)$/
const PREFIX_TYPE: Record<string, FieldType> = {
  txt: 'text', num: 'number', cur: 'currency', bool: 'boolean', date: 'date',
  memo: 'memo',   // large/multi-line text -> renders a textarea
  drop: 'drop',   // dropdown with a fixed list of options
  link: 'link',   // relationship: options come from another entity
  msel: 'msel',   // multi-select: choose several from a fixed list
  file: 'file',   // a single uploaded file (image/pdf/…)
  files: 'files', // several uploaded files
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

// Split a field list at top-level commas, leaving commas inside a "quoted label"
// alone (so `txtNote "Notes, private"` stays one field).
function splitFieldList(str: string): string[] {
  const out: string[] = []
  let buf = '', inQ = false
  for (const ch of str) {
    if (ch === '"') inQ = !inQ
    if (ch === ',' && !inQ) { out.push(buf); buf = '' } else buf += ch
  }
  if (buf.trim()) out.push(buf)
  return out
}

// Parse a comma-separated field list into [{ name, type, label? }], stripping type
// prefixes. A field may carry a trailing "quoted" display label to name it more
// nicely than its raw field name: `txtTicketNo "Ticket Number", dropStatus "Status"`.
export function parseFields(content: string): Field[] {
  if (!content) return []
  return splitFieldList(content).map((s) => s.trim()).filter(Boolean).map((spec) => {
    let label: string | undefined
    const lm = spec.match(/\s*"([^"]*)"\s*$/)
    if (lm) { label = lm[1].trim() || undefined; spec = spec.slice(0, lm.index).trim() }
    const words = spec.split(/\s+/).filter(Boolean).map(cleanWord)
    const name = words.map((w) => w.word).join(' ')
    const found = words.find((w) => w.type)
    const type: FieldType = (found && found.type) || 'text'
    const field: Field = { name, type }
    if (label) field.label = label
    return field
  })
}
