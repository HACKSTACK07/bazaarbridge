import { useEffect, useRef, useCallback } from 'react'

export function usePolling(fn, ms) {
  const intervalRef = useRef(null)
  const fnRef = useRef(fn)

  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const tick = useCallback(async () => {
    try {
      await fnRef.current()
    } catch (err) {
      console.error('[usePolling] error:', err)
    }
  }, [])

  useEffect(() => {
    if (!ms || ms <= 0) {
      return
    }

    tick()
    intervalRef.current = setInterval(tick, ms)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [ms, tick])

  return { stop: () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }}
}

export default usePolling