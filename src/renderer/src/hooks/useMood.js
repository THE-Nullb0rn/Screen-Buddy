import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ─── Named Constants Block (all rates and thresholds in ONE block) ───────────
export const MOOD_CONSTANTS = {
  // Stat boundaries & initial values
  STAT_MIN: 0,
  STAT_MAX: 100,
  INITIAL_AFFECTION: 60,
  INITIAL_ENERGY: 80,

  // Tick interval (once per 30 s)
  TICK_INTERVAL_MS: 30 * 1000,

  // Stat rates per 30 s tick
  // Affection drops 1 per 3 min (180 s) = 1/6 per 30 s with no interaction
  AFFECTION_DECAY_PER_TICK: 1 / 6,
  AFFECTION_NO_INTERACTION_THRESHOLD_MS: 3 * 60 * 1000,

  // Energy drops 1 per 4 min (240 s) = 1/8 per 30 s awake
  ENERGY_DECAY_PER_TICK_AWAKE: 1 / 8,
  // Energy rises 1 per 30 s in sleep pose
  ENERGY_GAIN_PER_TICK_SLEEP: 1,

  // Affection gains
  AFFECTION_GAIN_PET_START: 6,
  AFFECTION_GAIN_PET_CONTINUED: 2,
  PET_CONTINUED_INTERVAL_MS: 5 * 1000,
  AFFECTION_GAIN_CALL_SHORTCUT: 3,
  AFFECTION_GAIN_CHAT_REPLY: 2,
  AFFECTION_MAX_GAIN_ROLLING_WINDOW_MS: 60 * 1000,
  AFFECTION_MAX_GAIN_ROLLING_CAP: 15,

  // Thresholds for mood labels
  THRESHOLD_SLEEPY_ENERGY: 25,
  THRESHOLD_LONELY_AFFECTION: 30,
  THRESHOLD_HAPPY_AFFECTION: 70,
  THRESHOLD_HAPPY_ENERGY: 50,
  HYSTERESIS_OFFSET: 5,

  // Annoyed trigger parameters
  ANNOYED_BODY_CLICKS_COUNT: 5,
  ANNOYED_BODY_CLICKS_WINDOW_MS: 10 * 1000,
  ANNOYED_PETTING_TOTAL_THRESHOLD_MS: 30 * 1000,
  ANNOYED_PETTING_WINDOW_MS: 60 * 1000,
  ANNOYED_DURATION_MS: 60 * 1000,
  ANNOYED_TRIGGER_COOLDOWN_MS: 20 * 1000,

  // Indicator duration on mood label change
  MOOD_CHANGE_INDICATOR_DURATION_MS: 4 * 1000,

  // Remarks timing
  REMARK_INTERVAL_MS: 3 * 60 * 1000,

  // Persistence minimum interval
  PERSIST_INTERVAL_MS: 30 * 1000,
}

export const MOOD_EMOJIS = {
  Happy: '😊',
  Content: '🙂',
  Hungry: '🍖',
  Sleepy: '💤',
  Lonely: '🥺',
  Annoyed: '💢',
}

export const MOOD_REMARKS = {
  Hungry: ['so hungry...', 'is it dinner time?', 'feed me please!'],
  Sleepy: ['so sleepy...', '*yawns*', 'need a nap...'],
  Lonely: ['pet me?', 'where did you go?', 'pay attention to me!'],
  Annoyed: ['*hisses*', 'stop that!', 'grumpy now...'],
  Happy: ['life is good', '*purrs softly*', 'feeling great!'],
}

/**
 * Returns multipliers applied to behaviors depending on mood.
 */
export function moodModifiers(mood) {
  const mods = {
    toyplay: 1,
    play: 1,
    gift: 1,
    knockoff: 1,
    curious: 1,
    yawn: 1,
    groom: 1,
    proud: 1,
    sadWeight: 0,
    roamInterval: 1,
    roamChance: 1,
    roamChanceCap: null,
    sleepDelay: 1,
  }

  if (!mood) return mods

  switch (mood) {
    case 'Hungry':
      mods.toyplay = 0
      mods.play = 0
      mods.gift = 0
      mods.knockoff = 0
      mods.curious = 0.5
      mods.roamInterval = 1.5
      mods.sadWeight = 8
      break
    case 'Sleepy':
      mods.yawn = 3
      mods.groom = 0.5
      mods.toyplay = 0.3
      mods.play = 0.3
      mods.gift = 0.3
      mods.knockoff = 0.3
      mods.roamInterval = 1.6
      mods.roamChance = 0.6
      mods.sleepDelay = 0.6
      break
    case 'Lonely':
      mods.curious = 2.5
      mods.roamInterval = 0.7
      mods.roamChance = 1.3
      mods.roamChanceCap = 0.8
      mods.sadWeight = 8
      break
    case 'Annoyed':
      mods.toyplay = 0
      mods.play = 0
      mods.gift = 0
      mods.knockoff = 0
      mods.roamChance = 0.5
      break
    case 'Happy':
      mods.toyplay = 1.5
      mods.play = 1.5
      mods.groom = 1.5
      mods.proud = 1.5
      mods.roamInterval = 0.85
      break
    case 'Content':
    default:
      break
  }

  return mods
}

