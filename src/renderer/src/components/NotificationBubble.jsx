import React, { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { Bell } from 'lucide-react'
import './NotificationBubble.css'

// ── Clamp expire_timeout to valid range ──────────────────────────────────────
function calcNotifDuration(notif) {
  const urgency = notif.urgency ?? 1
  const timeout = notif.expireTimeout ?? -1

  // urgency critical (2) or expire_timeout === 0 => stay until dismissed
  if (urgency === 2 || timeout === 0) return null
  // urgency low (0) => 4s
  if (urgency === 0) return 4000
  // expire_timeout > 0 => clamp between 3s and 15s
  if (timeout > 0) return Math.min(Math.max(timeout, 3000), 15000)
  // default
  return 6000
}

export default function NotificationBubble({ notification, onDismiss, onAction }) {
  const { id, appName, summary, body, actions } = notification
  const hasDefault = Array.isArray(actions) && actions.includes('default')
  const duration = calcNotifDuration(notification)

  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)

  const appNameRef = useRef(null)
  const summaryRef = useRef(null)
  const bodyRef = useRef(null)

  // Reset expanded to false whenever notification id or rev changes
  useEffect(() => {
    setExpanded(false)
  }, [id, notification.rev])

  // Measure truncation in a layout effect with refs
  useLayoutEffect(() => {
    // If expanded, do not re-measure truncation to preserve isTruncated state
    if (expanded) return

    let truncated = false
    if (bodyRef.current) {
      if (bodyRef.current.scrollHeight > bodyRef.current.clientHeight) {
        truncated = true
      }
    }
    if (!truncated && summaryRef.current) {
      if (summaryRef.current.scrollWidth > summaryRef.current.clientWidth) {
        truncated = true
      }
    }
    if (!truncated && appNameRef.current) {
      if (appNameRef.current.scrollWidth > appNameRef.current.clientWidth) {
        truncated = true
      }
    }
    setIsTruncated(truncated)
  }, [id, notification.rev, summary, body, appName, expanded])

  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

  // Timer effect: pause expiry while expanded
  useEffect(() => {
    if (duration === null || expanded) return // persist until dismissed or paused while expanded
    const timer = setTimeout(() => {
      if (onDismissRef.current) onDismissRef.current(id, 1) // reason 1 = expired
    }, duration)
    return () => clearTimeout(timer)
  }, [id, duration, notification.rev, expanded])

  const handleCardClick = (e) => {
    e.stopPropagation()
    if (!expanded) {
      if (isTruncated) {
        setExpanded(true)
      } else {
        if (hasDefault && onAction) {
          onAction(id, 'default')
        } else if (onDismiss) {
          onDismiss(id, 2) // reason 2 = dismissed by user
        }
      }
    }
    // If expanded, clicking the card/body does nothing
  }

  const handleToggleClick = (e) => {
    e.stopPropagation()
    setExpanded(prev => !prev)
  }

  const handleOpenClick = (e) => {
    e.stopPropagation()
    if (onAction) {
      onAction(id, 'default')
    } else if (onDismiss) {
      onDismiss(id, 2)
    }
  }

  const handleXClick = (e) => {
    e.stopPropagation()
    if (onDismiss) onDismiss(id, 2)
  }

  const urgency = notification.urgency ?? 1
  const urgencyClass = urgency === 2 ? ' is-critical' : urgency === 0 ? ' is-low' : ' is-normal'

  return (
    <div
      className={`mascot-notif-bubble${expanded ? ' is-expanded' : ''}${urgencyClass}`}
      onClick={handleCardClick}
      onPointerDown={(e) => e.stopPropagation()}
      role="alertdialog"
      aria-label={summary || 'Notification'}
    >
      <div className="mascot-notif-bubble__icon" aria-hidden="true">
        <Bell size={18} />
      </div>
      <div className="mascot-notif-bubble__content">
        {appName && (
          <div ref={appNameRef} className="mascot-notif-bubble__app-name">{appName}</div>
        )}
        {summary && (
          <div ref={summaryRef} className="mascot-notif-bubble__summary">{summary}</div>
        )}
        {body && (
          <div ref={bodyRef} className="mascot-notif-bubble__body">{body}</div>
        )}
        {isTruncated && !expanded && (
          <div className="mascot-notif-bubble__toggle" onClick={handleToggleClick}>
            Show more ▾
          </div>
        )}
        {expanded && (
          <>
            {hasDefault && (
              <button
                type="button"
                className="mascot-notif-bubble__open-btn"
                onClick={handleOpenClick}
              >
                Open
              </button>
            )}
            <div className="mascot-notif-bubble__toggle" onClick={handleToggleClick}>
              Show less ▴
            </div>
          </>
        )}
      </div>
      <button
        className="mascot-dismiss"
        onClick={handleXClick}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  )
}
