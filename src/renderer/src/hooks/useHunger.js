// Needs hook: a future mood system will read hungerLevel (and later play/boredom) from here.

import { useState, useEffect, useRef, useCallback } from 'react'

const HUNGER_SNOOZE_SECONDS = 10 * 60 // 10 minutes

function getRandomHungerDuration(rate = 'normal') {
  let minMinutes = 20
  let maxMinutes = 40
  if (rate === 'slow') {
    minMinutes = 40
    maxMinutes = 80
  } else if (rate === 'fast') {
    minMinutes = 10
    maxMinutes = 20
  }
  return Math.floor((minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60)
}

export function useHunger({
  settings,
  paused = false,
  isReminderActive = false,
}) {
  const hungerEnabled = Boolean(settings?.hungerEnabled)
  const hungerRate = settings?.hungerRate || 'normal'
  const hungerNotify = settings?.hungerNotify !== false
  const hungerPauseSleeping = settings?.hungerPauseSleeping !== false

  const [hungerState, setHungerState] = useState('IDLE')
  const [totalDuration, setTotalDuration] = useState(() => getRandomHungerDuration(hungerRate))
  const [remainingSeconds, setRemainingSeconds] = useState(totalDuration)
  const [feedSignal, setFeedSignal] = useState(0)
  const [isAsleep, setIsAsleep] = useState(false)

  const hungerStateRef = useRef(hungerState)
  hungerStateRef.current = hungerState

  const isAsleepRef = useRef(isAsleep)
  isAsleepRef.current = isAsleep

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const hungerEnabledRef = useRef(hungerEnabled)
  const hungerRateRef = useRef(hungerRate)
  hungerRateRef.current = hungerRate

  const hungerPauseSleepingRef = useRef(hungerPauseSleeping)
  hungerPauseSleepingRef.current = hungerPauseSleeping

  // Sleep change callback passed to Mascot
  const handleSleepChange = useCallback((asleep) => {
    setIsAsleep(asleep)
    isAsleepRef.current = asleep

    // When waking up, if countdown has already expired, activate hunger
    if (!asleep && hungerEnabledRef.current && hungerStateRef.current === 'IDLE') {
      setRemainingSeconds((prev) => {
        if (prev <= 0) {
          setHungerState('ACTIVE')
          return 0
        }
        return prev
      })
    }
  }, [])

  // Feeding logic
  const handleFeed = useCallback(() => {
    setHungerState('IDLE')
    const nextDuration = getRandomHungerDuration(hungerRateRef.current)
    setTotalDuration(nextDuration)
    setRemainingSeconds(nextDuration)
    setFeedSignal((s) => s + 1)
  }, [])

  // Snooze logic (X button on hunger bubble)
  const handleSnooze = useCallback(() => {
    setHungerState('IDLE')
    setTotalDuration(HUNGER_SNOOZE_SECONDS)
    setRemainingSeconds(HUNGER_SNOOZE_SECONDS)
  }, [])

  // React to hungerEnabled toggle:
  // Turning off stops countdown and resets to IDLE.
  // Turning on starts a fresh countdown.
  useEffect(() => {
    const wasEnabled = hungerEnabledRef.current
    hungerEnabledRef.current = hungerEnabled

    if (!hungerEnabled) {
      setHungerState('IDLE')
      setRemainingSeconds(0)
    } else if (!wasEnabled) {
      setHungerState('IDLE')
      const nextDuration = getRandomHungerDuration(hungerRateRef.current)
      setTotalDuration(nextDuration)
      setRemainingSeconds(nextDuration)
    }
  }, [hungerEnabled])

  // Countdown timer tick (every 1 second)
  useEffect(() => {
    const tick = setInterval(() => {
      if (pausedRef.current || !hungerEnabledRef.current) return
      if (hungerStateRef.current !== 'IDLE') return

      // Pause while sleeping if configured
      if (hungerPauseSleepingRef.current && isAsleepRef.current) return

      setRemainingSeconds((prev) => {
        const next = Math.max(0, prev - 1)
        if (next === 0) {
          // If cat is asleep, do not activate hunger yet; wait until wake
          if (!isAsleepRef.current) {
            setHungerState('ACTIVE')
          }
          return 0
        }
        return next
      })
    }, 1000)

    return () => clearInterval(tick)
  }, [])

  // Listen for tray test hunger event
  useEffect(() => {
    const offTestHunger = window.api?.on?.('tray:test-hunger', () => {
      setHungerState('ACTIVE')
    })
    return () => {
      offTestHunger?.()
    }
  }, [])

  // Calculate hungerLevel: 0 (just fed) to 1 (hungry)
  let hungerLevel = 0
  if (hungerEnabled) {
    if (hungerState === 'ACTIVE') {
      hungerLevel = 1
    } else if (totalDuration > 0) {
      const elapsed = Math.max(0, totalDuration - remainingSeconds)
      hungerLevel = Math.min(1, Math.max(0, elapsed / totalDuration))
    }
  }

  // showHunger: hunger card shows only if hunger is active, hungerNotify is on, and no reminder is active
  const showHunger = Boolean(
    hungerEnabled &&
    hungerNotify &&
    hungerState === 'ACTIVE' &&
    !isReminderActive
  )

  return {
    hungerState,
    hungerLevel,
    showHunger,
    feedSignal,
    isAsleep,
    handleFeed,
    handleSnooze,
    handleSleepChange,
  }
}