/**
 * Derives current mood label with hysteresis and priority:
 * Hungry > Sleepy > Lonely > Annoyed > Happy > Content.
 */
export function computeMoodLabel({
  isHungry,
  energy,
  affection,
  isAnnoyed,
  currentMood,
}) {
  // 1. Hungry (hungry-waiting)
  if (isHungry) {
    return 'Hungry'
  }

  // 2. Sleepy (energy < 25) with 5-point hysteresis
  const sleepyThreshold = currentMood === 'Sleepy'
    ? MOOD_CONSTANTS.THRESHOLD_SLEEPY_ENERGY + MOOD_CONSTANTS.HYSTERESIS_OFFSET
    : MOOD_CONSTANTS.THRESHOLD_SLEEPY_ENERGY
  if (energy < sleepyThreshold) {
    return 'Sleepy'
  }

  // 3. Lonely (affection < 30) with 5-point hysteresis
  const lonelyThreshold = currentMood === 'Lonely'
    ? MOOD_CONSTANTS.THRESHOLD_LONELY_AFFECTION + MOOD_CONSTANTS.HYSTERESIS_OFFSET
    : MOOD_CONSTANTS.THRESHOLD_LONELY_AFFECTION
  if (affection < lonelyThreshold) {
    return 'Lonely'
  }

  // 4. Annoyed (flag)
  if (isAnnoyed) {
    return 'Annoyed'
  }

  // 5. Happy (affection >= 70 && energy >= 50 && !isHungry) with 5-point hysteresis
  const happyAffectionThreshold = currentMood === 'Happy'
    ? MOOD_CONSTANTS.THRESHOLD_HAPPY_AFFECTION - MOOD_CONSTANTS.HYSTERESIS_OFFSET
    : MOOD_CONSTANTS.THRESHOLD_HAPPY_AFFECTION
  const happyEnergyThreshold = currentMood === 'Happy'
    ? MOOD_CONSTANTS.THRESHOLD_HAPPY_ENERGY - MOOD_CONSTANTS.HYSTERESIS_OFFSET
    : MOOD_CONSTANTS.THRESHOLD_HAPPY_ENERGY
  if (affection >= happyAffectionThreshold && energy >= happyEnergyThreshold && !isHungry) {
    return 'Happy'
  }

  // 6. Content (default)
  return 'Content'
}

