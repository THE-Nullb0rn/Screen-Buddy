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
import Mascot, { NORMAL_CAT_CX, NORMAL_CAT_CY } from './components/Mascot'
import { useHunger } from './hooks/useHunger'
import { useReminders, REMINDER_STATE } from './hooks/useReminders'

const POMODORO_WORK_SEC = 25 * 60
const POMODORO_BREAK_SEC = 5 * 60
const POMODORO_CELEBRATION_MS = 1200

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

  // Whether reminders/timers are paused
  const [paused, setPaused] = useState(false)

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [chatState, setChatState] = useState('idle') // 'idle' | 'input' | 'waiting' | 'reply'
  const [chatReply, setChatReply] = useState('')
  const [notificationVisible, setNotificationVisible] = useState(false)

  // Cat sleep state
  const [isAsleep, setIsAsleep] = useState(false)

  // ── Reminders hook ─────────────────────────────────────────────────────────
  const {
    reminderState,
    reminderType,
    reminderData,
    isReminderActive,
    triggerReminder,
    dismissReminder,
    snoozeReminder,
    countdown,
  } = useReminders({
    settings,
    paused,
    chatState,
    notificationVisible,
    isAsleep,
  })

  // ── Pomodoro & Stopwatch state ─────────────────────────────────────────────
  const [timerMode, setTimerMode] = useState('none') // 'none' | 'pomodoro-work' | 'pomodoro-break' | 'stopwatch'
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [pomodoroCelebrating, setPomodoroCelebrating] = useState(false)

  // ── Media playback state ───────────────────────────────────────────────────
  const [mediaStatus, setMediaStatus] = useState({ playing: false, artist: '', title: '' })
  const [nowPlayingVisible, setNowPlayingVisible] = useState(false)

  // ── Hunger state ───────────────────────────────────────────────────────────
  const {
    hungerState,
    hungerLevel,
    showHunger,
    feedSignal,
    handleFeed,
    handleSnooze,
    handleSleepChange,
  } = useHunger({
    settings,
    paused,
    isReminderActive,
  })

  const handleSleepChangeCombined = useCallback((sleeping) => {
    setIsAsleep(sleeping)
    handleSleepChange(sleeping)
  }, [handleSleepChange])

  const settingsRef = useRef(settings)
  const pausedRef = useRef(paused)

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { window.api.sendReminderState?.(reminderState) }, [reminderState])

  const [hungerExiting, setHungerExiting] = useState(false)
  const hungerExitTimerRef = useRef(null)

  const triggerHungerExit = useCallback(() => {
    if (settingsRef.current?.notificationAnimations === false) {
      setHungerExiting(false)
      return
    }
    setHungerExiting(true)
    if (hungerExitTimerRef.current) clearTimeout(hungerExitTimerRef.current)
    hungerExitTimerRef.current = setTimeout(() => {
      setHungerExiting(false)
      hungerExitTimerRef.current = null
    }, 240)
  }, [])

  const handleFeedWithAnimation = useCallback(() => {
    triggerHungerExit()
    handleFeed()
  }, [triggerHungerExit, handleFeed])

  const handleSnoozeWithAnimation = useCallback(() => {
    triggerHungerExit()
    handleSnooze()
  }, [triggerHungerExit, handleSnooze])

  const [nowPlayingExiting, setNowPlayingExiting] = useState(false)
  const nowPlayingExitTimerRef = useRef(null)

  const dismissNowPlaying = useCallback(() => {
    if (nowPlayingTimerRef.current) {
      clearTimeout(nowPlayingTimerRef.current)
      nowPlayingTimerRef.current = null
    }
    if (settingsRef.current?.notificationAnimations === false) {
      setNowPlayingVisible(false)
      setNowPlayingExiting(false)
      return
    }
    setNowPlayingVisible((prev) => {
      if (prev) {
        setNowPlayingExiting(true)
        if (nowPlayingExitTimerRef.current) clearTimeout(nowPlayingExitTimerRef.current)
        nowPlayingExitTimerRef.current = setTimeout(() => {
          setNowPlayingExiting(false)
          nowPlayingExitTimerRef.current = null
        }, 240)
      }
      return false
    })
  }, [])

  const [chatExiting, setChatExiting] = useState(false)
  const chatExitTimerRef = useRef(null)

  const dismissChatReply = useCallback(() => {
    if (replyDismissTimerRef.current) {
      clearTimeout(replyDismissTimerRef.current)
      replyDismissTimerRef.current = null
    }
    if (settingsRef.current?.notificationAnimations === false) {
      setChatState('idle')
      setChatExiting(false)
      return
    }
    setChatExiting(true)
    if (chatExitTimerRef.current) clearTimeout(chatExitTimerRef.current)
    chatExitTimerRef.current = setTimeout(() => {
      setChatState('idle')
      setChatExiting(false)
      chatExitTimerRef.current = null
    }, 240)
  }, [])

  const handleChatDismiss = useCallback(() => {
    setChatState((prev) => {
      if (prev === 'reply') {
        dismissChatReply()
        return prev
      }
      setChatExiting(false)
      return 'idle'
    })
  }, [dismissChatReply])

  useEffect(() => {
    return () => {
      if (hungerExitTimerRef.current) clearTimeout(hungerExitTimerRef.current)
      if (nowPlayingExitTimerRef.current) clearTimeout(nowPlayingExitTimerRef.current)
      if (chatExitTimerRef.current) clearTimeout(chatExitTimerRef.current)
    }
  }, [])

  // ── Load settings from main process on mount ──────────────────────────────
  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettingsState(s)
      setPaused(s.paused)
    })
    const off = window.api.on('settings:updated', (s) => {
      setSettingsState(s)
      setPaused(s.paused)
    })
    return off
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
      triggerReminder(data?.type)
    })

    const offTrigger = window.api.on('reminder:trigger', (data) => {
      triggerReminder(data?.type)
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

    const offPause = window.api.on('tray:pause-state', (isPaused) => {
      setPaused(isPaused)
    })

    return () => {
      offTest()
      offTrigger()
      offStartPomodoro()
      offStartStopwatch()
      offStopTimer()
      offTestPomodoro()
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

  // ── IPC: desktop notifications ────────────────────────────────────────────
  useEffect(() => {
    const offNotifVisible = window.api.on('notification:visible', (visible) => {
      setNotificationVisible(visible)
    })
    return () => {
      offNotifVisible()
    }
  }, [])

  // ── Push card-state snapshot to bubble window ─────────────────────────────
  // Computed once and sent whenever any relevant state changes.
  // hasContent drives the bubble window visibility decision in main.js.
  useEffect(() => {
    const masterCardsEnabled = settings?.notificationsEnabled !== false

    const showReminderCard = Boolean(
      masterCardsEnabled &&
      isReminderActive &&
      (reminderState === REMINDER_STATE.ACTIVE || reminderState === REMINDER_STATE.EXIT) &&
      settings?.reminderNotifications !== false
    )

    const showTimer = timerMode !== 'none' && reminderState !== REMINDER_STATE.ACTIVE
    const effectiveShowNowPlaying = Boolean(
      masterCardsEnabled &&
      settings?.notificationCardMusic !== false &&
      (nowPlayingVisible || nowPlayingExiting) &&
      Boolean(mediaStatus.title || mediaStatus.artist) &&
      !isReminderActive
    )
    const effectiveShowHunger = Boolean(
      masterCardsEnabled &&
      (showHunger || hungerExiting)
    )

    const hasContent =
      (masterCardsEnabled && settings?.reminderNotifications !== false && isReminderActive) ||
      showTimer ||
      effectiveShowHunger ||
      effectiveShowNowPlaying ||
      chatState !== 'idle' ||
      chatExiting

    window.api.bubble?.sendCardState({
      hasContent,
      notificationAnimations: settings?.notificationAnimations !== false,
      chatState,
      chatExiting,
      chatThinkingIndicator: settings?.chatThinkingIndicator !== false,
      chatReply,
      // Reminder
      reminderState,
      reminderType,
      isReminderActive,
      showReminderCard,
      reminderData,
      // Hunger
      showHunger: effectiveShowHunger,
      hungerExiting,
      // Timer
      showTimer,
      timerMode,
      timerFormatted: formatTime(timerSeconds),
      // Now Playing
      showNowPlaying: effectiveShowNowPlaying,
      nowPlayingExiting,
      mediaTitle: mediaStatus.title,
      mediaArtist: mediaStatus.artist,
    })
  }, [
    isReminderActive,
    reminderState,
    reminderType,
    reminderData,
    settings?.notificationsEnabled,
    settings?.reminderNotifications,
    settings?.notificationCardMusic,
    settings?.notificationAnimations,
    settings?.chatThinkingIndicator,
    showHunger,
    hungerExiting,
    timerMode,
    timerSeconds,
    nowPlayingVisible,
    nowPlayingExiting,
    mediaStatus,
    chatState,
    chatExiting,
    chatReply,
  ])

  // ── Handle actions forwarded from the bubble renderer (BubbleApp.jsx) ─────
  useEffect(() => {
    const offAction = window.api.on('bubble:action', (type, payload) => {
      if (type === 'reminder:dismiss') {
        dismissReminder()
      } else if (type === 'reminder:snooze') {
        snoozeReminder()
      } else if (type === 'now-playing:dismiss') {
        dismissNowPlaying()
      } else if (type === 'hunger:feed') {
        handleFeedWithAnimation()
      } else if (type === 'hunger:later') {
        handleSnoozeWithAnimation()
      } else if (type === 'chat:send') {
        handleChatSend(payload)
      } else if (type === 'chat:retry') {
        const msg = (typeof payload === 'string' && payload.trim()) ? payload.trim() : lastUserMessageRef.current
        if (msg) handleChatSend(msg)
      } else if (type === 'chat:dismiss') {
        handleChatDismiss()
      } else if (type === 'chat:activity') {
        const hasText = typeof payload === 'boolean'
          ? payload
          : (payload && typeof payload.hasText === 'boolean' ? payload.hasText : undefined)
        resetChatInputTimer(hasText)
      } else if (type === 'chat:reply-pause') {
        if (replyDismissTimerRef.current) {
          clearTimeout(replyDismissTimerRef.current)
          replyDismissTimerRef.current = null
        }
      } else if (type === 'chat:reply-resume') {
        startReplyDismissTimer(replyDismissDurationRef.current)
      }
    })
    return () => offAction()
  }, [dismissReminder, snoozeReminder, dismissNowPlaying, handleFeedWithAnimation, handleSnoozeWithAnimation, handleChatDismiss])


  // ── IPC: media playback status ────────────────────────────────────────────
  const lastPlayingTrackRef = useRef({ artist: '', title: '' })
  const nowPlayingTimerRef = useRef(null)

  useEffect(() => {
    const offMedia = window.api.on('media:status', (rawStatus) => {
      const status = rawStatus || { playing: false, artist: '', title: '' }
      setMediaStatus(status)

      if (!status.playing) {
        // Playback paused or stopped — hide the popup and cancel any active timer
        dismissNowPlaying()
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

        // Show popup and set auto-hide timer if enabled
        setNowPlayingVisible(true)
        setNowPlayingExiting(false)
        if (nowPlayingTimerRef.current) {
          clearTimeout(nowPlayingTimerRef.current)
          nowPlayingTimerRef.current = null
        }
        if (settingsRef.current?.notificationAutoHide !== false) {
          const dur = (settingsRef.current?.notificationDuration ?? 5) * 1000
          nowPlayingTimerRef.current = setTimeout(() => {
            dismissNowPlaying()
          }, dur)
        }
      }
    })

    return () => {
      offMedia()
      if (nowPlayingTimerRef.current) {
        clearTimeout(nowPlayingTimerRef.current)
        nowPlayingTimerRef.current = null
      }
    }
  }, [dismissNowPlaying])

  // Re-sync now-playing auto-dismiss timer on duration or autoHide change
  useEffect(() => {
    if (nowPlayingVisible) {
      if (nowPlayingTimerRef.current) {
        clearTimeout(nowPlayingTimerRef.current)
        nowPlayingTimerRef.current = null
      }
      if (settings?.notificationAutoHide !== false) {
        const dur = (settings?.notificationDuration ?? 5) * 1000
        nowPlayingTimerRef.current = setTimeout(() => {
          dismissNowPlaying()
        }, dur)
      }
    }
  }, [settings?.notificationAutoHide, settings?.notificationDuration, nowPlayingVisible, dismissNowPlaying])

  // ── Chat handlers and effects ─────────────────────────────────────────────
  
  // Sync state to main process for click-through and hotkey guarding
  useEffect(() => {
    window.api.chat.setState(chatState)
  }, [chatState])

  useEffect(() => {
    const offOpen = window.api.on('chat:open', () => {
      if (settingsRef.current?.chatEnabled === false) return
      setChatState(prev => {
        // If it's already showing the reply bubble, hotkey dismisses it.
        if (prev === 'reply') {
          return 'input'
        }
        // If it's closed, open it.
        if (prev === 'idle') {
          return 'input'
        }
        return prev
      })
    })

    const offDismiss = window.api.on('chat:dismiss', () => {
      handleChatDismiss()
    })

    return () => {
      offOpen()
      offDismiss()
    }
  }, [handleChatDismiss])

  const lastUserMessageRef = useRef('')
  const chatSendRequestIdRef = useRef(0)
  const chatWaitingTimerRef = useRef(null)

  const chatInputTimerRef = useRef(null)
  const hasUnsentTextRef = useRef(false)

  const resetChatInputTimer = useCallback((hasText) => {
    if (typeof hasText === 'boolean') {
      hasUnsentTextRef.current = hasText
    }
    if (chatInputTimerRef.current) clearTimeout(chatInputTimerRef.current)
    if (settingsRef.current?.chatAutoHide === false) return
    const timeoutMs = hasUnsentTextRef.current ? 45000 : 15000
    chatInputTimerRef.current = setTimeout(() => {
      setChatState('idle')
    }, timeoutMs)
  }, [])

  const replyDismissTimerRef = useRef(null)
  const replyDismissDurationRef = useRef(12000)

  const startReplyDismissTimer = useCallback((duration) => {
    if (replyDismissTimerRef.current) clearTimeout(replyDismissTimerRef.current)
    replyDismissTimerRef.current = setTimeout(() => {
      dismissChatReply()
    }, duration)
  }, [dismissChatReply])

  useEffect(() => {
    if (chatState === 'input') {
      hasUnsentTextRef.current = false
      resetChatInputTimer(false)
      return () => {
        if (chatInputTimerRef.current) clearTimeout(chatInputTimerRef.current)
      }
    } else if (chatState === 'reply') {
      const text = typeof chatReply === 'string'
        ? chatReply
        : (chatReply?.text || chatReply?.error || '')
      const duration = Math.min(60000, Math.max(12000, 40 * text.length))
      replyDismissDurationRef.current = duration
      startReplyDismissTimer(duration)
      return () => {
        if (replyDismissTimerRef.current) clearTimeout(replyDismissTimerRef.current)
      }
    } else if (chatState !== 'waiting') {
      if (chatWaitingTimerRef.current) {
        clearTimeout(chatWaitingTimerRef.current)
        chatWaitingTimerRef.current = null
      }
    }
  }, [chatState, chatReply, resetChatInputTimer, startReplyDismissTimer])

  const handleChatSend = useCallback((message) => {
    if (!message || typeof message !== 'string') return
    const trimmed = message.trim()
    if (!trimmed) return

    lastUserMessageRef.current = trimmed
    chatSendRequestIdRef.current += 1
    const currentRequestId = chatSendRequestIdRef.current

    setChatState('waiting')

    if (chatWaitingTimerRef.current) {
      clearTimeout(chatWaitingTimerRef.current)
    }

    let timedOut = false
    chatWaitingTimerRef.current = setTimeout(() => {
      if (chatSendRequestIdRef.current === currentRequestId) {
        timedOut = true
        setChatReply({ ok: false, error: 'The AI did not answer in time' })
        setChatState('reply')
      }
    }, 30000)

    window.api.chat.send(trimmed).then((result) => {
      if (timedOut || chatSendRequestIdRef.current !== currentRequestId) {
        return
      }
      if (chatWaitingTimerRef.current) {
        clearTimeout(chatWaitingTimerRef.current)
        chatWaitingTimerRef.current = null
      }
      setChatReply(result && typeof result === 'object' ? result : { ok: true, text: String(result) })
      setChatState('reply')
    }).catch((err) => {
      if (timedOut || chatSendRequestIdRef.current !== currentRequestId) {
        return
      }
      if (chatWaitingTimerRef.current) {
        clearTimeout(chatWaitingTimerRef.current)
        chatWaitingTimerRef.current = null
      }
      setChatReply({ ok: false, error: 'The AI did not answer in time' })
      setChatState('reply')
      console.error(err)
    })
  }, [])

  const handleChatOpen = useCallback(() => {
    if (settingsRef.current?.chatEnabled === false) return
    setChatState((prev) => {
      if (prev === 'reply' || prev === 'idle') {
        return 'input'
      }
      return prev
    })
  }, [])

  const handleTogglePause = useCallback(() => {
    if (window.api?.setPaused) {
      window.api.setPaused(!pausedRef.current)
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {settings && <Mascot
        reminderState={reminderState}
        reminderType={reminderType}
        reminderCatAnimation={settings.reminderCatAnimation !== false}
        hungerState={hungerState}
        onFeed={handleFeedWithAnimation}
        feedSignal={feedSignal}
        hungerBehavior={settings.hungerBehavior || 'search-food'}
        onSleepChange={handleSleepChangeCombined}
        pomodoroCelebrating={pomodoroCelebrating}
        timerMode={timerMode}
        REMINDER_STATE={REMINDER_STATE}
        mediaPlaying={mediaStatus.playing}
        chatState={chatState}
        chatReply={chatReply}
        onChatSend={handleChatSend}
        onChatDismiss={handleChatDismiss}
        onChatActivity={resetChatInputTimer}
        onChatOpen={handleChatOpen}
        clickToInteract={settings.clickToInteract !== false}
        dragBehavior={settings.dragBehavior !== false}
        dragButton={settings.dragButton || 'right'}
        leftClickAction={settings.leftClickAction || 'react'}
        rightClickAction={settings.rightClickAction || 'none'}
        doubleClickAction={settings.doubleClickAction || 'chat'}
        rightDoubleClickAction={settings.rightDoubleClickAction || 'settings'}
        onTogglePause={handleTogglePause}
        notificationVisible={notificationVisible}
        initialPosition={{
          x: (settings.mascotPosition?.x ?? 0) + NORMAL_CAT_CX,
          y: (settings.mascotPosition?.y ?? 0) + NORMAL_CAT_CY,
        }}
        catOpacity={settings.catOpacity}
        catAnimationSpeed={settings.catAnimationSpeed}
        mouseReaction={settings.mouseReaction}
        paused={paused}
        animationFps={settings.animationFps}
        reduceResourceUsage={settings.reduceResourceUsage}
      />}

    </>
  )
}
