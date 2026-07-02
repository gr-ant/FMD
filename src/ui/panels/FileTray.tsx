import React, { useState } from 'react'
import type { FmdFile } from '../../state/files'

// An IDE-style left rail listing the config's files. Click to edit one; add,
// rename (double-click), delete, reorder (↑/↓ or DRAG), and DROP files onto the
// rail to upload them. Files concatenate in this order into the one document.
export default function FileTray({
  files, active, collapsed, onToggle, onSelect, onAdd, onRename, onDelete, onMove, onReorder, onUpload,
}: {
  files: FmdFile[]
  active: number
  collapsed: boolean
  onToggle: () => void
  onSelect: (i: number) => void
  onAdd: () => void
  onRename: (i: number, name: string) => void
  onDelete: (i: number) => void
  onMove: (i: number, dir: -1 | 1) => void
  onReorder: (from: number, to: number) => void
  onUpload: (files: FmdFile[]) => void
}): React.ReactNode {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null) // row a reorder would drop onto
  const [uploadOver, setUploadOver] = useState(false)

  const startRename = (i: number) => { setEditing(i); setDraft(files[i].name) }
  const commitRename = () => {
    if (editing != null) { const n = draft.trim(); if (n) onRename(editing, n) }
    setEditing(null)
  }

  // Read dropped OS files (any text file) and hand them up as new tray files.
  const handleFileDrop = async (e: React.DragEvent): Promise<void> => {
    const dropped = Array.from(e.dataTransfer.files || [])
    if (!dropped.length) return // not a file drop -> a reorder, handled per-row
    e.preventDefault()
    setUploadOver(false)
    const read = await Promise.all(dropped.map(async (f) => ({ name: f.name, content: await f.text() })))
    onUpload(read)
  }
  // Highlight the rail only for OS-file drags (not internal reorder drags).
  const onContainerDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setUploadOver(true) }
  }

  if (collapsed) {
    return (
      <div className="file-tray collapsed">
        <button className="ft-expand" onClick={onToggle} title="Show files">🗂</button>
        <span className="ft-count" title={`${files.length} file${files.length > 1 ? 's' : ''}`}>{files.length}</span>
      </div>
    )
  }

  return (
    <div
      className={`file-tray${uploadOver ? ' upload-over' : ''}`}
      onDragOver={onContainerDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUploadOver(false) }}
      onDrop={handleFileDrop}
    >
      <div className="file-tray-head">
        <span>Files</span>
        <span className="ft-head-btns">
          <button className="ft-add" onClick={onAdd} title="New file">＋</button>
          <button className="ft-collapse" onClick={onToggle} title="Hide files">⟨</button>
        </span>
      </div>
      <div className="file-tray-list">
        {files.map((f, i) => (
          <div
            key={i}
            className={`ft-row${i === active ? ' active' : ''}${dropAt === i && dragIndex !== null ? ' drop-target' : ''}`}
            draggable={editing !== i}
            onClick={() => onSelect(i)}
            onDoubleClick={() => startRename(i)}
            title={f.name}
            onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move' }}
            onDragEnd={() => { setDragIndex(null); setDropAt(null) }}
            onDragOver={(e) => { if (dragIndex !== null) { e.preventDefault(); setDropAt(i) } }}
            onDrop={(e) => {
              if (dragIndex === null) return // OS-file drop -> bubble to the container
              e.preventDefault(); e.stopPropagation()
              onReorder(dragIndex, i)
              setDragIndex(null); setDropAt(null)
            }}
          >
            {editing === i ? (
              <input
                className="ft-rename" autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null) }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="ft-name">{f.name}</span>
            )}
            <span className="ft-actions" onClick={(e) => e.stopPropagation()}>
              <button className="ft-act" disabled={i === 0} onClick={() => onMove(i, -1)} title="Move up">↑</button>
              <button className="ft-act" disabled={i === files.length - 1} onClick={() => onMove(i, 1)} title="Move down">↓</button>
              <button className="ft-act" onClick={() => startRename(i)} title="Rename">✎</button>
              <button className="ft-act ft-del" disabled={files.length <= 1} onClick={() => onDelete(i)} title="Delete file">🗑</button>
            </span>
          </div>
        ))}
      </div>
      {uploadOver && <div className="ft-drop-hint">Drop to add file{files.length ? 's' : ''}</div>}
    </div>
  )
}