export function useMood({
  moodEnabled = true,
  hungerState = 'IDLE',
  isSleeping = false,
  catRemarks = true,
  onTriggerRemark,
  playOneShot,
  developerMode = false,
  isIdleForRemarks = true,
  limitBackgroundCpu = false,
  idlePaused = false,
}) {
  const isDebug = Boolean(developerMode) ||
    (typeof process !== 'undefined' && (process.env?.SCREEN_BUDDY_DEBUG === '1' || process.env?.NODE_ENV === 'development'))

  // Stats state (clamped 0-100)
  const [affection, setAffection] = useState(MOOD_CONSTANTS.INITIAL_AFFECTION)
  const [energy, setEnergy] = useState(MOOD_CONSTANTS.INITIAL_ENERGY)
  const [isAnnoyed, setIsAnnoyed] = useState(false)
  const [mood, setMood] = useState('Content')
  const [recentMoodChange, setRecentMoodChange] = useState(false)

  // Derive "hungry-waiting" from hungerState
  const isHungry = hungerState === 'ACTIVE'
  const hungerStat = isHungry ? 100 : 0

  // Refs for tracking mutable state inside timers without stale closures
  const affectionRef = useRef(affection)
  affectionRef.current = affection
  const energyRef = useRef(energy)
  energyRef.current = energy
  const isAnnoyedRef = useRef(isAnnoyed)
  isAnnoyedRef.current = isAnnoyed
  const moodRef = useRef(mood)
  moodRef.current = mood
  const moodEnabledRef = useRef(moodEnabled)
  moodEnabledRef.current = moodEnabled
  const isSleepingRef = useRef(isSleeping)
  isSleepingRef.current = isSleeping
  const isHungryRef = useRef(isHungry)
  isHungryRef.current = isHungry
  const idlePausedRef = useRef(idlePaused)
  idlePausedRef.current = idlePaused

  const lastInteractionTimeRef = useRef(Date.now())
  const lastSavedTimeRef = useRef(0)
  const lastAnnoyedTriggerTimeRef = useRef(0)
  const annoyedTimeoutRef = useRef(null)
  const moodChangeTimerRef = useRef(null)
  const lastMoodRemarkTimeRef = useRef(Date.now())

  // Affection rolling 60s gain history: [{ time, amount }]
  const affectionGainsRef = useRef([])

  // Body clicks history: [timestamp]
  const bodyClicksRef = useRef([])

  // Petting tracking
  const isPettingRef = useRef(false)
  const pettingIntervalRef = useRef(null)
  const pettingHistoryRef = useRef([]) // [timestamp] recorded every 1s

  // Save latest state to main process
  const saveMoodState = useCallback((aff, nrg) => {
    if (!window.api?.saveMoodState) return
    const now = Date.now()
    lastSavedTimeRef.current = now
    window.api.saveMoodState({
      affection: Math.round(aff * 100) / 100,
      energy: Math.round(nrg * 100) / 100,
      savedAt: now,
    })
  }, [])

  // Trigger Annoyed state
  const triggerAnnoyed = useCallback(() => {
    if (!moodEnabledRef.current) return
    const now = Date.now()
    if (now - lastAnnoyedTriggerTimeRef.current < MOOD_CONSTANTS.ANNOYED_TRIGGER_COOLDOWN_MS) {
      return
    }
    lastAnnoyedTriggerTimeRef.current = now
    setIsAnnoyed(true)
    isAnnoyedRef.current = true

    if (isDebug) {
      console.log(
        `[useMood] Annoyed triggered! Stats: affection=${Math.round(affectionRef.current)}, energy=${Math.round(energyRef.current)}, hunger=${hungerStat}`
      )
    }

    // Play 'annoyed' one-shot animation once
    playOneShot?.('annoyed')

    // Optional remark if catRemarks is on
    if (catRemarks && onTriggerRemark) {
      const list = MOOD_REMARKS.Annoyed
      const text = list[Math.floor(Math.random() * list.length)]
      onTriggerRemark(text)
    }

    if (annoyedTimeoutRef.current) clearTimeout(annoyedTimeoutRef.current)
    annoyedTimeoutRef.current = setTimeout(() => {
      setIsAnnoyed(false)
      isAnnoyedRef.current = false
    }, MOOD_CONSTANTS.ANNOYED_DURATION_MS)
  }, [isDebug, hungerStat, playOneShot, catRemarks, onTriggerRemark])

  // Helper to add affection respecting rolling 60s limit and Annoyed guard
  const addAffection = useCallback((amount) => {
    if (!moodEnabledRef.current || isAnnoyedRef.current) return
    const now = Date.now()
    lastInteractionTimeRef.current = now

    // Clean old gains outside rolling window
    affectionGainsRef.current = affectionGainsRef.current.filter(
      (item) => now - item.time <= MOOD_CONSTANTS.AFFECTION_MAX_GAIN_ROLLING_WINDOW_MS
    )
    const recentTotal = affectionGainsRef.current.reduce((acc, item) => acc + item.amount, 0)
    const allowable = Math.max(0, MOOD_CONSTANTS.AFFECTION_MAX_GAIN_ROLLING_CAP - recentTotal)
    const effective = Math.min(amount, allowable)

    if (effective > 0) {
      affectionGainsRef.current.push({ time: now, amount: effective })
      setAffection((prev) => {
        const next = Math.min(MOOD_CONSTANTS.STAT_MAX, Math.max(MOOD_CONSTANTS.STAT_MIN, prev + effective))
        affectionRef.current = next
        return next
      })
    }
  }, [])

  // Interaction handlers exposed to Mascot
  const handlePetStart = useCallback(() => {
    lastInteractionTimeRef.current = Date.now()
    addAffection(MOOD_CONSTANTS.AFFECTION_GAIN_PET_START)
  }, [addAffection])

  const handleShortcutCall = useCallback(() => {
    lastInteractionTimeRef.current = Date.now()
    addAffection(MOOD_CONSTANTS.AFFECTION_GAIN_CALL_SHORTCUT)
  }, [addAffection])

  const handleChatReply = useCallback(() => {
    lastInteractionTimeRef.current = Date.now()
    addAffection(MOOD_CONSTANTS.AFFECTION_GAIN_CHAT_REPLY)
  }, [addAffection])

  const handleBodyClick = useCallback(() => {
    if (!moodEnabledRef.current) return
    const now = Date.now()
    lastInteractionTimeRef.current = now
    bodyClicksRef.current = bodyClicksRef.current.filter(
      (t) => now - t <= MOOD_CONSTANTS.ANNOYED_BODY_CLICKS_WINDOW_MS
    )
    bodyClicksRef.current.push(now)
    if (bodyClicksRef.current.length >= MOOD_CONSTANTS.ANNOYED_BODY_CLICKS_COUNT) {
      bodyClicksRef.current = []
      triggerAnnoyed()
    }
  }, [triggerAnnoyed])

  const handlePetStateChange = useCallback((isPetting) => {
    isPettingRef.current = isPetting
    if (pettingIntervalRef.current) {
      clearInterval(pettingIntervalRef.current)
      pettingIntervalRef.current = null
    }

    if (isPetting) {
      lastInteractionTimeRef.current = Date.now()
      let continuedTicks = 0
      pettingIntervalRef.current = setInterval(() => {
        if (!isPettingRef.current || !moodEnabledRef.current) return
        const now = Date.now()
        lastInteractionTimeRef.current = now

        // Record 1s petting slice for rolling 60s total petting calculation
        pettingHistoryRef.current.push(now)
        pettingHistoryRef.current = pettingHistoryRef.current.filter(
          (t) => now - t <= MOOD_CONSTANTS.ANNOYED_PETTING_WINDOW_MS
        )

        // If total petting in rolling 60 s window > 30 s, trigger Annoyed
        if (pettingHistoryRef.current.length >= 30) {
          pettingHistoryRef.current = []
          triggerAnnoyed()
          return
        }

        continuedTicks += 1
        // Every 5 seconds of continued petting: +2 affection
        if (continuedTicks % 5 === 0) {
          addAffection(MOOD_CONSTANTS.AFFECTION_GAIN_PET_CONTINUED)
        }
      }, 1000)
    }
  }, [triggerAnnoyed, addAffection])

  // Load caught-up state on mount
  useEffect(() => {
    let isMounted = true
    if (window.api?.getMoodState) {
      window.api.getMoodState().then((saved) => {
        if (!isMounted || !saved) return
        if (typeof saved.affection === 'number' && Number.isFinite(saved.affection)) {
          const clampedAffection = Math.min(100, Math.max(0, saved.affection))
          setAffection(clampedAffection)
          affectionRef.current = clampedAffection
        }
        if (typeof saved.energy === 'number' && Number.isFinite(saved.energy)) {
          const clampedEnergy = Math.min(100, Math.max(0, saved.energy))
          setEnergy(clampedEnergy)
          energyRef.current = clampedEnergy
        }
      }).catch((err) => {
        console.error('[useMood] Error loading mood state:', err)
      })
    }
    return () => {
      isMounted = false
    }
  }, [])

  // Single 30 s tick interval
  useEffect(() => {
    if (!moodEnabled) return undefined

    const tick = setInterval(() => {
      if (typeof window !== 'undefined' && window.__sbPerfCounters) {
        window.__sbPerfCounters.timerTicks++
      }
      if (!moodEnabledRef.current || idlePausedRef.current) return

      const now = Date.now()

      // Affection decay: drops 1 per 3 min with no interaction (paused while sleeping)
      if (isSleepingRef.current) {
        lastInteractionTimeRef.current = now
      } else {
        const noInteractTime = now - lastInteractionTimeRef.current
        if (noInteractTime >= MOOD_CONSTANTS.AFFECTION_NO_INTERACTION_THRESHOLD_MS) {
          setAffection((prev) => {
            const next = Math.max(MOOD_CONSTANTS.STAT_MIN, prev - MOOD_CONSTANTS.AFFECTION_DECAY_PER_TICK)
            affectionRef.current = next
            return next
          })
        }
      }

      // Energy update: drops 1 per 4 min while awake, rises 1 per 30 s while asleep
      setEnergy((prev) => {
        let next = prev
        if (isSleepingRef.current) {
          next = Math.min(MOOD_CONSTANTS.STAT_MAX, prev + MOOD_CONSTANTS.ENERGY_GAIN_PER_TICK_SLEEP)
        } else {
          next = Math.max(MOOD_CONSTANTS.STAT_MIN, prev - MOOD_CONSTANTS.ENERGY_DECAY_PER_TICK_AWAKE)
        }
        energyRef.current = next
        return next
      })

      // Send state to main process at most once per 30 s
      saveMoodState(affectionRef.current, energyRef.current)
    }, MOOD_CONSTANTS.TICK_INTERVAL_MS)

    return () => {
      clearInterval(tick)
    }
  }, [moodEnabled, saveMoodState])

  // Periodic remarks check for active moods (say a mood line at most once per 3 min, only when idle and not for Content)
  useEffect(() => {
    if (!moodEnabled || !catRemarks) return undefined

    const intervalMs = limitBackgroundCpu ? 20000 : 10000
    const remarkInterval = setInterval(() => {
      if (typeof window !== 'undefined' && window.__sbPerfCounters) {
        window.__sbPerfCounters.timerTicks++
      }
      if (!moodEnabledRef.current || idlePausedRef.current || isSleepingRef.current) return
      const currentMood = moodRef.current
      if (!currentMood || currentMood === 'Content') return

      const now = Date.now()
      const minInterval = limitBackgroundCpu
        ? MOOD_CONSTANTS.REMARK_INTERVAL_MS * 2
        : MOOD_CONSTANTS.REMARK_INTERVAL_MS
      if (now - lastMoodRemarkTimeRef.current < minInterval) return

      if (isIdleForRemarks && onTriggerRemark && MOOD_REMARKS[currentMood]) {
        const pool = MOOD_REMARKS[currentMood]
        const text = pool[Math.floor(Math.random() * pool.length)]
        lastMoodRemarkTimeRef.current = now
        onTriggerRemark(text)
      }
    }, intervalMs)

    return () => {
      clearInterval(remarkInterval)
    }
  }, [moodEnabled, catRemarks, isIdleForRemarks, onTriggerRemark, limitBackgroundCpu])

  // Recompute mood label whenever stats, hungry, or annoyed change
  useEffect(() => {
    if (!moodEnabled) {
      setMood(null)
      moodRef.current = null
      return
    }

    const nextMood = computeMoodLabel({
      isHungry,
      energy,
      affection,
      isAnnoyed,
      currentMood: moodRef.current,
    })

    if (nextMood !== moodRef.current) {
      if (isDebug) {
        console.log(
          `[useMood] Mood changed to "${nextMood}": affection=${Math.round(affection)}, energy=${Math.round(energy)}, hunger=${hungerStat}`
        )
      }
      setMood(nextMood)
      moodRef.current = nextMood

      // Persist state immediately on mood label change
      saveMoodState(affection, energy)

      // Show indicator for 4 s whenever the mood changes
      setRecentMoodChange(true)
      if (moodChangeTimerRef.current) clearTimeout(moodChangeTimerRef.current)
      moodChangeTimerRef.current = setTimeout(() => {
        setRecentMoodChange(false)
      }, MOOD_CONSTANTS.MOOD_CHANGE_INDICATOR_DURATION_MS)
    }
  }, [moodEnabled, isHungry, energy, affection, isAnnoyed, isDebug, hungerStat, saveMoodState])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (annoyedTimeoutRef.current) clearTimeout(annoyedTimeoutRef.current)
      if (moodChangeTimerRef.current) clearTimeout(moodChangeTimerRef.current)
      if (pettingIntervalRef.current) clearInterval(pettingIntervalRef.current)
      if (moodEnabledRef.current) {
        saveMoodState(affectionRef.current, energyRef.current)
      }
    }
  }, [saveMoodState])

  const roundedAffection = Math.round(affection)
  const roundedEnergy = Math.round(energy)
  const stats = useMemo(() => ({
    affection: roundedAffection,
    energy: roundedEnergy,
    hunger: hungerStat,
  }), [roundedAffection, roundedEnergy, hungerStat])

  return {
    mood: moodEnabled ? mood : null,
    stats,
    isAnnoyed,
    recentMoodChange,
    handlePetStart,
    handlePetStateChange,
    handleBodyClick,
    handleShortcutCall,
    handleChatReply,
    addAffection,
    moodModifiers,
  }
}
