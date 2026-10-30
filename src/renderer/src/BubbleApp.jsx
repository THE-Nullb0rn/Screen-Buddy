import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Droplet, Eye, Footprints, Timer, Briefcase, Utensils, Music, AlertCircle, Bell, Clock, Sparkles } from 'lucide-react'
import NotificationBubble from './components/NotificationBubble'
import ChatMarkdown from './components/ChatMarkdown'
import './components/NotificationBubble.css'
import './components/BubbleCards.css'

const REMINDER_MESSAGES = {
  water: { title: 'Water Break', text: 'Time to hydrate!', icon: '💧' },
  eyeRest: { title: 'Eye Rest', text: 'Rest your eyes — look at something 20ft away', icon: '👀' },
  movementBreak: { title: 'Movement Break', text: 'Time to get up and move!!', icon: '🤸' },
  pomodoroWorkEnd: { title: 'Pomodoro Done!', text: 'Pomodoro complete — take a 5 min break!', icon: '🍅' },
  pomodoroBreakEnd: { title: "Break's Over", text: "Break's over — back to work!", icon: '💼' },
}

function getReminderIcon(typeOrIcon, fallback) {
  switch (typeOrIcon) {
    case 'Droplet':
    case 'water':
      return <Droplet size={18} />
    case 'Eye':
    case 'eyeRest':
      return <Eye size={18} />
    case 'Footprints':
    case 'movementBreak':
      return <Footprints size={18} />
    case 'Bell':
      return <Bell size={18} />
    case 'Clock':
      return <Clock size={18} />
    case 'Sparkles':
      return <Sparkles size={18} />
    case 'Timer':
    case 'pomodoroWorkEnd':
      return <Timer size={18} />
    case 'pomodoroBreakEnd':
      return <Briefcase size={18} />
    default:
      return fallback || <Bell size={18} />
  }
}

