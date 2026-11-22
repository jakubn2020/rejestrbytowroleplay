import { useEffect, useState } from 'react'

/** A number that counts up from 0 on first display (shown at once when animations are off). */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(value)

  useEffect(() => {
    const root = document.documentElement
    const reduced =
      root.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || value <= 0) {
      setShown(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(value * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    setShown(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return <>{shown}</>
}
