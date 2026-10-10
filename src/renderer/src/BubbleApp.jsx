import React, { useState, useEffect, useCallback, useRef } from 'react'
import NotificationBubble from './components/NotificationBubble'
import './components/NotificationBubble.css'
import './components/BubbleCards.css'

const REMINDER_MESSAGES = {
  water: { title: 'Water Break', text: 'Time to hydrate!', icon: '💧' },
  eyeRest: { title: 'Eye Rest', text: 'Rest your eyes — look at something 20ft away', icon: '👀' },
  movementBreak: { title: 'Movement Break', text: 'Time to get up and move!!', icon: '🤸' },
  pomodoroWorkEnd: { title: 'Pomodoro Done!', text: 'Pomodoro complete — take a 5 min break!', icon: '🍅' },
  pomodoroBreakEnd: { title: "Break's Over", text: "Break's over — back to work!", icon: '💼' },
}

export default function BubbleApp() {
  const [activeNotification, setActiveNotification] = useState(null)
  const [cardState, setCardState] = useState(null)

  useEffect(() => {
    const offNotifShow = window.api.on('notification:show', (notif) => {
      setActiveNotification(notif)
    })
    const offNotifClose = window.api.on('notification:close', (id) => {
      setActiveNotification((prev) => (prev && prev.id === id ? null : prev))
    })
    const offCardState = window.api.on('bubble:card-state', (state) => {
      setCardState(state)
    })
    return () => {
      offNotifShow()
      offNotifClose()
      offCardState()
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

  
  const chatInputRef = useRef(null)

  useEffect(() => {
    if (cardState?.chatState === 'input' && chatInputRef.current) {
      chatInputRef.current.focus()
      // Notify main that the input is mounted and DOM-focused.
      // Main will respond with OS-level window focus (focusChatWindow) now
      // that it knows the element is ready to receive keystrokes.
      window.api.bubble.action('chat:ready')
    }
  }, [cardState?.chatState])

  const handleChatSend = useCallback((text) => {
    window.api.bubble.action('chat:send', text)
  }, [])

  const handleChatDismiss = useCallback(() => {
    window.api.bubble.action('chat:dismiss')
  }, [])

  const handleChatActivity = useCallback(() => {
    window.api.bubble.action('chat:activity')
  }, [])


  const handleFeed = useCallback(() => {
    window.api.bubble.action('hunger:feed')
  }, [])


  if (!activeNotification && (!cardState || !cardState.hasContent)) {
    return <div style={{ width: '100%', height: '100%' }} />
  }

  const { isReminderActive, reminderState, reminderType, showHunger, showTimer, timerMode, timerFormatted, showNowPlaying, mediaTitle, mediaArtist, chatState, chatReply } = cardState || {}
  const isBigTreatment = isReminderActive && reminderType === 'movementBreak'
  const reminderInfo = REMINDER_MESSAGES[reminderType] || REMINDER_MESSAGES.water

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: '6px', paddingBottom: '4px' }}>

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
          <span className="mascot-now-playing__icon">🎵</span>
          <div className="mascot-now-playing__text">
            {mediaTitle && <div className="mascot-now-playing__title">{mediaTitle}</div>}
            {mediaArtist && <div className="mascot-now-playing__artist">{mediaArtist}</div>}
          </div>
        </div>
      )}

      {/* Hunger card */}
      {showHunger && (
        <div
          className="mascot-reminder-card is-small"
          onClick={handleFeed}
        >
          <div className="mascot-reminder-card__content">
            <span className="mascot-reminder-card__icon">🐟</span>
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__title">Hungry!</div>
              <div className="mascot-reminder-card__message">Time to eat.</div>
            </div>
          </div>
          <button
            className="mascot-dismiss"
            onClick={(e) => { e.stopPropagation(); handleFeed() }}
            aria-label="Feed cat"
          >
            ✕
          </button>
        </div>
      )}

      {/* Reminder card */}
      {isReminderActive && reminderState === 'ACTIVE' && (
        <div
          className={`mascot-reminder-card ${isBigTreatment ? 'is-big' : 'is-small'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mascot-reminder-card__content">
            <span className="mascot-reminder-card__icon">{reminderInfo.icon}</span>
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__title">{reminderInfo.title}</div>
              <div className="mascot-reminder-card__message">{reminderInfo.text}</div>
            </div>
          </div>
          <button
            className="mascot-dismiss"
            onClick={handleReminderDismiss}
            aria-label="Dismiss reminder"
          >
            ✕
          </button>
        </div>
      )}


      {/* Chat Input */}
      {chatState === 'input' && (
        <div className="mascot-chat-input-wrap">
          <input
            ref={chatInputRef}
            className="mascot-chat-input"
            type="text"
            placeholder="Talk to me..."
            onKeyDown={(e) => {
              if (handleChatActivity) handleChatActivity()
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.target.value.trim() && handleChatSend) {
                  handleChatSend(e.target.value)
                }
              } else if (e.key === 'Escape') {
                e.preventDefault()
                if (handleChatDismiss) handleChatDismiss()
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Chat Waiting Bubble */}
      {chatState === 'waiting' && (
        <div className="mascot-chat-bubble mascot-chat-bubble--waiting">
          <div className="mascot-chat-bubble__dots">
            <span>.</span><span>.</span><span>.</span>
          </div>
        </div>
      )}

      {/* Chat Reply Bubble */}
      {chatState === 'reply' && (
        <div
          className="mascot-reminder-card mascot-chat-bubble--reply"
          onClick={(e) => {
            e.stopPropagation()
            if (handleChatDismiss) handleChatDismiss()
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mascot-reminder-card__content">
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__message" style={{ whiteSpace: 'pre-wrap' }}>
                {chatReply}
              </div>
            </div>
          </div>
          <button
            className="mascot-dismiss"
            onClick={(e) => {
              e.stopPropagation()
              if (handleChatDismiss) handleChatDismiss()
            }}
            aria-label="Dismiss chat"
          >
            ✕
          </button>
        </div>
      )}

    </div>
  )
}
