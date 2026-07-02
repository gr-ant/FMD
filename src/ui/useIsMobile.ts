import { useEffect, useState } from 'react'

// True on phone-sized viewports (and narrow desktop windows, so it's testable).
// Reacts live to viewport/orientation changes.
export function useIsMobile(query = '(max-width: 760px)'): boolean {
  const get = (): boolean => typeof window !== 'undefined' && window.matchMedia(query).matches
  const [mobile, setMobile] = useState<boolean>(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = (): void => setMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return mobile
}
