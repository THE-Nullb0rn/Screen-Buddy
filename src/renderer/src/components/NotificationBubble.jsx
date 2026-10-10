import React, { useRef, useEffect } from 'react'
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

  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    if (duration === null) return // persist until dismissed
    const timer = setTimeout(() => {
      if (onDismissRef.current) onDismissRef.current(id, 1) // reason 1 = expired
    }, duration)
    return () => clearTimeout(timer)
  }, [id, duration, notification.rev])

  const handleBodyClick = (e) => {
    e.stopPropagation()
    if (hasDefault && onAction) {
      onAction(id, 'default')
    } else if (onDismiss) {
      onDismiss(id, 2) // reason 2 = dismissed by user
    }
  }

  const handleXClick = (e) => {
    e.stopPropagation()
    if (onDismiss) onDismiss(id, 2)
  }

  return (
    <div
      className="mascot-notif-bubble"
      onClick={handleBodyClick}
      onPointerDown={(e) => e.stopPropagation()}
      role="alertdialog"
      aria-label={summary || 'Notification'}
    >
      <div className="mascot-notif-bubble__content">
        {appName && (
          <div className="mascot-notif-bubble__app-name">{appName}</div>
        )}
        {summary && (
          <div className="mascot-notif-bubble__summary">{summary}</div>
        )}
        {body && (
          <div className="mascot-notif-bubble__body">{body}</div>
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
