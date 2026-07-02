import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { diffLines, collapseDiff, diffStats } from '../fmd/diff'

// In-app replacements for window.alert/confirm/prompt: a toast stack for
// information, and promise-based confirm/prompt modals so call sites stay linear
// (`if (await confirm(...))`). Wrap the app in <DialogsProvider> and call
// useDialogs() anywhere beneath it.

type ToastKind = 'info' | 'success' | 'error'
interface ToastLink { label: string; href: string }
interface Toast { id: number; message: string; kind: ToastKind; link?: ToastLink }

interface ConfirmOpts { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
interface PromptOpts { title?: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string }
interface ReviewOpts { title?: string; message?: string; before: string; after: string; applyLabel?: string }

interface Dialogs {
  toast: (message: string, opts?: { kind?: ToastKind; link?: ToastLink }) => void
  confirm: (opts: ConfirmOpts) => Promise<boolean>
  prompt: (opts: PromptOpts) => Promise<string | null>
  // Show a before/after diff; resolves true if the user applies it.
  review: (opts: ReviewOpts) => Promise<boolean>
}

const DialogsContext = createContext<Dialogs>({
  toast: () => {},
  confirm: async () => false,
  prompt: async () => null,
  review: async () => false,
})
export const useDialogs = (): Dialogs => useContext(DialogsContext)

type Modal =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'review'; opts: ReviewOpts; resolve: (v: boolean) => void }

export function DialogsProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<Modal | null>(null)
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback<Dialogs['toast']>((message, opts) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, kind: opts?.kind ?? 'info', link: opts?.link }])
    setTimeout(() => dismiss(id), 5000)
  }, [dismiss])

  const confirm = useCallback<Dialogs['confirm']>(
    (opts) => new Promise((resolve) => setModal({ kind: 'confirm', opts, resolve })), [])
  const prompt = useCallback<Dialogs['prompt']>(
    (opts) => new Promise((resolve) => setModal({ kind: 'prompt', opts, resolve })), [])
  const review = useCallback<Dialogs['review']>(
    (opts) => new Promise((resolve) => setModal({ kind: 'review', opts, resolve })), [])

  const settle = (result: boolean | string | null) => {
    if (modal) modal.resolve(result as never)
    setModal(null)
  }

  return (
    <DialogsContext.Provider value={{ toast, confirm, prompt, review }}>
      {children}
      {modal?.kind === 'review' && <ReviewModal modal={modal} onSettle={settle} />}
      {(modal?.kind === 'confirm' || modal?.kind === 'prompt') && <DialogModal modal={modal} onSettle={settle} />}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            <span>{t.message}</span>
            {t.link && <a className="toast-link" href={t.link.href} onClick={(e) => e.stopPropagation()}>{t.link.label}</a>}
          </div>
        ))}
      </div>
    </DialogsContext.Provider>
  )
}

function DialogModal({ modal, onSettle }: { modal: Extract<Modal, { kind: 'confirm' | 'prompt' }>; onSettle: (r: boolean | string | null) => void }): React.ReactNode {
  const isPrompt = modal.kind === 'prompt'
  const [value, setValue] = useState('')
  useEffect(() => { setValue(isPrompt ? ((modal.opts as PromptOpts).defaultValue ?? '') : '') }, [modal, isPrompt])

  const cancel = () => onSettle(isPrompt ? null : false)
  const accept = () => onSettle(isPrompt ? value : true)
  const danger = !isPrompt && (modal.opts as ConfirmOpts).danger

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div className="modal dialog" onClick={(e) => e.stopPropagation()}>
        {modal.opts.title && <div className="modal-title">{modal.opts.title}</div>}
        {modal.opts.message && <div className="dialog-message">{modal.opts.message}</div>}
        {isPrompt && (
          <input
            className="dialog-input"
            autoFocus
            value={value}
            placeholder={(modal.opts as PromptOpts).placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') accept(); if (e.key === 'Escape') cancel() }}
          />
        )}
        <div className="modal-actions">
          <button className="toggle" onClick={cancel}>{(modal.opts as ConfirmOpts).cancelLabel ?? 'Cancel'}</button>
          <button className={`toggle primary${danger ? ' danger' : ''}`} onClick={accept}>
            {modal.opts.confirmLabel ?? (isPrompt ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// A before/after diff preview with Apply / Discard.
function ReviewModal({ modal, onSettle }: { modal: Extract<Modal, { kind: 'review' }>; onSettle: (r: boolean) => void }): React.ReactNode {
  const { before, after, title, message, applyLabel } = modal.opts
  const lines = diffLines(before, after)
  const rows = collapseDiff(lines)
  const { added, removed } = diffStats(lines)
  return (
    <div className="modal-backdrop" onClick={() => onSettle(false)}>
      <div className="modal review-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title || 'Review changes'}</div>
        {message && <div className="dialog-message">{message}</div>}
        <div className="review-stats"><span className="rv-add">+{added}</span><span className="rv-del">−{removed}</span></div>
        <div className="review-diff">
          {added + removed === 0 && <div className="diff-gap">No changes</div>}
          {rows.map((r, i) => (r.type === 'gap'
            ? <div key={i} className="diff-gap">⋯ {r.count} unchanged line{r.count > 1 ? 's' : ''}</div>
            : <div key={i} className={`diff-line diff-${r.type}`}>
                <span className="diff-mark">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>{r.text || ' '}
              </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="toggle" onClick={() => onSettle(false)}>Discard</button>
          <button className="toggle primary" onClick={() => onSettle(true)}>{applyLabel || 'Apply'}</button>
        </div>
      </div>
    </div>
  )
}
