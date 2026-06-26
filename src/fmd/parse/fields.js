// Field type prefixes and name/field-list parsing.
// -------------------------------------------------------------

// Field type prefixes in [Data]: `txtTime`, `numCount`, `curPrice`, `boolStatus`,
// `dateDeadline`. The prefix declares the type; the rest is the display name. A
// multi-word name prefixes each word: `txtRelated txtVendor` -> "Related Vendor".
const TYPE_PREFIX_RE = /^(txt|num|cur|bool|date|drop|link)([A-Z].*)$/
const PREFIX_TYPE = {
  txt: 'text', num: 'number', cur: 'currency', bool: 'boolean', date: 'date',
  drop: 'drop',   // dropdown with a fixed list of options
  link: 'link',   // relationship: options come from another entity
}

function cleanWord(w) {
  const m = w.match(TYPE_PREFIX_RE)
  return m ? { word: m[2], type: PREFIX_TYPE[m[1]] } : { word: w, type: null }
}

// Clean a single field REFERENCE down to its plain name, stripping any type
// prefix. References in the view (e.g. [Table] Time, Activity) use plain names;
// this also tolerates a stray prefix (txtTime -> Time).
export function fieldName(ref) {
  return String(ref || '').split(/\s+/).filter(Boolean).map((w) => cleanWord(w).word).join(' ')
}

// Parse a comma-separated field list into [{ name, type }], stripping prefixes.
export function parseFields(content) {
  if (!content) return []
  return content.split(',').map((s) => s.trim()).filter(Boolean).map((field) => {
    const words = field.split(/\s+/).filter(Boolean).map(cleanWord)
    const name = words.map((w) => w.word).join(' ')
    const type = (words.find((w) => w.type) || {}).type || 'text'
    return { name, type }
  })
}
