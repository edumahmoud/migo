import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * SSR-safe mobile detection hook.
 *
 * FIX: Initialize with `false` instead of `undefined` to avoid hydration mismatch.
 * On mobile clients, the first render will be `false` (desktop layout),
 * then the useEffect will update to `true` on mount. This is a deliberate
 * trade-off: we prefer a brief layout shift over a hydration mismatch warning
 * and React recovery re-render.
 *
 * The `undefined` initialization caused `!!undefined` → `false` on server
 * but `true` on mobile client after first effect, triggering hydration mismatch.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