export default function BubbleApp() {
  const [activeNotification, setActiveNotification] = useState(null)
  const [cardState, setCardState] = useState(null)

  useEffect(() => {
    const offNotifShow = window.api.on('notification:show', (notif) => {
      lastReportedSize.current = { w: 0, h: 0 }
      setActiveNotification(notif)
    })
    const offNotifClose = window.api.on('notification:close', (id) => {
      setActiveNotification((prev) => (prev && prev.id === id ? null : prev))
    })
    const offCardState = window.api.on('bubble:card-state', (state) => {
      setCardState(state)
    })
    const offFocusInput = window.api.on('chat:focus-input', () => {
      const el = chatInputRef.current
      if (el) {
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    })
    return () => {
      offNotifShow()
      offNotifClose()
      offCardState()
      offFocusInput()
    }
  }, [])

  const handleNotificationDismiss = useCallback((id, reason) => {
    setActiveNotification(prev => {
      if (prev && prev.id === id) {
        window.api.notifications.dismiss(id, reason)
        return null
      }
      return prev
    })
  }, [])

  const handleNotificationAction = useCallback((id, actionKey) => {
    window.api.notifications.action(id, actionKey)
    handleNotificationDismiss(id, 2)
  }, [handleNotificationDismiss])

  const handleReminderDismiss = useCallback(() => {
    window.api.bubble.action('reminder:dismiss')
  }, [])

  const handleReminderSnooze = useCallback(() => {
    window.api.bubble.action('reminder:snooze')
  }, [])

  
  const [inputText, setInputText] = useState('')
  const [copyStatus, setCopyStatus] = useState(null)
  const copyStatusTimerRef = useRef(null)
  const chatInputRef = useRef(null)
  const lastActivityReportRef = useRef(0)

  const adjustTextareaHeight = useCallback(() => {
    const el = chatInputRef.current
    if (!el) return
    el.style.height = 'auto'
    const borderOffset = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + borderOffset}px`
  }, [])

  useEffect(() => {
    if (cardState?.chatState === 'input') {
      if (chatInputRef.current) {
        chatInputRef.current.focus()
        adjustTextareaHeight()
        window.api.bubble.action('chat:ready')
      }
    } else {
      setInputText('')
    }
  }, [cardState?.chatState, adjustTextareaHeight])

  useEffect(() => {
    if (cardState?.chatState === 'input') {
      adjustTextareaHeight()
    }
  }, [inputText, cardState?.chatState, adjustTextareaHeight])

  const handleChatSend = useCallback((text) => {
    window.api.bubble.action('chat:send', text)
  }, [])

  const handleChatDismiss = useCallback(() => {
    window.api.bubble.action('chat:dismiss')
  }, [])

  const handleChatActivity = useCallback((hasText, force = false) => {
    const now = Date.now()
    if (force || now - lastActivityReportRef.current > 300) {
      lastActivityReportRef.current = now
      window.api.bubble.action('chat:activity', { hasText: Boolean(hasText) })
    }
  }, [])

  const handleRetry = useCallback(() => {
    window.api.bubble.action('chat:retry')
  }, [])

  const handleReplyMouseEnter = useCallback(() => {
    window.api.bubble.action('chat:reply-pause')
  }, [])

  const handleReplyMouseLeave = useCallback(() => {
    window.api.bubble.action('chat:reply-resume')
  }, [])

  const handleCopy = useCallback(async (text) => {
    let success = false
    try {
      if (window.api && typeof window.api.copyText === 'function') {
        const res = await window.api.copyText(text)
        success = Boolean(res && res.ok)
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        success = true
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        success = document.execCommand('copy')
        document.body.removeChild(textarea)
      }
    } catch (_err) {
      success = false
    }

    if (copyStatusTimerRef.current) clearTimeout(copyStatusTimerRef.current)
    if (success) {
      setCopyStatus('copied')
      copyStatusTimerRef.current = setTimeout(() => setCopyStatus(null), 1200)
    } else {
      setCopyStatus('failed')
      copyStatusTimerRef.current = setTimeout(() => setCopyStatus(null), 1500)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current) clearTimeout(copyStatusTimerRef.current)
    }
  }, [])


  const handleFeed = useCallback(() => {
    window.api.bubble.action('hunger:feed')
  }, [])

  const handleHungerLater = useCallback(() => {
    window.api.bubble.action('hunger:later')
  }, [])

  // ── Dynamic resize: observe the root content div and report dimensions ──
  const contentRef = useRef(null)
  const lastReportedSize = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const el = contentRef.current
    if (!el) {
      console.log('[bubble-resize] contentRef is null, skipping ResizeObserver setup')
      return
    }
    console.log('[bubble-resize] ResizeObserver attached to content element')

    let rafId = null
    const MIN_W = 160
    const MIN_H = 40

    const report = () => {
      const rect = el.getBoundingClientRect()
      const w = Math.max(MIN_W, Math.ceil(rect.width))
      const h = Math.max(MIN_H, Math.ceil(rect.height))
      console.log(`[bubble-resize] Measured content: ${rect.width}x${rect.height} (sending ${w}x${h})`)
      if (w !== lastReportedSize.current.w || h !== lastReportedSize.current.h) {
        lastReportedSize.current = { w, h }
        window.api.bubble.reportSize(w, h)
      } else {
        console.log('[bubble-resize] Dimensions unchanged, skipping IPC send')
      }
    }

    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(report)
    })
    ro.observe(el)

    // Report initial size after first paint
    rafId = requestAnimationFrame(report)

    return () => {
      ro.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [activeNotification, cardState?.hasContent])


  if (!activeNotification && (!cardState || !cardState.hasContent)) {
    return <div style={{ width: '100%', height: '100%' }} />
  }

  const { isReminderActive, reminderState, reminderType, showReminderCard, reminderData, showHunger, showTimer, timerMode, timerFormatted, showNowPlaying, mediaTitle, mediaArtist, chatState, chatReply } = cardState || {}
  const isBigTreatment = isReminderActive && reminderType === 'movementBreak'
  const reminderInfo = reminderData || REMINDER_MESSAGES[reminderType] || REMINDER_MESSAGES.water

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
      <div
        ref={contentRef}
        className="sb-bubble-content-wrapper"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px 8px 8px',
          width: 'max-content',
          height: 'max-content',
        }}
      >

      {/* Desktop Notification */}
      {activeNotification && (
        <NotificationBubble
          notification={activeNotification}
          onDismiss={handleNotificationDismiss}
          onAction={handleNotificationAction}
        />
      )}

      {/* Timer badge */}
      {showTimer && (
        <div className="mascot-timer-badge">
          <span className="mascot-timer-badge__icon">
            {timerMode && timerMode.startsWith('pomodoro') ? '🍅' : '⏱️'}
          </span>
          <span className="mascot-timer-badge__time">{timerFormatted}</span>
        </div>
      )}

      {/* Now Playing card */}
      {showNowPlaying && (mediaTitle || mediaArtist) && (
        <div className="mascot-now-playing">
          <span className="mascot-now-playing__icon">
            <Music size={18} />
          </span>
          <div className="mascot-now-playing__text">
            {mediaTitle && <div className="mascot-now-playing__title">{mediaTitle}</div>}
            {mediaArtist && <div className="mascot-now-playing__artist">{mediaArtist}</div>}
          </div>
          <div className="mascot-now-playing__bars" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        </div>
      )}

      {/* Hunger card */}
      {showHunger && (
        <div className="mascot-reminder-card mascot-hunger-card">
          <div className="mascot-reminder-card__content">
            <span className="mascot-reminder-card__icon">
              <Utensils size={18} />
            </span>
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__title">Hungry!</div>
              <div className="mascot-reminder-card__message">Time to eat.</div>
              <button
                className="mascot-hunger-feed-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  handleFeed()
                }}
              >
                Feed
              </button>
            </div>
          </div>
          <button
            className="mascot-dismiss"
            onClick={(e) => {
              e.stopPropagation()
              handleHungerLater()
            }}
            aria-label="Remind me later"
            title="Later"
          >
            ✕
          </button>
        </div>
      )}

      {/* Reminder card */}
      {isReminderActive && reminderState === 'ACTIVE' && showReminderCard !== false && (
        <div
          className={`mascot-reminder-card ${isBigTreatment ? 'is-big' : 'is-small'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mascot-reminder-card__content">
            <span className="mascot-reminder-card__icon">
              {getReminderIcon(reminderInfo.icon || reminderType, reminderInfo.icon)}
            </span>
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__title">{reminderInfo.title}</div>
              <div className="mascot-reminder-card__message">{reminderInfo.text || reminderInfo.message}</div>
            </div>
          </div>
          <div className="mascot-reminder-card__actions">
            <button
              className="mascot-snooze-btn"
              onClick={handleReminderSnooze}
              aria-label="Snooze reminder"
              title="Snooze"
            >
              Snooze
            </button>
            <button
              className="mascot-dismiss"
              onClick={handleReminderDismiss}
              aria-label="Dismiss reminder"
            >
              ✕
            </button>
          </div>
        </div>
      )}


      {/* Chat Input */}
      {chatState === 'input' && (
        <div
          className="mascot-chat-input-wrap"
          onClick={(e) => {
            e.stopPropagation()
            handleChatActivity(Boolean(inputText.trim()), true)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseMove={() => handleChatActivity(Boolean(inputText.trim()), false)}
        >
          <textarea
            ref={chatInputRef}
            className="mascot-chat-input"
            rows={1}
            placeholder="Talk to me..."
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value)
              handleChatActivity(Boolean(e.target.value.trim()), true)
            }}
            onKeyDown={(e) => {
              handleChatActivity(Boolean(inputText.trim()), true)
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const trimmed = inputText.trim()
                if (trimmed) {
                  handleChatSend(trimmed)
                  setInputText('')
                }
              } else if (e.key === 'Escape') {
                e.preventDefault()
                handleChatDismiss()
              }
            }}
            onFocus={() => handleChatActivity(Boolean(inputText.trim()), true)}
          />
        </div>
      )}

      {/* Chat Waiting Bubble */}
      {chatState === 'waiting' && (
        <div className="mascot-chat-bubble mascot-chat-bubble--waiting">
          <div className="mascot-chat-bubble__dots" aria-label="Thinking...">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {/* Chat Reply Bubble */}
      {chatState === 'reply' && (() => {
        const isError = Boolean(chatReply && (!chatReply.ok || chatReply.error))
        const replyText = typeof chatReply === 'string' ? chatReply : (chatReply?.text || '')
        const errorMessage = chatReply?.error || (typeof chatReply === 'string' && !chatReply.ok ? chatReply : 'Something went wrong.')

        return (
          <div
            className={`mascot-reminder-card mascot-chat-bubble--reply ${isError ? 'mascot-chat-bubble--error' : ''}`}
            onMouseEnter={handleReplyMouseEnter}
            onMouseLeave={handleReplyMouseLeave}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mascot-chat-bubble__actions">
              {!isError && (
                <button
                  className="mascot-chat-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopy(replyText)
                  }}
                  title="Copy text"
                  aria-label="Copy text"
                >
                  {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy'}
                </button>
              )}
              <button
                className="mascot-dismiss"
                onClick={(e) => {
                  e.stopPropagation()
                  handleChatDismiss()
                }}
                aria-label="Dismiss chat"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
            <div className="mascot-chat-bubble__body">
              <div className="mascot-chat-bubble__scroll-area">
                <div
                  className={`mascot-chat-bubble__top-spacer ${isError ? 'is-error' : ''}`}
                  aria-hidden="true"
                />
                {isError ? (
                  <div className="mascot-chat-error-text">
                    <AlertCircle size={15} className="mascot-chat-error-icon" aria-hidden="true" />
                    <span>{errorMessage}</span>
                  </div>
                ) : (
                  <ChatMarkdown text={replyText} />
                )}
              </div>
              {isError && (
                <button
                  className="mascot-chat-retry-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRetry()
                  }}
                >
                  ↻ Retry
                </button>
              )}
            </div>
          </div>
        )
      })()}

      </div>
    </div>
  )
}
