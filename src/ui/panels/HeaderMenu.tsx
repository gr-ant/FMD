import React, { useState } from 'react'

// A standard overflow dropdown for the config-builder toolbar: a single labeled
// button that opens a popover of action items, so secondary actions don't crowd
// the header (and don't wrap into a mess on narrow / mobile screens). Mirrors the
// saved-configs popover pattern (a backdrop closes it; clicking any item closes
// it too, since the click bubbles to the pop's onClick).
export default function HeaderMenu({
  label = 'Menu',
  children,
}: {
  label?: string
  children: React.ReactNode
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className="header-menu">
      <button
        className="toggle"
        onClick={() => setOpen((o) => !o)}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} <span className="header-menu-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="configs-backdrop" onClick={() => setOpen(false)} />
          <div className="header-menu-pop" role="menu" onClick={() => setOpen(false)}>
            {children}
          </div>
        </>
      )}
    </div>
  )
}
