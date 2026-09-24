/**
 * screen-buddy — root App component
 *
 * Owns:
 *  - The top-level reminder state machine (IDLE_COUNTING → ENTRANCE → ACTIVE → EXIT)
 *  - Reminder types (water, eyeRest, movementBreak) and rotation
 *  - Pomodoro timer (25m work / 5m break) & Stopwatch
 *  - Interval timer that drives the state machine
 *  - IPC subscriptions for tray events and power monitor events
 *  - Settings state (fetched from main process, shared down via props)
 *  - Settings modal open/close state
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Mascot from './components/Mascot'
import SettingsModal from './components/SettingsModal'

// ─── State machine constants ─────────────────────────────────────────────────
const REMINDER_STATE = {
  IDLE_COUNTING: 'IDLE_COUNTING',
  ENTRANCE: 'ENTRANCE',
  ACTIVE: 'ACTIVE',
  EXIT: 'EXIT',
}

const ENTRANCE_DURATION_MS = 1000
const EXIT_DURATION_MS = 800

const POMODORO_WORK_SEC = 25 * 60
const POMODORO_BREAK_SEC = 5 * 60
const POMODORO_CELEBRATION_MS = 1200

const ALL_REMINDER_TYPES = ['water', 'eyeRest', 'movementBreak']

function getEnabledReminderTypes(s) {
  const reminders = s?.reminders || {}
  const enabled = ALL_REMINDER_TYPES.filter((t) => reminders[t] !== false)
  return enabled.length > 0 ? enabled : ALL_REMINDER_TYPES
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const remM = m % 60
    return `${h}:${String(remM).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function App() {
  // ── Settings ───────────────────────────────────────────────────────────────
  const [settings, setSettingsState] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ── Reminder state machine ─────────────────────────────────────────────────
  const [reminderState, setReminderState] = useState(REMINDER_STATE.IDLE_COUNTING)
  const [reminderType, setReminderType] = useState('water')

  // ── Hunger state ───────────────────────────────────────────────────────────
  const [hungerState, setHungerState] = useState('IDLE')
  const [hungerCountdown, setHungerCountdown] = useState(() => Math.floor((20 + Math.random() * 20) * 60))

  // ── Pomodoro & Stopwatch state ─────────────────────────────────────────────
  const [timerMode, setTimerMode] = useState('none') // 'none' | 'pomodoro-work' | 'pomodoro-break' | 'stopwatch'
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [pomodoroCelebrating, setPomodoroCelebrating] = useState(false)

  // Whether reminders/timers are paused
  const [paused, setPaused] = useState(false)

  // ── Media playback state ───────────────────────────────────────────────────
  const [mediaStatus, setMediaStatus] = useState({ playing: false, artist: '', title: '' })
  const [nowPlayingVisible, setNowPlayingVisible] = useState(false)

  // Countdown displayed in development / debug overlay
  const [countdown, setCountdown] = useState(0)

  const pausedRef = useRef(paused)
  const settingsRef = useRef(settings)
  const reminderStateRef = useRef(reminderState)
  const reminderIndexRef = useRef(0)
  const hungerStateRef = useRef(hungerState)

  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { reminderStateRef.current = reminderState }, [reminderState])
  useEffect(() => { hungerStateRef.current = hungerState }, [hungerState])

  // ── Load settings from main process on mount ──────────────────────────────
  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettingsState(s)
      setPaused(s.paused)
    })
  }, [])

  // ── State machine transitions ─────────────────────────────────────────────
  const triggerReminder = useCallback((type) => {
    let resolvedType = type
    if (!resolvedType) {
      const enabled = getEnabledReminderTypes(settingsRef.current)
      resolvedType = enabled[reminderIndexRef.current % enabled.length]
      reminderIndexRef.current = (reminderIndexRef.current + 1) % enabled.length
    }
    setReminderType(resolvedType)
    setReminderState(REMINDER_STATE.ENTRANCE)

    setTimeout(() => {
      setReminderState(REMINDER_STATE.ACTIVE)
    }, ENTRANCE_DURATION_MS)
  }, [])

  const dismissReminder = useCallback(() => {
    setReminderState(REMINDER_STATE.EXIT)

    setTimeout(() => {
      setReminderState(REMINDER_STATE.IDLE_COUNTING)
    }, EXIT_DURATION_MS)
  }, [])

  const handleFeed = useCallback(() => {
    setHungerState('IDLE')
    setHungerCountdown(Math.floor((20 + Math.random() * 20) * 60))
  }, [])

  // ── Auto-dismiss after a few seconds if not manually dismissed ────────────
  useEffect(() => {
    if (reminderState !== REMINDER_STATE.ACTIVE) return

    const isBig = reminderType === 'movementBreak'
    const timeoutMs = isBig ? 6500 : 12000

    const timer = setTimeout(() => {
      dismissReminder()
    }, timeoutMs)

    return () => clearTimeout(timer)
  }, [reminderState, reminderType, dismissReminder])

  // ── Timer: drives IDLE_COUNTING countdown & rotation ──────────────────────
  useEffect(() => {
    if (!settings) return

    const intervalSec = (settings.intervalMinutes || 20) * 60
    let remaining = intervalSec
    setCountdown(remaining)

    const tick = setInterval(() => {
      if (
        pausedRef.current ||
        reminderStateRef.current !== REMINDER_STATE.IDLE_COUNTING
      ) {
        return
      }

      remaining -= 1
      setCountdown(remaining)

      if (remaining <= 0) {
        remaining = intervalSec
        setCountdown(remaining)

        const enabled = getEnabledReminderTypes(settingsRef.current)
        const nextType = enabled[reminderIndexRef.current % enabled.length]
        reminderIndexRef.current = (reminderIndexRef.current + 1) % enabled.length
        triggerReminder(nextType)
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [settings, triggerReminder])

  // ── Hunger Timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      if (pausedRef.current) return
      if (hungerStateRef.current === 'IDLE') {
        setHungerCountdown((prev) => {
          const next = prev - 1
          if (next <= 0) {
            setHungerState('ACTIVE')
            return 0
          }
          return next
        })
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  // ── Pomodoro / Stopwatch Controls ─────────────────────────────────────────
  const startPomodoro = useCallback((workSec = POMODORO_WORK_SEC) => {
    setPomodoroCelebrating(false)
    setTimerMode('pomodoro-work')
    setTimerSeconds(workSec)
    setTimerRunning(true)
    window.api.updateTimerStatus({
      mode: 'pomodoro-work',
      formattedTime: formatTime(workSec),
      running: true,
    })
  }, [])

  const startStopwatch = useCallback(() => {
    setPomodoroCelebrating(false)
    setTimerMode('stopwatch')
    setTimerSeconds(0)
    setTimerRunning(true)
    window.api.updateTimerStatus({
      mode: 'stopwatch',
      formattedTime: '00:00',
      running: true,
    })
  }, [])

  const stopTimer = useCallback(() => {
    setPomodoroCelebrating(false)
    setTimerMode('none')
    setTimerSeconds(0)
    setTimerRunning(false)
    window.api.updateTimerStatus({
      mode: 'none',
      formattedTime: '',
      running: false,
    })
  }, [])

  // A completed work session gets a small, local celebration before its normal
  // reminder card appears. Keeping this separate from the reminder state means
  // it never inherits the large movement-break treatment.
  const finishPomodoroWork = useCallback(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[pomodoro] Work session complete — starting jump celebration')
    }
    setPomodoroCelebrating(true)
    setTimerMode('pomodoro-break')
    window.api.updateTimerStatus({
      mode: 'pomodoro-break',
      formattedTime: formatTime(POMODORO_BREAK_SEC),
      running: true,
    })
  }, [])

  // Hold the jump loop long enough for two clear jumps before showing
  // the normal completion card. The cleanup lets Stop / Reset cancel it.
  useEffect(() => {
    if (!pomodoroCelebrating) return

    const celebrationTimer = setTimeout(() => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[pomodoro] Jump celebration complete — showing reminder')
      }
      setPomodoroCelebrating(false)
      triggerReminder('pomodoroWorkEnd')
    }, POMODORO_CELEBRATION_MS)

    return () => clearTimeout(celebrationTimer)
  }, [pomodoroCelebrating, triggerReminder])

  // ── Pomodoro & Stopwatch Tick ─────────────────────────────────────────────
  useEffect(() => {
    if (!timerRunning || timerMode === 'none') return

    const interval = setInterval(() => {
      if (pausedRef.current) return // Respect pause!

      if (timerMode === 'stopwatch') {
        setTimerSeconds((prev) => {
          const next = prev + 1
          window.api.updateTimerStatus({
            mode: 'stopwatch',
            formattedTime: formatTime(next),
            running: true,
          })
          return next
        })
      } else if (timerMode === 'pomodoro-work') {
        setTimerSeconds((prev) => {
          if (prev <= 1) {
            finishPomodoroWork()
            return POMODORO_BREAK_SEC
          }
          const next = prev - 1
          window.api.updateTimerStatus({
            mode: 'pomodoro-work',
            formattedTime: formatTime(next),
            running: true,
          })
          return next
        })
      } else if (timerMode === 'pomodoro-break') {
        setTimerSeconds((prev) => {
          if (prev <= 1) {
            triggerReminder('pomodoroBreakEnd')
            setTimerMode('pomodoro-work')
            window.api.updateTimerStatus({
              mode: 'pomodoro-work',
              formattedTime: formatTime(POMODORO_WORK_SEC),
              running: true,
            })
            return POMODORO_WORK_SEC
          }
          const next = prev - 1
          window.api.updateTimerStatus({
            mode: 'pomodoro-break',
            formattedTime: formatTime(next),
            running: true,
          })
          return next
        })
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [timerRunning, timerMode, finishPomodoroWork, triggerReminder])

  // ── IPC: tray push events ─────────────────────────────────────────────────
  useEffect(() => {
    const offTest = window.api.on('tray:test-reminder', (data) => {
      if (reminderStateRef.current === REMINDER_STATE.IDLE_COUNTING) {
        triggerReminder(data?.type)
      }
    })

    const offTestHunger = window.api.on('tray:test-hunger', () => {
      setHungerState('ACTIVE')
    })

    const offTrigger = window.api.on('reminder:trigger', (data) => {
      if (reminderStateRef.current === REMINDER_STATE.IDLE_COUNTING) {
        triggerReminder(data?.type)
      }
    })

    const offStartPomodoro = window.api.on('timer:start-pomodoro', () => {
      startPomodoro()
    })

    const offStartStopwatch = window.api.on('timer:start-stopwatch', () => {
      startStopwatch()
    })

    const offStopTimer = window.api.on('timer:stop', () => {
      stopTimer()
    })

    const offTestPomodoro = window.api.on('timer:test-pomodoro-work-end', () => {
      startPomodoro(5) // Fast 5s pomodoro for instant verification
    })

    const offSettings = window.api.on('tray:open-settings', () => {
      setSettingsOpen(true)
    })

    const offPause = window.api.on('tray:pause-state', (isPaused) => {
      setPaused(isPaused)
    })

    return () => {
      offTest()
      offTestHunger()
      offTrigger()
      offStartPomodoro()
      offStartStopwatch()
      offStopTimer()
      offTestPomodoro()
      offSettings()
      offPause()
    }
  }, [triggerReminder, startPomodoro, startStopwatch, stopTimer])

  // ── IPC: power monitor events ─────────────────────────────────────────────
  useEffect(() => {
    const offSuspend = window.api.on('power:suspend', () => setPaused(true))
    const offLock = window.api.on('power:lock-screen', () => setPaused(true))

    const offResume = window.api.on('power:resume', () => {
      if (!settingsRef.current?.paused) setPaused(false)
    })
    const offUnlock = window.api.on('power:unlock-screen', () => {
      if (!settingsRef.current?.paused) setPaused(false)
    })

    return () => {
      offSuspend()
      offLock()
      offResume()
      offUnlock()
    }
  }, [])

  // ── IPC: media playback status ────────────────────────────────────────────
  const lastPlayingTrackRef = useRef({ artist: '', title: '' })
  const nowPlayingTimerRef = useRef(null)

  useEffect(() => {
    const offMedia = window.api.on('media:status', (rawStatus) => {
      const status = rawStatus || { playing: false, artist: '', title: '' }
      setMediaStatus(status)

      if (!status.playing) {
        // Playback paused or stopped — hide the popup and cancel any active timer
        setNowPlayingVisible(false)
        if (nowPlayingTimerRef.current) {
          clearTimeout(nowPlayingTimerRef.current)
          nowPlayingTimerRef.current = null
        }
        return
      }

      // Only stable PLAYING events with usable metadata are considered for track changes
      const title = (status.title || '').trim()
      const artist = (status.artist || '').trim()
      const hasUsableTrack = Boolean(title || artist)

      if (!hasUsableTrack) {
        return // Ignore transient empty metadata
      }

      const last = lastPlayingTrackRef.current
      const isDifferentTrack = title !== last.title || artist !== last.artist

      if (isDifferentTrack) {
        // Track changed to a new track — update confirmed playing track
        lastPlayingTrackRef.current = { artist, title }

        // Show popup and restart the 4.5s auto-hide timer
        setNowPlayingVisible(true)
        if (nowPlayingTimerRef.current) {
          clearTimeout(nowPlayingTimerRef.current)
        }
        nowPlayingTimerRef.current = setTimeout(() => {
          setNowPlayingVisible(false)
          nowPlayingTimerRef.current = null
        }, 4500)
      }
    })

    return () => {
      offMedia()
      if (nowPlayingTimerRef.current) {
        clearTimeout(nowPlayingTimerRef.current)
        nowPlayingTimerRef.current = null
      }
    }
  }, [])

  // ── Settings save handler ─────────────────────────────────────────────────
  const handleSaveSettings = useCallback(async (updates) => {
    const newSettings = await window.api.setSettings(updates)
    setSettingsState(newSettings)
    setPaused(newSettings.paused)
    window.api.setPaused(newSettings.paused)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Mascot
        reminderState={reminderState}
        reminderType={reminderType}
        hungerState={hungerState}
        onFeed={handleFeed}
        pomodoroCelebrating={pomodoroCelebrating}
        timerMode={timerMode}
        timerSeconds={timerSeconds}
        timerRunning={timerRunning}
        timerFormatted={formatTime(timerSeconds)}
        onDismiss={dismissReminder}
        REMINDER_STATE={REMINDER_STATE}
        mediaPlaying={mediaStatus.playing}
        mediaArtist={mediaStatus.artist}
        mediaTitle={mediaStatus.title}
        nowPlayingVisible={nowPlayingVisible}
      />

      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {process.env.NODE_ENV === 'development' && settings && (
        <div className="debug-overlay">
          <span>State: {reminderState} ({reminderType})</span>
          <span>Next in: {countdown}s</span>
          <span>Hunger: {hungerState} ({hungerCountdown}s)</span>
          <span>{paused ? '⏸ PAUSED' : '▶ RUNNING'}</span>
          {timerMode !== 'none' && (
            <span>Timer: {timerMode} ({formatTime(timerSeconds)})</span>
          )}
          {mediaStatus.playing && (
            <span>🎵 {mediaStatus.artist} — {mediaStatus.title}</span>
          )}
        </div>
      )}
    </>
  )
}
