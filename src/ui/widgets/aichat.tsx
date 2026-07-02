// [AI Chat] widget: a message list + input that talks to the server-side
// /api/_chat endpoint. The endpoint runs a STRICTLY READ-ONLY assistant scoped
// to this node's `sources`, as the current user. The browser never sees the
// Anthropic key — it only posts the question + sources + a short history.
import React, { useRef, useState, useEffect } from 'react'
import type { AIChatNode } from '../../fmd/types'
import { useApiBase } from '../../data'
import { apiFetch } from '../../state/auth'

interface ChatMsg { role: 'user' | 'assistant'; content: string }

export function AIChat({ node }: { node: AIChatNode }) {
  const base = useApiBase()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the transcript scrolled to the newest message.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy])

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return
    const history = messages.slice(-8)
    const next: ChatMsg[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const r = await apiFetch(`${base}/_chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, sources: node.sources, history }),
      })
      const data = await r.json().catch(() => ({}))
      const answer = data.answer || data.error || 'Something went wrong.'
      setMessages([...next, { role: 'assistant', content: String(answer) }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Could not reach the assistant.' }])
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="fmd-aichat">
      <div className="fmd-aichat-head">
        <span className="fmd-aichat-title">💬 AI Chat</span>
        <span className="fmd-aichat-sources">{node.sources.join(' · ') || 'no sources'}</span>
      </div>
      <div className="fmd-aichat-msgs" ref={listRef}>
        {messages.length === 0 && (
          <div className="fmd-aichat-empty">
            Ask me anything about {node.sources.length ? node.sources.join(', ') : 'the data'}. I can search and read (never change) your data.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`fmd-aichat-msg fmd-aichat-${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="fmd-aichat-msg fmd-aichat-assistant fmd-aichat-typing">…</div>}
      </div>
      <div className="fmd-aichat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask a question…"
          rows={1}
        />
        <button className="fmd-button" onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
    </div>
  )
}
