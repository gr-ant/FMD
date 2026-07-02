import { useEffect, useRef } from 'react'
import { pokeTriggers } from './runAction'

// Keep an open app in sync with the server-side trigger sweep. Triggers run on
// the SERVER (server/triggers.js) — on a 60s sweep plus on demand. While the app
// is open we poke the run endpoint every 60s and then refetch (`bump`), so a
// user watching sees server-made changes (e.g. a row flipping to overdue) within
// a minute, instead of waiting for a manual reload. No-op when the app declares
// no triggers. (Triggers are ALSO poked right after each action — wired into the
// action runner, not here.)
export function useTriggerSweep(hasTriggers: boolean, base: string, bump: () => void): void {
  const bumpRef = useRef(bump)
  bumpRef.current = bump
  useEffect(() => {
    if (!hasTriggers) return
    let alive = true
    const run = async () => { await pokeTriggers(base); if (alive) bumpRef.current() }
    run()
    const id = setInterval(run, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [hasTriggers, base])
}
