import type { Node, FormNode, ButtonNode, ActionNode, MenuNode } from '../../fmd/types'

// Match a clicked [Button] to a [Form] by its label, then its -> target.
export function matchForm(forms: FormNode[], btn: ButtonNode | null): FormNode | null {
  if (!btn || !forms.length) return null
  const label = (btn.label || '').toLowerCase()
  const target = (btn.target || '').toLowerCase()
  return forms.find((f) => f.title.toLowerCase() === label)
    || forms.find((f) => target && f.title.toLowerCase().includes(target))
    || forms.find((f) => f.source === target)
    || null
}

// Match a clicked [Button] to an [Action] by its -> target, then its label.
// Actions take precedence over forms (checked first in FormButton).
export function matchAction(actions: Record<string, ActionNode>, btn: ButtonNode | null): ActionNode | null {
  if (!btn || !actions) return null
  const target = (btn.target || '').toLowerCase()
  const label = (btn.label || '').toLowerCase()
  return actions[target] || actions[label] || null
}

// Find the first [Top Menu Bar]/[Menu] node anywhere in the tree.
export function findMenu(nodes: Node[]): MenuNode | null {
  for (const n of nodes) {
    if (n.type === 'Menu') return n
    const found = n.children && findMenu(n.children)
    if (found) return found
  }
  return null
}
