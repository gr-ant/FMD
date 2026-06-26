// Match a clicked [Button] to a [Form] by its label, then its -> target.
export function matchForm(forms, btn) {
  if (!btn || !forms.length) return null
  const label = (btn.label || '').toLowerCase()
  const target = (btn.target || '').toLowerCase()
  return forms.find((f) => f.title.toLowerCase() === label)
    || forms.find((f) => target && f.title.toLowerCase().includes(target))
    || forms.find((f) => f.source === target)
    || null
}

// Find the first [Top Menu Bar]/[Menu] node anywhere in the tree.
export function findMenu(nodes) {
  for (const n of nodes) {
    if (n.type === 'Menu') return n
    const found = n.children && findMenu(n.children)
    if (found) return found
  }
  return null
}
