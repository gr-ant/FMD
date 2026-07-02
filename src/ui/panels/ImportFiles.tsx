import React, { useRef } from 'react'
import { mergeFmdFiles } from '../../fmd/merge'

// Header button to upload one or more .fmd files; they are read and merged into a
// single document (ordered by filename), then handed to onImport.
export default function ImportFiles({
  onImport,
}: {
  onImport: (mergedText: string, names: string[]) => void
}): React.ReactNode {
  const ref = useRef<HTMLInputElement>(null)

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) {
      const read = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))
      onImport(mergeFmdFiles(read), read.map((r) => r.name))
    }
    if (ref.current) ref.current.value = '' // let the same file(s) be re-selected
  }

  return (
    <>
      <button
        className="toggle"
        onClick={() => ref.current?.click()}
        title="Import one or more .fmd files — merged into one document by filename order"
      >
        ⬆ Import files
      </button>
      <input
        ref={ref}
        type="file"
        accept=".fmd,.md,.txt,text/plain"
        multiple
        style={{ display: 'none' }}
        onChange={onChange}
      />
    </>
  )
}
