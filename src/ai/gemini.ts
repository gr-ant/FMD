// Google Gemini client (called directly from the browser with the user's API
// key). It knows the FMD language via the system guide, and returns a complete
// .fmd document for a build/modify/fix request.
import { FMD_GUIDE, FMD_CHAT } from './fmdGuide'

export interface AiSettings {
  apiKey: string
  model: string
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string }
type GeminiPart = { text: string }
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

export const DEFAULT_MODEL = 'gemini-2.0-flash'
export const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro']

const endpoint = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`

// Collect every fenced code block + the trimmed line just before it (which the
// model often uses as a filename label).
function collectBlocks(text: string): { header: string; body: string }[] {
  const out: { header: string; body: string }[] = []
  const re = /```(?:fmd|markdown|md|text)?[ \t]*\r?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index).trimEnd()
    out.push({ header: before.slice(before.lastIndexOf('\n') + 1).trim(), body: m[1] })
  }
  return out
}
const headerFileName = (h: string): string | null => {
  const m = h.match(/([\w.\-]+\.fmd)/i)
  return m ? m[1] : null
}
// One or more code blocks -> a single document. A lone unlabeled block is used
// verbatim (it may already carry "# ==== file: …" markers). Multiple blocks (or a
// block with a filename label) are joined WITH file markers so the multi-file
// split survives. See markedDocToFiles.
function blocksToDoc(blocks: { header: string; body: string }[]): string {
  if (blocks.length === 1 && !headerFileName(blocks[0].header)) return blocks[0].body.trim()
  return blocks.map((b, i) => `# ==== file: ${headerFileName(b.header) || `file-${i + 1}.fmd`} ====\n${b.body.trim()}`).join('\n')
}
function stripFences(t: string): string {
  const blocks = collectBlocks(t)
  return blocks.length ? blocksToDoc(blocks) : t.trim()
}

// Core call: send a system instruction + a turn list, return the model's text.
async function callGemini(settings: AiSettings, system: string, contents: GeminiContent[]): Promise<string> {
  const res = await fetch(endpoint(settings.model || DEFAULT_MODEL, settings.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.35 },
    }),
  })
  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j) } catch { detail = await res.text().catch(() => '') }
    throw new Error(`${res.status} ${detail.slice(0, 240)}`)
  }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts as Array<{ text?: string }> | undefined
  return (parts || []).map((p) => p.text || '').join('')
}

// Generate or modify an .fmd document (one-shot; returns the bare document).
export async function generateFmd(settings: AiSettings, instruction: string, currentDoc: string): Promise<string> {
  const userMsg =
    `Current .fmd document:\n\`\`\`\n${currentDoc.trim() || '(empty — start fresh)'}\n\`\`\`\n\n` +
    `Request: ${instruction}\n\nReturn the COMPLETE updated .fmd document.`
  return stripFences(await callGemini(settings, FMD_GUIDE, [{ role: 'user', parts: [{ text: userMsg }] }]))
}

// Multi-turn chat. The current document seeds the conversation as context; the
// reply may contain prose plus a ```fmd block (extract with extractDoc).
export async function chatFmd(settings: AiSettings, history: ChatTurn[], currentDoc: string): Promise<string> {
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: `My current .fmd document:\n\`\`\`fmd\n${currentDoc.trim() || '(empty)'}\n\`\`\`` }] },
    { role: 'model', parts: [{ text: 'Got it — how can I help with your app?' }] },
    ...history.map((t): GeminiContent => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
  ]
  return callGemini(settings, FMD_CHAT, contents)
}

// Split a chat reply into prose and an optional .fmd document (from a code block).
export function extractDoc(text: string): { prose: string; doc: string | null } {
  const blocks = collectBlocks(text)
  if (!blocks.length) return { prose: text.trim(), doc: null }
  const prose = text.replace(/```(?:fmd|markdown|md|text)?[ \t]*\r?\n[\s\S]*?```/g, '').trim()
  return { prose, doc: blocksToDoc(blocks) }
}

// Ask the model to correct a document given the editor's error messages.
export async function fixFmd(settings: AiSettings, doc: string, errors: string[]): Promise<string> {
  const instruction =
    `The document has these problems flagged by the editor — fix ALL of them and return the corrected, complete document:\n` +
    errors.map((e) => `- ${e}`).join('\n')
  return generateFmd(settings, instruction, doc)
}
