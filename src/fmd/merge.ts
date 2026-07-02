// Merge several .fmd files into one document for parsing. FMD's top-level blocks
// ([Display], [Data], [Form], [Action], [Rule] …) compose by concatenation —
// the parser already collects every [Data] block and every [Display] page — so
// merging is just ordered concatenation with a parse-safe `#` separator naming
// each source file. Files are ordered by name, so authors can control page order
// with numeric prefixes (01-home.fmd, 02-data.fmd).

export interface NamedFile {
  name: string
  text: string
}

export function mergeFmdFiles(files: NamedFile[]): string {
  return [...files]
    .filter((f) => f && f.text != null && String(f.text).trim())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => `# ───────────  ${f.name}  ───────────\n${String(f.text).trim()}`)
    .join('\n\n')
}
