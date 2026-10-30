import React, { useState, useEffect, useRef } from 'react'
import { Card, Row, Toggle, NumberInput, Select, Button } from '../ui'
import {
  Clock,
  Droplet,
  Eye,
  Footprints,
  Bell,
  Volume2,
  Sparkles,
  GripVertical,
  Pencil,
  Trash2,
  X,
  SlidersHorizontal,
  Timer,
  RotateCcw,
  Layers,
  MessageCircle,
} from 'lucide-react'

const ICON_COMPONENTS = {
  Droplet,
  Eye,
  Footprints,
  Bell,
  Clock,
  Sparkles,
  Timer,
}

const ICON_OPTIONS = [
  { value: 'Bell', label: 'Bell' },
  { value: 'Droplet', label: 'Water' },
  { value: 'Eye', label: 'Eye' },
  { value: 'Footprints', label: 'Walk' },
  { value: 'Clock', label: 'Clock' },
  { value: 'Sparkles', label: 'Sparkles' },
  { value: 'Timer', label: 'Timer' },
]

const DEFAULT_REMINDERS_LIST = [
  {
    id: 'water',
    type: 'builtin',
    name: 'Drink water',
    icon: 'Droplet',
    message: 'Stay hydrated with a sip of water.',
    intervalMinutes: null,
    enabled: true,
    order: 0,
  },
  {
    id: 'eyeRest',
    type: 'builtin',
    name: 'Rest your eyes',
    icon: 'Eye',
    message: '20-20-20 rule: look 20 feet away for 20 seconds.',
    intervalMinutes: null,
    enabled: true,
    order: 1,
  },
  {
    id: 'movementBreak',
    type: 'builtin',
    name: 'Movement break',
    icon: 'Footprints',
    message: 'Stand up, stretch your muscles, and take a quick walk.',
    intervalMinutes: null,
    enabled: true,
    order: 2,
  },
]

function getRepeatOptions(globalInterval, isBuiltin) {
  const options = []
  if (isBuiltin) {
    options.push({ value: 'default', label: `Default (${globalInterval} min)` })
  }
  options.push(
    { value: '15', label: 'Every 15 min' },
    { value: '20', label: 'Every 20 min' },
    { value: '30', label: 'Every 30 min' },
    { value: '45', label: 'Every 45 min' },
    { value: '60', label: 'Every 1 hour' },
    { value: '120', label: 'Every 2 hours' },
    { value: 'custom', label: 'Custom minutes...' }
  )
  return options
}

const SNOOZE_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
]

const AUTO_SNOOZE_OPTIONS = [
  { value: '1', label: '1 time' },
  { value: '2', label: '2 times' },
  { value: '3', label: '3 times' },
  { value: '5', label: '5 times' },
]

