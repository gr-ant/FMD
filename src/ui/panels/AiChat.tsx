import React, { useEffect, useRef, useState } from 'react'
import { getConfig, setConfig } from '../../state/configStore'
import { chatFmd, extractDoc, DEFAULT_MODEL, GEMINI_MODELS, type AiSettings, type ChatTurn } from '../../ai/gemini'
import { useDialogs } from '../dialogs'

// A chat panel that slides down from the top of the editor. Multi-turn: it sends
// the conversation + current document to Gemini; replies may include a complete
// .fmd document (in a code block) the user can review-and-apply.
export default function AiChat({
  open, onClose, source, onApply,
}: {
  open: boolean
  onClose: () => void
  source: string
  onApply: (doc: string) => void
}): React.ReactNode {
  const dialogs = useDialogs()
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [needKey, setNeedKey] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getConfig('ai').then((v) => {
      const s = (v || {}) as Partial<AiSettings>
      if (s.apiKey) setApiKey(s.apiKey)
      if (s.model) setModel(s.model)
      setNeedKey(!s.apiKey)
    })
  }, [])

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [messages, busy])

  const saveKey = async () => {
    await setConfig('ai', { apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODEL })
    setNeedKey(!apiKey.trim())
    setShowSettings(false)
    dialogs.toast('Gemini settings saved', { kind: 'success' })
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    if (!apiKey.trim()) { setNeedKey(true); return }
    const next: ChatTurn[] = [...messages, { role: 'user', text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const reply = await chatFmd({ apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODEL }, next, source)
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `⚠️ ${e instanceof Error ? e.message : String(e)}` }])
    } finally {
      setBusy(false)
    }
  }

  const applyDoc = async (doc: string) => {
    if (await dialogs.review({ title: 'AI changes', message: 'Review the changes, then apply.', before: source, after: doc })) {
      onApply(doc)
    }
  }

  return (
    <div className={`ai-chat${open ? ' open' : ''}`}>
      <div className="ai-chat-head">
        <span className="ai-chat-title">✨ AI assistant</span>
        <div className="ai-chat-head-actions">
          <button className="ai-icon" title="Settings" onClick={() => setShowSettings((s) => !s)}>⚙</button>
          <button className="ai-icon" title="Close" onClick={onClose}>✕</button>
        </div>
      </div>

      {(needKey || showSettings) && (
        <div className="ai-chat-settings">
          <input className="form-input" type="password" autoComplete="off" placeholder="Google Gemini API key (AIza…)"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <input className="form-input" list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="ai-models">{GEMINI_MODELS.map((m) => <option key={m} value={m} />)}</datalist>
          <div className="ai-chat-settings-row">
            <a className="ai-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get a free key ↗</a>
            <button className="toggle primary" onClick={saveKey} disabled={!apiKey.trim()}>Save</button>
          </div>
        </div>
      )}

      <div className="ai-chat-body" ref={bodyRef}>
        {messages.length === 0 && !needKey && (
          <div className="ai-chat-empty">Ask me to build or change your app — e.g. “Build a CRM with contacts, companies, and deals”, or “add a Priority dropdown to Tasks”.</div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') return <div key={i} className="ai-msg ai-user">{m.text}</div>
          const { prose, doc } = extractDoc(m.text)
          return (
            <div key={i} className="ai-msg ai-assistant">
              {prose && <div className="ai-prose">{prose}</div>}
              {doc && <button className="ai-apply" onClick={() => applyDoc(doc)}>📄 Review &amp; apply changes ▸</button>}
            </div>
          )
        })}
        {busy && <div className="ai-msg ai-assistant ai-typing">●●●</div>}
      </div>

      <div className="ai-chat-input">
        <textarea
          rows={2}
          placeholder="Message the assistant…  (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="toggle primary" onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
    </div>
  )
}
