import React, { useEffect, useState } from 'react'
import { isAuthConfigured, getUser, login, logout } from '../../state/auth'

// Header sign-in control. Hidden entirely unless Authentik is configured
// (issuer present), so the dev/open-mode UI is unchanged.
export default function AuthControl(): React.ReactNode {
  const [configured, setConfigured] = useState(false)
  const [, setTick] = useState(0) // bump to re-read getUser() after popup sign-in
  useEffect(() => { isAuthConfigured().then(setConfigured) }, [])
  if (!configured) return null

  const signIn = async () => { await login(); setTick((t) => t + 1) }

  const user = getUser()
  if (!user) return <button className="toggle" onClick={signIn}>Sign in</button>
  return (
    <span className="auth-user">
      <span className="auth-name">{user.name}</span>
      {user.roles.length > 0 && <span className="auth-roles">{user.roles.join(', ')}</span>}
      <button className="toggle" onClick={() => logout()}>Sign out</button>
    </span>
  )
}
