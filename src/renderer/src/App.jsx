/**
 * screen-buddy — root App component
 *
 * Owns:
 *  - The top-level reminder state machine (IDLE_COUNTING → ENTRANCE → ACTIVE → EXIT)
 *  - Interval timer that drives the state machine
 *  - IPC subscriptions for tray events and power monitor events
 *  - Settings state (fetched from main process, shared down via props)
 *  - Settings modal open/close state
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Mascot from './components/Mascot'
import SettingsModal from './components/SettingsModal'

// ─── State machine constants ─────────────────────────────────────────────────
/**
 * REMINDER_STATE describes the lifecycle of a single reminder pop-up.
 *
 *   IDLE_COUNTING  — timer is ticking down; mascot roams / idles / sleeps
 *   ENTRANCE       — reminder starts; mascot switches to the alert pose
 *   ACTIVE         — reminder is visible; user can dismiss
 *   EXIT           — reminder is animating out (short, ~0.8 s)
 *
 * After EXIT completes, state resets to IDLE_COUNTING.
 */
const REMINDER_STATE = {
  IDLE_COUNTING: 'IDLE_COUNTING',
  ENTRANCE: 'ENTRANCE',
  ACTIVE: 'ACTIVE',
  EXIT: 'EXIT',
}

// How long each transient state lasts (ms)
const ENTRANCE_DURATION_MS = 1000
const EXIT_DURATION_MS = 800

// ─── Component ───────────────────────────────────────────────────────────────
export default function App() {
  // ── Settings ───────────────────────────────────────────────────────────────
  const [settings, setSettingsState] = useState(null) // null until loaded
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ── Reminder state machine ─────────────────────────────────────────────────
  const [reminderState, setReminderState] = useState(REMINDER_STATE.IDLE_COUNTING)

  // Whether reminders are paused (from tray or settings)
  const [paused, setPaused] = useState(false)

  // Countdown displayed in development / debug overlay (seconds remaining)
  const [countdown, setCountdown] = useState(0)

  // Refs so interval callbacks always see the latest values without re-creating
  const pausedRef = useRef(paused)
  const settingsRef = useRef(settings)
  const reminderStateRef = useRef(reminderState)

  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { reminderStateRef.current = reminderState }, [reminderState])

  // ── Load settings from main process on mount ──────────────────────────────
  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettingsState(s)
      setPaused(s.paused)
    })
  }, [])

  // ── State machine transitions ─────────────────────────────────────────────

  /** Begin a reminder cycle: IDLE_COUNTING → ENTRANCE → ACTIVE */
  const triggerReminder = useCallback(() => {
    setReminderState(REMINDER_STATE.ENTRANCE)

    // After entrance animation completes, move to ACTIVE
    setTimeout(() => {
      setReminderState(REMINDER_STATE.ACTIVE)
    }, ENTRANCE_DURATION_MS)
  }, [])

  /** Dismiss the active reminder: ACTIVE → EXIT → IDLE_COUNTING */
  const dismissReminder = useCallback(() => {
    setReminderState(REMINDER_STATE.EXIT)

    // After exit animation completes, go back to idle
    setTimeout(() => {
      setReminderState(REMINDER_STATE.IDLE_COUNTING)
    }, EXIT_DURATION_MS)
  }, [])

  // ── Timer: drives IDLE_COUNTING countdown ─────────────────────────────────
  useEffect(() => {
    if (!settings) return // wait until settings are loaded

    const intervalSec = (settings.intervalMinutes || 20) * 60
    let remaining = intervalSec
    setCountdown(remaining)

    const tick = setInterval(() => {
      // Don't progress if paused or if we're already mid-reminder
      if (
        pausedRef.current ||
        reminderStateRef.current !== REMINDER_STATE.IDLE_COUNTING
      ) {
        return
      }

      remaining -= 1
      setCountdown(remaining)

      if (remaining <= 0) {
        // Timer expired — trigger the reminder
        remaining = intervalSec
        setCountdown(remaining)
        triggerReminder()
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [settings, triggerReminder]) // re-create timer when settings or triggerReminder changes

  // ── IPC: tray push events ─────────────────────────────────────────────────
  useEffect(() => {
    // "Test Reminder" tray menu item — immediately fire a reminder
    const offTest = window.api.on('tray:test-reminder', () => {
      if (reminderStateRef.current === REMINDER_STATE.IDLE_COUNTING) {
        triggerReminder()
      }
    })

    // "Settings" tray menu item — open settings modal
    const offSettings = window.api.on('tray:open-settings', () => {
      setSettingsOpen(true)
    })

    // "Pause/Resume" tray menu item — sync pause state
    const offPause = window.api.on('tray:pause-state', (isPaused) => {
      setPaused(isPaused)
    })

    return () => {
      offTest()
      offSettings()
      offPause()
    }
  // triggerReminder is stable (wrapped in useCallback with no deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerReminder])

  // ── IPC: power monitor events ─────────────────────────────────────────────
  useEffect(() => {
    // Suspend / lock-screen → pause (don't show reminders while away)
    const offSuspend = window.api.on('power:suspend', () => setPaused(true))
    const offLock = window.api.on('power:lock-screen', () => setPaused(true))

    // Resume / unlock → un-pause (unless user manually paused)
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

  // ── Settings save handler (passed into SettingsModal) ─────────────────────
  const handleSaveSettings = useCallback(async (updates) => {
    const newSettings = await window.api.setSettings(updates)
    setSettingsState(newSettings)
    setPaused(newSettings.paused)
    // Notify main process of pause state so tray label stays in sync
    window.api.setPaused(newSettings.paused)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Mascot overlay ─────────────────────────────────────────────── */}
      <Mascot
        reminderState={reminderState}
        onDismiss={dismissReminder}
        REMINDER_STATE={REMINDER_STATE}
      />

      {/* ── Settings modal ─────────────────────────────────────────────── */}
      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* ── Dev debug overlay (only in development) ────────────────────── */}
      {process.env.NODE_ENV === 'development' && settings && (
        <div className="debug-overlay">
          <span>State: {reminderState}</span>
          <span>Next in: {countdown}s</span>
          <span>{paused ? '⏸ PAUSED' : '▶ RUNNING'}</span>
        </div>
      )}
    </>
  )
}
