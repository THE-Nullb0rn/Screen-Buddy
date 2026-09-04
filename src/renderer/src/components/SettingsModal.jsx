/**
 * screen-buddy — Settings modal component
 *
 * A minimal modal that lets the user:
 *   - Set the reminder interval (in minutes)
 *   - Toggle global pause
 *   - Toggle Linux autostart (.desktop entry)
 *
 * Receives the current settings object and two callbacks:
 *   onSave(updates)  — persists changes (async, calls main via IPC)
 *   onClose()        — closes the modal without saving unsaved changes
 */

import React, { useState, useEffect, useRef } from 'react'
import './SettingsModal.css'

export default function SettingsModal({ settings, onSave, onClose }) {
  // ── Local form state (mirrors settings, edited locally before saving) ──────
  const [intervalMinutes, setIntervalMinutes] = useState(settings.intervalMinutes)
  const [paused, setPaused] = useState(settings.paused)
  const [autostart, setAutostart] = useState(settings.autostart)
  const [settingsPath, setSettingsPath] = useState('')
  const [saving, setSaving] = useState(false)

  // ── Fetch settings file path for display ─────────────────────────────────
  useEffect(() => {
    window.api.getSettingsPath().then(setSettingsPath)
  }, [])

  // ── Mouse hit-region: this modal is interactive ────────────────────────────
  const modalRef = useRef(null)

  useEffect(() => {
    window.api.mouseEnterInteractive()
    return () => window.api.mouseLeaveInteractive()
  }, [])

  // ── Close on Escape ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    await onSave({
      intervalMinutes: Number(intervalMinutes),
      paused,
      autostart,
    })
    setSaving(false)
    onClose()
  }

  return (
    /* Backdrop — click to close */
    <div
      className="settings-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      ref={modalRef}
    >
      <div className="settings-modal">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="settings-modal__header">
          <h2 className="settings-modal__title">⚙️ Settings</h2>
          <button
            className="settings-modal__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* ── Form ────────────────────────────────────────────────────── */}
        <div className="settings-modal__body">
          {/* Interval */}
          <label className="settings-field">
            <span className="settings-field__label">
              Reminder interval
              <span className="settings-field__hint"> (minutes)</span>
            </span>
            <input
              type="number"
              className="settings-field__input"
              min={1}
              max={120}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)}
            />
          </label>

          {/* Pause */}
          <label className="settings-field settings-field--toggle">
            <span className="settings-field__label">Pause reminders</span>
            <input
              type="checkbox"
              className="settings-field__checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />
            <span className="settings-field__toggle-track" aria-hidden="true" />
          </label>

          {/* Autostart */}
          <label className="settings-field settings-field--toggle">
            <span className="settings-field__label">
              Launch on login
              <span className="settings-field__hint"> (writes ~/.config/autostart/)</span>
            </span>
            <input
              type="checkbox"
              className="settings-field__checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
            />
            <span className="settings-field__toggle-track" aria-hidden="true" />
          </label>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="settings-modal__footer">
          {/* Show where the config file lives */}
          {settingsPath && (
            <p className="settings-modal__config-path" title={settingsPath}>
              📄 {settingsPath}
            </p>
          )}

          <div className="settings-modal__actions">
            <button className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
