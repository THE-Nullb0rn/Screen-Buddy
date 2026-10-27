/**
 * screen-buddy — Settings window component
 *
 * Tabbed desktop interface:
 *   - General: Interval, pause, autostart, typing detection
 *   - Reminders: Water, eye rest, movement break toggles
 *   - Notifications: Daemon mode, live status, app blocklist
 *   - Chat (AI): Gemini model & API key configuration
 *   - About: App info, config file path, Hyprland binds
 *
 * Instant-apply: changes are saved immediately via window.api.setSettings.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import './SettingsModal.css'

const TABS = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'reminders', label: 'Reminders', icon: '⏰' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
  { id: 'chat', label: 'Chat (AI)', icon: '💬' },
  { id: 'about', label: 'About', icon: 'ℹ️' },
]

export default function SettingsModal({ settings: initialSettings, onClose }) {
  const [settings, setSettings] = useState(initialSettings)
  const [activeTab, setActiveTab] = useState('general')

  const [saveStatus, setSaveStatus] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const saveTimerRef = useRef(null)

  const activeFieldRef = useRef(null)
  const tabRefs = useRef([])

  // Local state for text/number inputs
  const [intervalInput, setIntervalInput] = useState(String(initialSettings.intervalMinutes ?? 20))
  const [intervalHint, setIntervalHint] = useState('')

  const [geminiModelInput, setGeminiModelInput] = useState(
    initialSettings.geminiModel || 'gemini-3.5-flash-lite'
  )
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState(initialSettings.geminiApiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)

  const [blockInput, setBlockInput] = useState('')
  const [blockError, setBlockError] = useState('')

  // System status states
  const [typingPerm, setTypingPerm] = useState(null)
  const [settingsPath, setSettingsPath] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [notifStatus, setNotifStatus] = useState(null)

  // ── Notification status fetcher ───────────────────────────────────────────
  const refreshNotifStatus = useCallback(async () => {
    if (window.api?.notifications?.getStatus) {
      try {
        const s = await window.api.notifications.getStatus()
        setNotifStatus(s)
      } catch (_err) {
        /* ignore */
      }
    }
  }, [])

  // ── Instant settings patch saver ──────────────────────────────────────────
  const saveSettingsPatch = useCallback(
    async (patch) => {
      try {
        setSaveError(null)
        const newSettings = await window.api.setSettings(patch)
        setSettings(newSettings)

        if (activeFieldRef.current !== 'intervalMinutes') {
          setIntervalInput(String(newSettings.intervalMinutes ?? 20))
        }
        if (activeFieldRef.current !== 'geminiModel') {
          setGeminiModelInput(newSettings.geminiModel || 'gemini-3.5-flash-lite')
        }
        if (activeFieldRef.current !== 'geminiApiKey') {
          setGeminiApiKeyInput(newSettings.geminiApiKey || '')
        }

        if (patch.paused !== undefined && window.api?.setPaused) {
          window.api.setPaused(newSettings.paused)
        }

        setSaveStatus('saved')
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          setSaveStatus(null)
        }, 1200)

        if ('notificationMode' in patch || 'notificationsEnabled' in patch) {
          setTimeout(refreshNotifStatus, 300)
          setTimeout(refreshNotifStatus, 1500)
        }
      } catch (err) {
        setSaveError(err.message || 'Failed to save setting')
        try {
          const fresh = await window.api.getSettings()
          setSettings(fresh)
          setIntervalInput(String(fresh.intervalMinutes ?? 20))
          setGeminiModelInput(fresh.geminiModel || 'gemini-3.5-flash-lite')
          setGeminiApiKeyInput(fresh.geminiApiKey || '')
        } catch (_reReadErr) {
          /* ignore */
        }
      }
    },
    [refreshNotifStatus]
  )

  // ── Sync with main process push updates ───────────────────────────────────
  useEffect(() => {
    const off = window.api.on('settings:updated', (updated) => {
      setSettings(updated)
      if (activeFieldRef.current !== 'intervalMinutes') {
        setIntervalInput(String(updated.intervalMinutes ?? 20))
      }
      if (activeFieldRef.current !== 'geminiModel') {
        setGeminiModelInput(updated.geminiModel || 'gemini-3.5-flash-lite')
      }
      if (activeFieldRef.current !== 'geminiApiKey') {
        setGeminiApiKeyInput(updated.geminiApiKey || '')
      }
    })
    return off
  }, [])

  // ── Settings path ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.api?.getSettingsPath) {
      window.api.getSettingsPath().then(setSettingsPath)
    }
  }, [])

  // ── Typing permission checker ─────────────────────────────────────────────
  const checkTypingPerm = useCallback(async () => {
    if (window.api?.checkTypingPermission) {
      const perm = await window.api.checkTypingPermission()
      setTypingPerm(perm)
    }
  }, [])

  useEffect(() => {
    if (settings.systemTypingDetection) {
      checkTypingPerm()
    } else {
      setTypingPerm(null)
    }
  }, [settings.systemTypingDetection, checkTypingPerm])

  // ── Notification tab polling & status refresh ─────────────────────────────
  useEffect(() => {
    if (activeTab === 'notifications') {
      refreshNotifStatus()
    }
  }, [activeTab, refreshNotifStatus])

  useEffect(() => {
    if (activeTab !== 'notifications') return
    if (notifStatus?.running !== false) return

    const timer = setInterval(() => {
      refreshNotifStatus()
    }, 4000)
    return () => clearInterval(timer)
  }, [activeTab, notifStatus?.running, refreshNotifStatus])

  // ── Close on Escape ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Tab arrow-key navigation ──────────────────────────────────────────────
  const handleTabKeyDown = (e, index) => {
    let nextIndex = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      nextIndex = (index + 1) % TABS.length
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      nextIndex = (index - 1 + TABS.length) % TABS.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = TABS.length - 1
    }
    if (nextIndex !== null) {
      setActiveTab(TABS[nextIndex].id)
      tabRefs.current[nextIndex]?.focus()
    }
  }

  // ── Field handlers ────────────────────────────────────────────────────────
  const handleIntervalSave = () => {
    const parsed = parseInt(intervalInput, 10)
    if (Number.isNaN(parsed)) {
      setIntervalInput(String(settings.intervalMinutes ?? 20))
      setIntervalHint('1–120')
      setTimeout(() => setIntervalHint(''), 2500)
      return
    }
    const clamped = Math.min(120, Math.max(1, parsed))
    if (clamped !== parsed) {
      setIntervalHint('1–120')
      setTimeout(() => setIntervalHint(''), 2500)
    }
    setIntervalInput(String(clamped))
    if (clamped !== settings.intervalMinutes) {
      saveSettingsPatch({ intervalMinutes: clamped })
    }
  }

  const handleReminderToggle = (key, value) => {
    const currentReminders = {
      water: settings.reminders?.water ?? true,
      eyeRest: settings.reminders?.eyeRest ?? true,
      movementBreak: settings.reminders?.movementBreak ?? true,
    }
    saveSettingsPatch({
      reminders: {
        ...currentReminders,
        [key]: value,
      },
    })
  }

  const handleModelSave = () => {
    const trimmed = geminiModelInput.trim()
    if (!trimmed) {
      setGeminiModelInput(settings.geminiModel || 'gemini-3.5-flash-lite')
      return
    }
    const val = trimmed.slice(0, 100)
    setGeminiModelInput(val)
    if (val !== settings.geminiModel) {
      saveSettingsPatch({ geminiModel: val })
    }
  }

  const handleApiKeySave = () => {
    const trimmed = geminiApiKeyInput.trim().slice(0, 300)
    setGeminiApiKeyInput(trimmed)
    if (trimmed !== (settings.geminiApiKey || '')) {
      saveSettingsPatch({ geminiApiKey: trimmed })
    }
  }

  const handleAddBlockedApp = () => {
    const trimmed = blockInput.trim()
    if (!trimmed) return
    if (trimmed.length > 100) {
      setBlockError('Max 100 chars')
      setTimeout(() => setBlockError(''), 2500)
      return
    }
    const current = settings.notificationAppBlocklist || []
    if (current.length >= 100) {
      setBlockError('Max 100 apps reached')
      setTimeout(() => setBlockError(''), 2500)
      return
    }
    const isDup = current.some((app) => app.toLowerCase() === trimmed.toLowerCase())
    if (isDup) {
      setBlockInput('')
      return
    }
    setBlockError('')
    const updated = [...current, trimmed]
    setBlockInput('')
    saveSettingsPatch({ notificationAppBlocklist: updated })
  }

  const handleRemoveBlockedApp = (index) => {
    const current = settings.notificationAppBlocklist || []
    const updated = current.filter((_, i) => i !== index)
    saveSettingsPatch({ notificationAppBlocklist: updated })
  }

  const copyToClipboard = async (text, id) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch (_err) {
      /* ignore */
    }
  }

  const getFriendlyDaemonName = (ownerName) => {
    if (!ownerName) return ownerName
    const map = {
      qs: 'Quickshell',
    }
    return map[ownerName] || ownerName
  }

  const getNotifStatusText = () => {
    if (!notifStatus) return 'Checking notification status…'
    if (notifStatus.platform !== 'linux') {
      return 'Windows and macOS always use the system notifications.'
    }
    const friendly = getFriendlyDaemonName(notifStatus.ownerName)
    if (notifStatus.mode === 'cat') {
      if (notifStatus.running) {
        return 'Cat is your notification daemon.'
      }
      if (notifStatus.nameTaken) {
        if (friendly) {
          return `${friendly} is handling notifications. Stop it and the cat will take over automatically (retrying every 15 s).`
        }
        return 'Another notification daemon is running. Stop it and the cat will take over automatically (retrying every 15 s).'
      }
      return 'Starting…'
    }
    if (notifStatus.systemDaemonPresent === false) {
      return "No notification daemon is running, so desktop notifications will be lost. Switch to Cat, or start your desktop's notification daemon."
    }
    if (friendly) {
      return `Notifications are handled by ${friendly}.`
    }
    return 'Your desktop handles notifications.'
  }

  const isLinux = notifStatus ? notifStatus.platform === 'linux' : true
  const isNoDaemonWarn =
    isLinux &&
    notifStatus?.mode === 'system' &&
    notifStatus?.systemDaemonPresent === false
  const notificationsEnabled = settings.notificationsEnabled !== false
  const radiosDisabled = !notificationsEnabled || !isLinux
  const currentTabObj = TABS.find((t) => t.id === activeTab)

  return (
    <div className="settings-window">
      {/* ── Left Sidebar (Tabs) ─────────────────────────────────────────── */}
      <aside className="settings-sidebar" role="tablist" aria-label="Settings categories">
        <div className="settings-sidebar__brand">
          <span className="settings-sidebar__brand-icon">🐱</span>
          <span className="settings-sidebar__brand-name">Buddy</span>
        </div>
        <nav className="settings-nav">
          {TABS.map((tab, idx) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={`settings-tab-btn ${isActive ? 'settings-tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                <span className="settings-tab-icon" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="settings-tab-label">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ── Right Content Area ──────────────────────────────────────────── */}
      <main className="settings-main">
        {/* Header (Drag Region) */}
        <header className="settings-header">
          <div className="settings-header__title-area">
            <h1 className="settings-header__title">
              {currentTabObj ? `${currentTabObj.icon} ${currentTabObj.label}` : 'Settings'}
            </h1>
            {saveStatus === 'saved' && (
              <span className="settings-save-pill" role="status" aria-live="polite">
                Saved
              </span>
            )}
            {saveError && (
              <span className="settings-error-pill" role="alert">
                {saveError}
              </span>
            )}
          </div>
          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        {/* Tab Panel Content */}
        <div
          className="settings-content"
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
        >
          {/* ── TAB 1: General ───────────────────────────────────────────── */}
          {activeTab === 'general' && (
            <>
              <div className="settings-card">
                <div className="settings-field">
                  <div className="settings-field__info">
                    <span className="settings-field__label">Reminder interval</span>
                    <span className="settings-field__hint">
                      Minutes between reminders (1–120)
                      {intervalHint ? ` • ${intervalHint}` : ''}
                    </span>
                  </div>
                  <div className="settings-field__control">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="settings-input settings-input--number"
                      value={intervalInput}
                      onChange={(e) => setIntervalInput(e.target.value)}
                      onFocus={() => {
                        activeFieldRef.current = 'intervalMinutes'
                      }}
                      onBlur={() => {
                        activeFieldRef.current = null
                        handleIntervalSave()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      aria-label="Reminder interval in minutes"
                    />
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <label className="settings-field settings-field--toggle">
                  <div className="settings-field__info">
                    <span className="settings-field__label">Pause reminders</span>
                    <span className="settings-field__hint">Temporarily pause all reminder timers</span>
                  </div>
                  <input
                    type="checkbox"
                    className="settings-toggle-checkbox"
                    checked={!!settings.paused}
                    onChange={(e) => saveSettingsPatch({ paused: e.target.checked })}
                  />
                  <span className="settings-toggle-track" aria-hidden="true" />
                </label>
              </div>

              <div className="settings-card">
                <label className="settings-field settings-field--toggle">
                  <div className="settings-field__info">
                    <span className="settings-field__label">Start on login</span>
                    <span className="settings-field__hint">Launch automatically on desktop login</span>
                  </div>
                  <input
                    type="checkbox"
                    className="settings-toggle-checkbox"
                    checked={!!settings.autostart}
                    onChange={(e) => saveSettingsPatch({ autostart: e.target.checked })}
                  />
                  <span className="settings-toggle-track" aria-hidden="true" />
                </label>
              </div>

              <div className="settings-card">
                <div className="settings-field-group">
                  <label className="settings-field settings-field--toggle">
                    <div className="settings-field__info">
                      <span className="settings-field__label">System-wide typing detection</span>
                      <span className="settings-field__hint">
                        Detect keystrokes across apps to delay reminders while actively working
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      className="settings-toggle-checkbox"
                      checked={!!settings.systemTypingDetection}
                      onChange={(e) => saveSettingsPatch({ systemTypingDetection: e.target.checked })}
                    />
                    <span className="settings-toggle-track" aria-hidden="true" />
                  </label>

                  {settings.systemTypingDetection && typingPerm && !typingPerm.permitted && (
                    <div className="settings-permission-box">
                      <p className="settings-permission-text">{typingPerm.instructions}</p>
                      <button
                        type="button"
                        className="settings-btn settings-btn--secondary"
                        onClick={checkTypingPerm}
                      >
                        Recheck Permission
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── TAB 2: Reminders ─────────────────────────────────────────── */}
          {activeTab === 'reminders' && (
            <>
              <div className="settings-card">
                <label className="settings-field settings-field--toggle">
                  <div className="settings-field__info">
                    <span className="settings-field__label">💧 Water</span>
                    <span className="settings-field__hint">
                      Periodic prompts to drink water and stay hydrated
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="settings-toggle-checkbox"
                    checked={settings.reminders?.water ?? true}
                    onChange={(e) => handleReminderToggle('water', e.target.checked)}
                  />
                  <span className="settings-toggle-track" aria-hidden="true" />
                </label>
              </div>

              <div className="settings-card">
                <label className="settings-field settings-field--toggle">
                  <div className="settings-field__info">
                    <span className="settings-field__label">👀 Eye rest</span>
                    <span className="settings-field__hint">
                      20-20-20 prompts to look 20 feet away and reduce digital eye strain
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="settings-toggle-checkbox"
                    checked={settings.reminders?.eyeRest ?? true}
                    onChange={(e) => handleReminderToggle('eyeRest', e.target.checked)}
                  />
                  <span className="settings-toggle-track" aria-hidden="true" />
                </label>
              </div>

              <div className="settings-card">
                <label className="settings-field settings-field--toggle">
                  <div className="settings-field__info">
                    <span className="settings-field__label">🤸 Movement break</span>
                    <span className="settings-field__hint">
                      Prompts to stretch, check your posture, and move around
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="settings-toggle-checkbox"
                    checked={settings.reminders?.movementBreak ?? true}
                    onChange={(e) => handleReminderToggle('movementBreak', e.target.checked)}
                  />
                  <span className="settings-toggle-track" aria-hidden="true" />
                </label>
              </div>
            </>
          )}

          {/* ── TAB 3: Notifications ─────────────────────────────────────── */}
          {activeTab === 'notifications' && (
            <>
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
                    {/* System mode card */}
                    <div
                      role="radio"
                      aria-checked={
                        (settings.notificationMode || 'system') === 'system' || !isLinux
                      }
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
                      <div className="settings-radio-circle" />
                      <div className="settings-radio-info">
                        <span className="settings-radio-title">System (default)</span>
                        <span className="settings-radio-desc">
                          your desktop&apos;s own notification daemon shows notifications
                        </span>
                      </div>
                    </div>

                    {/* Cat mode card */}
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
                      <div className="settings-radio-circle" />
                      <div className="settings-radio-info">
                        <span className="settings-radio-title">Cat</span>
                        <span className="settings-radio-desc">
                          Screen Buddy becomes your desktop notification daemon (Linux only) and shows
                          them on the cat
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status Line */}
                  <div className={`settings-status-line${isNoDaemonWarn ? ' settings-status-line--warn' : ''}`}>
                    <span className="settings-status-icon">{isNoDaemonWarn ? '⚠️' : 'ℹ️'}</span>
                    <span className="settings-status-text">{getNotifStatusText()}</span>
                  </div>
                </div>
              </div>

              {/* Blocked Apps Editor */}
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
                          ✕
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
            </>
          )}

          {/* ── TAB 4: Chat (AI) ─────────────────────────────────────────── */}
          {activeTab === 'chat' && (
            <>
              <div className="settings-card">
                <div className="settings-field-vertical">
                  <label className="settings-field__label" htmlFor="gemini-model-input">
                    Gemini model
                  </label>
                  <span className="settings-field__hint">
                    Model name for companion chat responses (max 100 characters)
                  </span>
                  <input
                    id="gemini-model-input"
                    type="text"
                    className="settings-input"
                    value={geminiModelInput}
                    onChange={(e) => setGeminiModelInput(e.target.value)}
                    onFocus={() => {
                      activeFieldRef.current = 'geminiModel'
                    }}
                    onBlur={() => {
                      activeFieldRef.current = null
                      handleModelSave()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    placeholder="gemini-3.5-flash-lite"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-field-vertical">
                  <label className="settings-field__label" htmlFor="gemini-api-key-input">
                    Gemini API key
                  </label>
                  <div className="settings-input-group">
                    <input
                      id="gemini-api-key-input"
                      type={showApiKey ? 'text' : 'password'}
                      className="settings-input"
                      value={geminiApiKeyInput}
                      onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                      onFocus={() => {
                        activeFieldRef.current = 'geminiApiKey'
                      }}
                      onBlur={() => {
                        activeFieldRef.current = null
                        handleApiKeySave()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      placeholder="Paste Gemini API key"
                      maxLength={300}
                      autoComplete="off"
                      spellCheck="false"
                    />
                    <button
                      type="button"
                      className="settings-btn settings-btn--secondary"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <span className="settings-field__hint">
                    Stored in plain text in your settings file.
                  </span>
                </div>
              </div>
            </>
          )}

          {/* ── TAB 5: About ─────────────────────────────────────────────── */}
          {activeTab === 'about' && (
            <>
              <div className="settings-card">
                <div className="settings-about-header">
                  <span className="settings-about-title">🟢 Screen Buddy</span>
                  <span className="settings-about-subtitle">
                    A desktop companion that nudges you to take care of yourself while you work.
                  </span>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-field-vertical">
                  <span className="settings-field__label">Settings file path</span>
                  <div className="settings-code-box">
                    <code className="settings-code-text">
                      {settingsPath || '~/.config/screen-buddy/settings.json'}
                    </code>
                    <button
                      type="button"
                      className="settings-btn settings-btn--secondary"
                      onClick={() => copyToClipboard(settingsPath, 'path')}
                    >
                      {copiedId === 'path' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-field-vertical">
                  <span className="settings-field__label">Hyprland hotkey binds</span>
                  <span className="settings-field__hint">
                    Add these exact binds to your hyprland.conf:
                  </span>

                  <div className="settings-binds-list">
                    <div className="settings-bind-item">
                      <span className="settings-bind-label">Open settings</span>
                      <div className="settings-code-box">
                        <code className="settings-code-text">
                          bind = SUPER SHIFT, S, exec, touch &quot;$XDG_RUNTIME_DIR/screen-buddy-settings&quot;
                        </code>
                        <button
                          type="button"
                          className="settings-btn settings-btn--secondary"
                          onClick={() =>
                            copyToClipboard(
                              'bind = SUPER SHIFT, S, exec, touch "$XDG_RUNTIME_DIR/screen-buddy-settings"',
                              'bind-settings'
                            )
                          }
                        >
                          {copiedId === 'bind-settings' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    <div className="settings-bind-item">
                      <span className="settings-bind-label">Toggle pause</span>
                      <div className="settings-code-box">
                        <code className="settings-code-text">
                          bind = CTRL ALT, P, exec, sh -c &apos;date +%s%N &gt; &quot;$XDG_RUNTIME_DIR/screen-buddy-toggle&quot;&apos;
                        </code>
                        <button
                          type="button"
                          className="settings-btn settings-btn--secondary"
                          onClick={() =>
                            copyToClipboard(
                              'bind = CTRL ALT, P, exec, sh -c \'date +%s%N > "$XDG_RUNTIME_DIR/screen-buddy-toggle"\'',
                              'bind-pause'
                            )
                          }
                        >
                          {copiedId === 'bind-pause' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    <div className="settings-bind-item">
                      <span className="settings-bind-label">Open AI chat</span>
                      <div className="settings-code-box">
                        <code className="settings-code-text">
                          bind = CTRL SUPER, C, exec, touch &quot;$XDG_RUNTIME_DIR/screen-buddy-chat&quot;
                        </code>
                        <button
                          type="button"
                          className="settings-btn settings-btn--secondary"
                          onClick={() =>
                            copyToClipboard(
                              'bind = CTRL SUPER, C, exec, touch "$XDG_RUNTIME_DIR/screen-buddy-chat"',
                              'bind-chat'
                            )
                          }
                        >
                          {copiedId === 'bind-chat' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

