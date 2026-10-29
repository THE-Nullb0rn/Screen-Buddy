import React, { useState, useEffect, useCallback } from 'react'
import { Check, X, Circle } from 'lucide-react'

export default function NotificationDaemonTab({ settings, saveSettingsPatch }) {
  const [notifStatus, setNotifStatus] = useState(null)
  const [blockInput, setBlockInput] = useState('')
  const [blockError, setBlockError] = useState('')

  const isLinux = window.api?.platform === 'linux' || navigator.userAgent.toLowerCase().includes('linux')
  const notificationsEnabled = settings.notificationsEnabled !== false

  const refreshNotifStatus = useCallback(async () => {
    if (!window.api?.notifications?.getStatus) return
    try {
      const status = await window.api.notifications.getStatus()
      setNotifStatus(status)
    } catch (_) {
      setNotifStatus(null)
    }
  }, [])

  useEffect(() => {
    refreshNotifStatus()
    const interval = setInterval(refreshNotifStatus, 5000)
    return () => clearInterval(interval)
  }, [refreshNotifStatus])

  const handleAddBlockedApp = () => {
    const trimmed = blockInput.trim()
    if (!trimmed) return
    const currentList = settings.notificationAppBlocklist || []
    if (currentList.some((app) => app.toLowerCase() === trimmed.toLowerCase())) {
      setBlockError('App already in blocklist')
      return
    }
    setBlockError('')
    const updated = [...currentList, trimmed]
    saveSettingsPatch({ notificationAppBlocklist: updated })
    setBlockInput('')
  }

  const handleRemoveBlockedApp = (index) => {
    const currentList = settings.notificationAppBlocklist || []
    const updated = currentList.filter((_, i) => i !== index)
    saveSettingsPatch({ notificationAppBlocklist: updated })
  }

  const getNotifStatusText = () => {
    if (!notificationsEnabled) return 'Disabled in settings'
    if (!isLinux) return 'System notifications active'
    if (settings.notificationMode === 'cat') {
      if (notifStatus?.running) return 'Daemon active: Screen Buddy is listening for notifications'
      return 'Daemon inactive or name in use by another daemon'
    }
    return notifStatus?.running ? 'System daemon active' : 'No system notification daemon found'
  }

  const radiosDisabled = !notificationsEnabled || !isLinux
  const isNoDaemonWarn =
    notificationsEnabled &&
    isLinux &&
    (settings.notificationMode || 'system') === 'system' &&
    notifStatus !== null &&
    !notifStatus?.running

  return (
    <div className="legacy-notif-tab">
      <div className="settings-card">
        <label className="settings-field settings-field--toggle">
          <div className="settings-field__info">
            <span className="settings-field__label">Enable notifications</span>
            <span className="settings-field__hint">
              Allow Screen Buddy to handle and display desktop notifications
            </span>
          </div>
          <input
            type="checkbox"
            className="settings-toggle-checkbox"
            checked={notificationsEnabled}
            onChange={(e) => saveSettingsPatch({ notificationsEnabled: e.target.checked })}
          />
          <span className="settings-toggle-track" aria-hidden="true" />
        </label>
      </div>

      <div className="settings-card">
        <div className="settings-field-vertical">
          <span className="settings-field__label">Notification mode</span>
          <div className="settings-radio-group">
            <div
              role="radio"
              aria-checked={(settings.notificationMode || 'system') === 'system' || !isLinux}
              tabIndex={radiosDisabled ? -1 : 0}
              className={`settings-radio-card ${
                (settings.notificationMode || 'system') === 'system' || !isLinux
                  ? 'settings-radio-card--selected'
                  : ''
              } ${radiosDisabled ? 'settings-radio-card--disabled' : ''}`}
              onClick={() => {
                if (!radiosDisabled) saveSettingsPatch({ notificationMode: 'system' })
              }}
              onKeyDown={(e) => {
                if (!radiosDisabled && (e.key === ' ' || e.key === 'Enter')) {
                  e.preventDefault()
                  saveSettingsPatch({ notificationMode: 'system' })
                }
              }}
            >
              <div className="settings-radio-box">
                {((settings.notificationMode || 'system') === 'system' || !isLinux) && (
                  <Check size={10} />
                )}
              </div>
              <div className="settings-radio-info">
                <span className="settings-radio-title">System (default)</span>
                <span className="settings-radio-desc">
                  Your desktop&apos;s own notification daemon shows notifications
                </span>
              </div>
            </div>

            <div
              role="radio"
              aria-checked={isLinux && settings.notificationMode === 'cat'}
              tabIndex={radiosDisabled ? -1 : 0}
              className={`settings-radio-card ${
                isLinux && settings.notificationMode === 'cat'
                  ? 'settings-radio-card--selected'
                  : ''
              } ${radiosDisabled ? 'settings-radio-card--disabled' : ''}`}
              onClick={() => {
                if (!radiosDisabled) saveSettingsPatch({ notificationMode: 'cat' })
              }}
              onKeyDown={(e) => {
                if (!radiosDisabled && (e.key === ' ' || e.key === 'Enter')) {
                  e.preventDefault()
                  saveSettingsPatch({ notificationMode: 'cat' })
                }
              }}
            >
              <div className="settings-radio-box">
                {isLinux && settings.notificationMode === 'cat' && <Check size={10} />}
              </div>
              <div className="settings-radio-info">
                <span className="settings-radio-title">Cat</span>
                <span className="settings-radio-desc">
                  Screen Buddy becomes your desktop notification daemon (Linux only) and shows
                  them on the cat
                </span>
              </div>
            </div>
          </div>

          <div
            className={`settings-status-line ${
              isNoDaemonWarn
                ? 'settings-status-line--warn'
                : notifStatus?.running
                ? 'settings-status-line--ok'
                : ''
            }`}
          >
            <span className="settings-status-icon">
              <Circle
                size={8}
                fill="currentColor"
                color={
                  isNoDaemonWarn
                    ? 'var(--danger)'
                    : notifStatus?.running
                    ? 'var(--ok)'
                    : 'var(--info)'
                }
              />
            </span>
            <span className="settings-status-text">{getNotifStatusText()}</span>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-field-vertical">
          <span className="settings-field__label">Blocked apps</span>
          <span className="settings-field__hint">
            Notifications from these applications will be silently ignored
          </span>

          <div className="settings-input-group">
            <input
              type="text"
              className="settings-input"
              value={blockInput}
              onChange={(e) => setBlockInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddBlockedApp()
                }
              }}
              placeholder="e.g. discord, slack"
              maxLength={100}
            />
            <button
              type="button"
              className="settings-btn settings-btn--secondary"
              onClick={handleAddBlockedApp}
            >
              Add
            </button>
          </div>
          {blockError && <span className="settings-field__error">{blockError}</span>}

          <div className="settings-chips-container">
            {(settings.notificationAppBlocklist || []).map((app, index) => (
              <span key={`${app}-${index}`} className="settings-chip">
                <span className="settings-chip-text">{app}</span>
                <button
                  type="button"
                  className="settings-chip-remove"
                  onClick={() => handleRemoveBlockedApp(index)}
                  aria-label={`Remove ${app}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {(!settings.notificationAppBlocklist ||
              settings.notificationAppBlocklist.length === 0) && (
              <span className="settings-chips-empty">No blocked apps</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
