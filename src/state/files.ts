// A config can be split into several named "files" that the author organizes
// however they like (data.fmd, pages.fmd, automations.fmd, …). They're purely
// organizational: the whole system still works on ONE document, produced by
// concatenating the files in tray order. Think `#include`.

export interface FmdFile {
  name: string
  content: string
}

// Join files into the single FMD document everything else parses. A plain '\n'
// join means the combined line array is exactly the files' lines concatenated,
// which keeps line-offset math (below) trivial.
export function combineFiles(files: FmdFile[]): string {
  return files.map((f) => f.content).join('\n')
}

// Wrap a legacy single-document config as a one-file tray.
export function wrapDoc(doc: string): FmdFile[] {
  return [{ name: 'app.fmd', content: doc }]
}

// The 0-indexed start line of each file within the combined document, so global
// (combined-doc) line numbers from the parser/linter can be mapped back to the
// file the author is actually editing.
export function fileLineOffsets(files: FmdFile[]): number[] {
  const offsets: number[] = []
  let acc = 0
  for (const f of files) {
    offsets.push(acc)
    acc += f.content.split('\n').length
  }
  return offsets
}

// ---- AI round-trip: represent the tray as one document the model can edit ----
// Each file is introduced by a marker line. It's an FMD comment (starts with #),
// so it's inert even if it ever reaches the parser.
const fileMark = (name: string): string => `# ==== file: ${name} ====`
const cleanName = (s: string): string => s.replace(/^["'`]+|["'`=\-]+$/g, '').trim()

// Recognize a file marker line, tolerating the variants an LLM tends to produce:
//   # ==== file: data.fmd ====   # === file: data ===   # file: data.fmd
//   # --- data.fmd ---           # data.fmd              ## File = pages.fmd
// A plain comment (# note) is NOT a marker — markers need `file:` OR a `.fmd` name.
export function parseFileMark(line: string): string | null {
  const t = line.trim()
  if (!t.startsWith('#')) return null
  let m = t.match(/^#+\s*(?:[=\-*]{2,}\s*)?file\s*[:=]\s*(.+?)\s*(?:[=\-*]{2,})?\s*$/i)
  if (m) return cleanName(m[1]) || null
  m = t.match(/^#+\s*[=\-*]{2,}\s*(.+?)\s*[=\-*]{2,}\s*$/) // decorated; require .fmd to avoid section comments
  if (m && /\.fmd\s*$/i.test(m[1])) return cleanName(m[1]) || null
  m = t.match(/^#+\s*([\w.\- ]+\.fmd)\s*$/i) // bare "# NAME.fmd"
  if (m) return cleanName(m[1]) || null
  return null
}

// Files -> one marked document to hand the AI (so it sees the split).
export function filesToMarkedDoc(files: FmdFile[]): string {
  return files.map((f) => `${fileMark(f.name)}\n${f.content}`).join('\n')
}

// Parse the AI's marked document back into files. If it emitted no markers (it
// ignored the split), fall back to a single file so nothing breaks.
export function markedDocToFiles(text: string): FmdFile[] {
  const out: { name: string; content: string[] }[] = []
  const pre: string[] = []
  for (const line of String(text).split('\n')) {
    const name = parseFileMark(line)
    if (name !== null) out.push({ name: name || `untitled-${out.length + 1}.fmd`, content: [] })
    else if (out.length) out[out.length - 1].content.push(line)
    else pre.push(line)
  }
  if (!out.length) return wrapDoc(text)
  const files = out.map((f) => ({ name: f.name, content: f.content.join('\n') }))
  if (pre.some((l) => l.trim())) files.unshift({ name: 'app.fmd', content: pre.join('\n') })
  return files
}

// A unique "Untitled-N.fmd" name not already used.
export function nextFileName(files: FmdFile[]): string {
  const used = new Set(files.map((f) => f.name.toLowerCase()))
  for (let n = 1; ; n++) {
    const name = `untitled-${n}.fmd`
    if (!used.has(name)) return name
  }
}
