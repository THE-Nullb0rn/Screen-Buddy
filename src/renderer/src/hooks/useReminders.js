/**
 * Reminders hook: manages individual reminder timers, snooze timers, queueing,
 * auto-dismiss, and card state synchronization.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export const REMINDER_STATE = {
  IDLE_COUNTING: 'IDLE_COUNTING',
  ENTRANCE: 'ENTRANCE',
  ACTIVE: 'ACTIVE',
  EXIT: 'EXIT',
}

const ENTRANCE_DURATION_MS = 1000
const EXIT_DURATION_MS = 800

const DEFAULT_BUILTIN_MESSAGES = {
  water: {
    title: 'Water Break',
    text: 'Time to hydrate!',
    icon: 'Droplet',
  },
  eyeRest: {
    title: 'Eye Rest',
    text: 'Rest your eyes — look at something 20ft away',
    icon: 'Eye',
  },
  movementBreak: {
    title: 'Movement Break',
    text: 'Time to get up and move!!',
    icon: 'Footprints',
  },
  pomodoroWorkEnd: {
    title: 'Pomodoro Done!',
    text: 'Pomodoro complete — take a 5 min break!',
    icon: 'Timer',
  },
  pomodoroBreakEnd: {
    title: "Break's Over",
    text: "Break's over — back to work!",
    icon: 'Timer',
  },
}

export function useReminders({
  settings,
  paused,
  chatState,
  notificationVisible,
  isAsleep,
}) {
  const [reminderState, setReminderState] = useState(REMINDER_STATE.IDLE_COUNTING)
  const [currentReminder, setCurrentReminder] = useState(null)
  const [reminderType, setReminderType] = useState('water')
  const [reminderData, setReminderData] = useState(DEFAULT_BUILTIN_MESSAGES.water)
  const [countdown, setCountdown] = useState(0)

  const isReminderActive =
    reminderState === REMINDER_STATE.ENTRANCE ||
    reminderState === REMINDER_STATE.ACTIVE ||
    reminderState === REMINDER_STATE.EXIT

  const settingsRef = useRef(settings)
  const pausedRef = useRef(paused)
  const chatStateRef = useRef(chatState)
  const notificationVisibleRef = useRef(notificationVisible)
  const isAsleepRef = useRef(isAsleep)
  const reminderStateRef = useRef(reminderState)
  const currentReminderRef = useRef(currentReminder)

  const queueRef = useRef([])
  const remainingTimesRef = useRef(new Map())
  const snoozeTimesRef = useRef(new Map())

  const entranceTimerRef = useRef(null)
  const exitTimerRef = useRef(null)
  const autoDismissTimerRef = useRef(null)

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { chatStateRef.current = chatState }, [chatState])
  useEffect(() => { notificationVisibleRef.current = notificationVisible }, [notificationVisible])
  useEffect(() => { isAsleepRef.current = isAsleep }, [isAsleep])
  useEffect(() => { reminderStateRef.current = reminderState }, [reminderState])
  useEffect(() => { currentReminderRef.current = currentReminder }, [currentReminder])

  const startReminderRef = useRef(null)

  const dismissReminder = useCallback(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }
    if (entranceTimerRef.current) {
      clearTimeout(entranceTimerRef.current)
      entranceTimerRef.current = null
    }

    setReminderState(REMINDER_STATE.EXIT)

    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = setTimeout(() => {
      setReminderState(REMINDER_STATE.IDLE_COUNTING)
      setCurrentReminder(null)
      currentReminderRef.current = null

      // Check if there are queued reminders ready to display
      if (
        queueRef.current.length > 0 &&
        settingsRef.current?.remindersEnabled !== false &&
        !pausedRef.current &&
        chatStateRef.current === 'idle' &&
        !notificationVisibleRef.current &&
        !isAsleepRef.current
      ) {
        const next = queueRef.current.shift()
        startReminderRef.current?.(next)
      }
    }, EXIT_DURATION_MS)
  }, [])

  const startReminder = useCallback((item) => {
    if (!item) return
    currentReminderRef.current = item
    setCurrentReminder(item)
    setReminderType(item.id)

    let data
    if (DEFAULT_BUILTIN_MESSAGES[item.id]) {
      data = DEFAULT_BUILTIN_MESSAGES[item.id]
    } else {
      data = {
        title: item.name || 'Reminder',
        text: item.message || '',
        icon: item.icon || 'Bell',
      }
    }
    setReminderData(data)

    setReminderState(REMINDER_STATE.ENTRANCE)

    if (entranceTimerRef.current) clearTimeout(entranceTimerRef.current)
    entranceTimerRef.current = setTimeout(() => {
      setReminderState(REMINDER_STATE.ACTIVE)

      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
        autoDismissTimerRef.current = null
      }

      if (item.id === 'movementBreak') {
        autoDismissTimerRef.current = setTimeout(() => {
          dismissReminder()
        }, 6500)
      } else if (settingsRef.current?.notificationAutoHide !== false) {
        const timeoutMs = (settingsRef.current?.notificationDuration ?? 5) * 1000
        autoDismissTimerRef.current = setTimeout(() => {
          dismissReminder()
        }, timeoutMs)
      }
    }, ENTRANCE_DURATION_MS)
  }, [dismissReminder])

  // Re-sync reminder auto-dismiss timer on duration or autoHide change
  useEffect(() => {
    if (reminderState === REMINDER_STATE.ACTIVE && currentReminderRef.current?.id !== 'movementBreak') {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
        autoDismissTimerRef.current = null
      }
      if (settings?.notificationAutoHide !== false) {
        const dur = (settings?.notificationDuration ?? 5) * 1000
        autoDismissTimerRef.current = setTimeout(() => {
          dismissReminder()
        }, dur)
      }
    }
  }, [settings?.notificationAutoHide, settings?.notificationDuration, reminderState, dismissReminder])

  useEffect(() => {
    startReminderRef.current = startReminder
  }, [startReminder])

  const snoozeReminder = useCallback(() => {
    const item = currentReminderRef.current
    if (!item) return

    const snoozeMinutes = settingsRef.current?.reminderSnoozeDuration || 5
    const snoozeSec = snoozeMinutes * 60
    snoozeTimesRef.current.set(item.id, {
      reminder: item,
      remaining: snoozeSec,
    })

    dismissReminder()
  }, [dismissReminder])

  const triggerReminder = useCallback((typeOrId) => {
    if (settingsRef.current?.remindersEnabled === false) return

    let item = null
    const list = settingsRef.current?.remindersList || []
    if (typeOrId) {
      item = list.find((r) => r.id === typeOrId && r.enabled !== false)
      if (!item) {
        const def = DEFAULT_BUILTIN_MESSAGES[typeOrId]
        if (def) {
          item = {
            id: typeOrId,
            type: 'builtin',
            name: def.title,
            message: def.text,
            icon: def.icon,
            enabled: true,
          }
        } else {
          const enabledList = list.filter((r) => r.enabled !== false)
          item = enabledList[0] || null
        }
      }
    } else {
      const enabledList = list.filter((r) => r.enabled !== false)
      if (enabledList.length > 0) {
        item = enabledList[0]
      }
    }

    if (!item) return

    const canStart =
      reminderStateRef.current === REMINDER_STATE.IDLE_COUNTING &&
      !pausedRef.current &&
      chatStateRef.current === 'idle' &&
      !notificationVisibleRef.current &&
      !isAsleepRef.current

    if (canStart) {
      startReminder(item)
    } else {
      const isDuplicate =
        currentReminderRef.current?.id === item.id ||
        queueRef.current.some((q) => q.id === item.id)
      if (!isDuplicate) {
        queueRef.current.push(item)
      }
    }
  }, [startReminder])

  // Reset/sync reminders when master toggle is disabled
  const remindersEnabled = settings?.remindersEnabled !== false
  useEffect(() => {
    if (!remindersEnabled) {
      queueRef.current = []
      snoozeTimesRef.current.clear()
      remainingTimesRef.current.clear()
      if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current)
      if (entranceTimerRef.current) clearTimeout(entranceTimerRef.current)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      setReminderState(REMINDER_STATE.IDLE_COUNTING)
      setCurrentReminder(null)
      currentReminderRef.current = null
      setCountdown(0)
    }
  }, [remindersEnabled])

  // Tick interval: 1 second
  useEffect(() => {
    if (!settings || settings.remindersEnabled === false) return

    const tick = setInterval(() => {
      const s = settingsRef.current
      if (!s || s.remindersEnabled === false || pausedRef.current) {
        return
      }

      const list = s.remindersList || []
      const enabledItems = list.filter((r) => r.enabled !== false)
      const globalIntervalSec = (s.intervalMinutes || 20) * 60

      let minRemaining = Infinity

      // 1. Process active reminder timers
      for (const item of enabledItems) {
        const effectiveSec =
          typeof item.intervalMinutes === 'number' && item.intervalMinutes > 0
            ? item.intervalMinutes * 60
            : globalIntervalSec

        let curRemaining = remainingTimesRef.current.get(item.id)
        if (curRemaining === undefined || curRemaining > effectiveSec) {
          curRemaining = effectiveSec
        }

        curRemaining -= 1

        if (curRemaining <= 0) {
          curRemaining = effectiveSec
          remainingTimesRef.current.set(item.id, effectiveSec)

          // Add to queue if not duplicate
          const isDuplicate =
            currentReminderRef.current?.id === item.id ||
            queueRef.current.some((q) => q.id === item.id)
          if (!isDuplicate) {
            queueRef.current.push(item)
          }
        } else {
          remainingTimesRef.current.set(item.id, curRemaining)
        }

        if (curRemaining < minRemaining) {
          minRemaining = curRemaining
        }
      }

      // 2. Process snooze timers
      for (const [id, entry] of snoozeTimesRef.current.entries()) {
        entry.remaining -= 1
        if (entry.remaining <= 0) {
          snoozeTimesRef.current.delete(id)
          const isDuplicate =
            currentReminderRef.current?.id === id ||
            queueRef.current.some((q) => q.id === id)
          if (!isDuplicate) {
            queueRef.current.push(entry.reminder)
          }
        } else if (entry.remaining < minRemaining) {
          minRemaining = entry.remaining
        }
      }

      setCountdown(Number.isFinite(minRemaining) && minRemaining !== Infinity ? minRemaining : 0)

      // 3. Process queue if idle and guards pass
      if (
        reminderStateRef.current === REMINDER_STATE.IDLE_COUNTING &&
        queueRef.current.length > 0 &&
        !pausedRef.current &&
        chatStateRef.current === 'idle' &&
        !notificationVisibleRef.current &&
        !isAsleepRef.current
      ) {
        const next = queueRef.current.shift()
        startReminder(next)
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [settings, startReminder])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current)
      if (entranceTimerRef.current) clearTimeout(entranceTimerRef.current)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, [])

  return {
    reminderState,
    reminderType,
    currentReminder,
    reminderData,
    isReminderActive,
    triggerReminder,
    dismissReminder,
    snoozeReminder,
    countdown,
  }
}