export default function RemindersTab({ settings, saveSettingsPatch }) {
  const intervalMinutes = settings.intervalMinutes ?? 20
  const [intervalInput, setIntervalInput] = useState(String(intervalMinutes))

  const remindersList =
    Array.isArray(settings.remindersList) && settings.remindersList.length > 0
      ? settings.remindersList
      : DEFAULT_REMINDERS_LIST

  const customCount = remindersList.filter((r) => r.type === 'custom').length

  const [editingItem, setEditingItem] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [draggedIndex, setDraggedIndex] = useState(null)

  const [draft, setDraft] = useState({
    name: '',
    message: '',
    icon: 'Bell',
    repeatType: '30',
    customMinutes: '30',
  })

  const openerRef = useRef(null)
  const titleInputRef = useRef(null)

  useEffect(() => {
    setIntervalInput(String(settings.intervalMinutes ?? 20))
  }, [settings.intervalMinutes])

  const commitInterval = () => {
    const parsed = parseInt(intervalInput, 10)
    if (isNaN(parsed)) {
      setIntervalInput(String(settings.intervalMinutes ?? 20))
      return
    }
    const clamped = Math.min(120, Math.max(1, parsed))
    setIntervalInput(String(clamped))
    if (clamped !== settings.intervalMinutes) {
      saveSettingsPatch({ intervalMinutes: clamped })
    }
  }

  const handleReminderToggle = (id, checked) => {
    const updated = remindersList.map((r) =>
      r.id === id ? { ...r, enabled: checked } : r
    )
    saveSettingsPatch({ remindersList: updated })
  }

  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, targetIndex) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === targetIndex) return
    const updated = [...remindersList]
    const [moved] = updated.splice(draggedIndex, 1)
    updated.splice(targetIndex, 0, moved)
    const reordered = updated.map((item, idx) => ({ ...item, order: idx }))
    setDraggedIndex(null)
    saveSettingsPatch({ remindersList: reordered })
  }

  const handleDelete = (id) => {
    const updated = remindersList
      .filter((r) => r.id !== id)
      .map((item, idx) => ({ ...item, order: idx }))
    setDeletingId(null)
    saveSettingsPatch({ remindersList: updated })
  }

  const handlePencilClick = (reminder, e) => {
    openerRef.current = e?.currentTarget || null
    setEditingItem(reminder)
    const isBuiltin = reminder.type === 'builtin'
    let repeatType = 'custom'
    let customMinutes = String(reminder.intervalMinutes || intervalMinutes)

    if (isBuiltin && (reminder.intervalMinutes === null || reminder.intervalMinutes === undefined)) {
      repeatType = 'default'
      customMinutes = String(intervalMinutes)
    } else if ([15, 20, 30, 45, 60, 120].includes(reminder.intervalMinutes)) {
      repeatType = String(reminder.intervalMinutes)
    }

    setDraft({
      name: reminder.name,
      message: reminder.message || '',
      icon: reminder.icon || 'Bell',
      repeatType,
      customMinutes,
    })
  }

  const handleOpenAdd = (e) => {
    openerRef.current = e?.currentTarget || null
    setEditingItem({ id: 'new', type: 'custom' })
    setDraft({
      name: '',
      message: '',
      icon: 'Bell',
      repeatType: '30',
      customMinutes: '30',
    })
  }

  const handleCloseEdit = () => {
    setEditingItem(null)
    openerRef.current?.focus()
  }

  const handleSaveReminder = () => {
    if (!editingItem) return
    const isBuiltin = editingItem.type === 'builtin'

    let finalInterval = null
    if (isBuiltin && draft.repeatType === 'default') {
      finalInterval = null
    } else if (draft.repeatType === 'custom') {
      const parsed = parseInt(draft.customMinutes, 10)
      finalInterval = isNaN(parsed) ? (isBuiltin ? null : 30) : Math.min(1440, Math.max(1, parsed))
    } else {
      const num = Number(draft.repeatType)
      finalInterval = Number.isFinite(num) ? num : (isBuiltin ? null : 30)
    }

    if (isBuiltin) {
      const updated = remindersList.map((r) =>
        r.id === editingItem.id ? { ...r, intervalMinutes: finalInterval } : r
      )
      saveSettingsPatch({ remindersList: updated })
      handleCloseEdit()
      return
    }

    const name = draft.name.trim().slice(0, 40)
    if (!name) return

    const message = draft.message.trim().slice(0, 120)
    const icon = ICON_COMPONENTS[draft.icon] ? draft.icon : 'Bell'
    const effectiveInterval = finalInterval || 30

    let updated
    if (editingItem.id === 'new') {
      const newCustom = {
        id: `custom_${Date.now()}`,
        type: 'custom',
        name,
        message,
        icon,
        intervalMinutes: effectiveInterval,
        enabled: true,
        order: remindersList.length,
      }
      updated = [...remindersList, newCustom].map((r, idx) => ({ ...r, order: idx }))
    } else {
      updated = remindersList.map((r) =>
        r.id === editingItem.id
          ? {
              ...r,
              name,
              message,
              icon,
              intervalMinutes: effectiveInterval,
            }
          : r
      )
    }

    saveSettingsPatch({ remindersList: updated })
    handleCloseEdit()
  }

  // Focus Title input on open
  useEffect(() => {
    if (editingItem) {
      const timer = setTimeout(() => {
        titleInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [editingItem])

  // Escape key closes modal
  useEffect(() => {
    if (!editingItem) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleCloseEdit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingItem])

  // Lock page scroll behind modal
  useEffect(() => {
    if (!editingItem) return
    const scrollContainer = document.querySelector('.sb-content')
    const originalOverflow = scrollContainer?.style.overflowY
    if (scrollContainer) {
      scrollContainer.style.overflowY = 'hidden'
    }
    return () => {
      if (scrollContainer) {
        scrollContainer.style.overflowY = originalOverflow || ''
      }
    }
  }, [editingItem])

  const isBuiltin = editingItem?.type === 'builtin'

  return (
    <>
      <Card
        title="Reminder System"
        subtitle="Manage your daily reminders and habits."
        icon={Bell}
      >
        <Row
          icon={Clock}
          label="Interval"
          hint="How often Screen Buddy nudges you (1-120 minutes)"
        >
          <div className="sb-interval-control">
            <NumberInput
              value={intervalInput}
              min={1}
              max={120}
              onChange={(e) => setIntervalInput(e.target.value)}
              onBlur={commitInterval}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              aria-label="Reminder interval in minutes"
            />
            <span className="sb-unit-label">min</span>
          </div>
        </Row>

        <Row
          icon={Bell}
          label="Enable reminders"
          hint="Let Screen Buddy remind you about important habits"
        >
          <Toggle
            checked={settings.remindersEnabled !== false}
            onChange={(e) => saveSettingsPatch({ remindersEnabled: e.target.checked })}
            ariaLabel="Enable reminders"
          />
        </Row>

        <Row
          icon={MessageCircle}
          label="Show reminder notifications"
          hint="Show visual notification cards on screen"
        >
          <Toggle
            checked={settings.reminderNotifications !== false}
            onChange={(e) => saveSettingsPatch({ reminderNotifications: e.target.checked })}
            ariaLabel="Show reminder notifications"
          />
        </Row>

        <Row
          icon={Volume2}
          label="Play sound"
          hint="Play a cute sound when a reminder appears"
          soon={true}
        >
          <Toggle
            checked={settings.reminderSound !== false}
            onChange={(e) => saveSettingsPatch({ reminderSound: e.target.checked })}
            ariaLabel="Play sound"
          />
        </Row>

        <Row
          icon={Sparkles}
          label="Show cat animation"
          hint="Show special animation when reminding"
        >
          <Toggle
            checked={settings.reminderCatAnimation !== false}
            onChange={(e) => saveSettingsPatch({ reminderCatAnimation: e.target.checked })}
            ariaLabel="Show cat animation"
          />
        </Row>
      </Card>

      <Card
        title="Your Reminders"
        subtitle="Manage, edit or delete your reminders."
        icon={Clock}
        className="sb-reminders-list-card"
      >
        <div className="sb-reminders-list">
          {remindersList.map((r, idx) => {
            const IconComp = ICON_COMPONENTS[r.icon] || Bell
            const isChecked = r.enabled !== false
            const isEditing = editingItem?.id === r.id
            const effectiveMins = r.intervalMinutes || intervalMinutes
            const isDeleting = deletingId === r.id

            return (
              <div
                key={r.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={() => setDraggedIndex(null)}
                className={`sb-reminder-item ${isEditing ? 'sb-reminder-item--editing' : ''}`}
              >
                <GripVertical
                  size={16}
                  className="sb-reminder-drag-handle"
                  aria-hidden="true"
                />
                <div className="sb-reminder-icon-box">
                  <IconComp size={16} />
                </div>
                <div className="sb-reminder-info">
                  <div className="sb-reminder-title">{r.name}</div>
                  <div className="sb-reminder-subline">
                    Every {effectiveMins} {effectiveMins === 1 ? 'minute' : 'minutes'}
                  </div>
                </div>
                <div className="sb-reminder-actions">
                  <Toggle
                    checked={isChecked}
                    onChange={(e) => handleReminderToggle(r.id, e.target.checked)}
                    ariaLabel={r.name}
                  />
                  <button
                    type="button"
                    className={`sb-btn-icon ${isEditing ? 'sb-btn-icon--active' : ''}`}
                    onClick={(e) => handlePencilClick(r, e)}
                    title="Edit reminder"
                    aria-label={`Edit ${r.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  {r.type === 'builtin' ? (
                    <button
                      type="button"
                      className="sb-btn-icon"
                      disabled
                      title="Built-in reminders can't be deleted"
                      aria-label="Built-in reminders can't be deleted"
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : isDeleting ? (
                    <div className="sb-delete-confirm">
                      <span className="sb-delete-confirm-text">Delete?</span>
                      <button
                        type="button"
                        className="sb-btn-text sb-btn-danger"
                        onClick={() => handleDelete(r.id)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="sb-btn-text"
                        onClick={() => setDeletingId(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="sb-btn-icon"
                      onClick={() => setDeletingId(r.id)}
                      title="Delete reminder"
                      aria-label={`Delete ${r.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="sb-add-reminder-row">
          <Button
            variant="secondary"
            onClick={handleOpenAdd}
            disabled={customCount >= 20}
            title={customCount >= 20 ? 'Maximum 20 custom reminders reached' : 'Add custom reminder'}
          >
            + Add reminder
          </Button>
          {customCount >= 20 && (
            <span className="sb-add-limit-hint">Maximum 20 custom reminders reached</span>
          )}
        </div>
      </Card>

      <Card
        title="Advanced Options"
        subtitle="Additional reminder settings."
        icon={SlidersHorizontal}
      >
        <Row
          icon={Timer}
          label="Snooze duration"
          hint="How long to pause reminder when snoozed"
        >
          <Select
            value={String(settings.reminderSnoozeDuration ?? 5)}
            options={SNOOZE_OPTIONS}
            onChange={(e) => saveSettingsPatch({ reminderSnoozeDuration: Number(e.target.value) })}
            ariaLabel="Snooze duration"
          />
        </Row>
        <Row
          icon={RotateCcw}
          label="Auto-snooze limit"
          hint="Maximum times a reminder can automatically snooze"
          soon={true}
        >
          <Select
            value={String(settings.reminderAutoSnoozeLimit ?? 3)}
            options={AUTO_SNOOZE_OPTIONS}
            onChange={(e) => saveSettingsPatch({ reminderAutoSnoozeLimit: Number(e.target.value) })}
            ariaLabel="Auto-snooze limit"
          />
        </Row>
        <Row
          icon={Eye}
          label="Show missed reminders"
          hint="Notify if you were away when a reminder fired"
          soon={true}
        >
          <Toggle
            checked={settings.reminderShowMissed !== false}
            onChange={(e) => saveSettingsPatch({ reminderShowMissed: e.target.checked })}
            ariaLabel="Show missed reminders"
          />
        </Row>
        <Row
          icon={Layers}
          label="Group similar reminders"
          hint="Bundle reminders scheduled around the same time"
          soon={true}
        >
          <Toggle
            checked={settings.reminderGroupSimilar !== false}
            onChange={(e) => saveSettingsPatch({ reminderGroupSimilar: e.target.checked })}
            ariaLabel="Group similar reminders"
          />
        </Row>
      </Card>

      {/* Centered Modal Overlay for Add/Edit Reminder */}
      {editingItem && (
        <div
          className="sb-reminder-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseEdit()
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sb-reminder-edit-modal-title"
            className="sb-card sb-reminder-edit-modal"
          >
            <header className="sb-card__header">
              <div className="sb-card__title-group">
                <Pencil size={18} className="sb-card__icon" aria-hidden="true" />
                <h3 id="sb-reminder-edit-modal-title" className="sb-card__title">
                  {editingItem.id === 'new' ? 'Add Reminder' : isBuiltin ? 'Edit Built-in Reminder' : 'Edit Reminder'}
                </h3>
              </div>
              <button
                type="button"
                className="sb-close-btn"
                onClick={handleCloseEdit}
                aria-label="Close edit dialog"
              >
                <X size={16} />
              </button>
            </header>

            <div className="sb-card__content">
              <div className="sb-form-group">
                <label className="sb-form-label">
                  Title {isBuiltin ? '(Built-in)' : ''}
                </label>
                <input
                  ref={titleInputRef}
                  type="text"
                  className="sb-input"
                  maxLength={40}
                  value={draft.name}
                  disabled={isBuiltin}
                  placeholder={isBuiltin ? draft.name : 'e.g. Posture check'}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  aria-label="Reminder title"
                />
              </div>

              <div className="sb-form-group">
                <label className="sb-form-label">
                  Description {isBuiltin ? '(Built-in)' : ''}
                </label>
                <input
                  type="text"
                  className="sb-input"
                  maxLength={120}
                  value={draft.message}
                  disabled={isBuiltin}
                  placeholder={isBuiltin ? draft.message : 'Add a friendly message...'}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, message: e.target.value }))
                  }
                  aria-label="Reminder description"
                />
              </div>

              <div className="sb-form-group">
                <label className="sb-form-label">
                  Icon {isBuiltin ? '(Built-in)' : ''}
                </label>
                <Select
                  value={draft.icon}
                  options={ICON_OPTIONS}
                  disabled={isBuiltin}
                  onChange={(e) => setDraft((prev) => ({ ...prev, icon: e.target.value }))}
                  ariaLabel="Reminder icon"
                />
              </div>

              <div className="sb-form-group">
                <label className="sb-form-label">Repeat</label>
                <Select
                  value={draft.repeatType}
                  options={getRepeatOptions(intervalMinutes, isBuiltin)}
                  onChange={(e) => setDraft((prev) => ({ ...prev, repeatType: e.target.value }))}
                  ariaLabel="Repeat frequency"
                />
              </div>

              {draft.repeatType === 'custom' && (
                <div className="sb-form-group">
                  <label className="sb-form-label">Custom interval (1-1440 minutes)</label>
                  <div className="sb-interval-control">
                    <NumberInput
                      min={1}
                      max={1440}
                      value={draft.customMinutes}
                      onChange={(e) => setDraft((prev) => ({ ...prev, customMinutes: e.target.value }))}
                      aria-label="Custom interval minutes"
                    />
                    <span className="sb-unit-label">min</span>
                  </div>
                </div>
              )}

              <div className="sb-edit-actions">
                <Button variant="secondary" onClick={handleCloseEdit}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!isBuiltin && !draft.name.trim()}
                  onClick={handleSaveReminder}
                  aria-label="Save Reminder"
                >
                  Save Reminder
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
