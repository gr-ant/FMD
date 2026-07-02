import type { RoleVisibility } from './types'

// Decide whether an element with a `{Role, !Role}` block is visible to a user
// holding `userRoles`. Rules:
//   - no block            -> visible to everyone
//   - matches a deny role -> hidden (deny always wins)
//   - allow list present  -> visible only if the user holds an allowed role
//   - only deny entries    -> visible to everyone not denied
// `*` in userRoles means "all access" (e.g. the dev/open mode or a super-admin).
export function visibleForRoles(roles: RoleVisibility | undefined | null, userRoles: string[]): boolean {
  if (!roles) return true
  const u = (userRoles || []).map((r) => String(r).toLowerCase())
  if (u.includes('*')) return true
  if (roles.deny.some((d) => u.includes(d))) return false
  if (roles.allow.length) return roles.allow.some((a) => u.includes(a))
  return true
}
