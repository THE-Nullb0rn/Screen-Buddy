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

const BUILTIN_REMINDERS = [
  {
    id: 'water',
    title: 'Drink water',
    defaultDesc: 'Stay hydrated with a sip of water.',
    icon: Droplet,
    defaultAnimation: 'wave',
    defaultSound: 'default',
  },
  {
    id: 'eyeRest',
    title: 'Rest your eyes',
    defaultDesc: '20-20-20 rule: look 20 feet away for 20 seconds.',
    icon: Eye,
    defaultAnimation: 'sleepy',
    defaultSound: 'soft',
  },
  {
    id: 'movementBreak',
    title: 'Movement break',
    defaultDesc: 'Stand up, stretch your muscles, and take a quick walk.',
    icon: Footprints,
    defaultAnimation: 'stretch',
    defaultSound: 'default',
  },
]

function getRepeatConfig(intervalMinutes) {
  const standardPresets = [
    { value: '15m', minutes: 15, label: 'Every 15 min' },
    { value: '30m', minutes: 30, label: 'Every 30 min' },
    { value: '1h', minutes: 60, label: 'Every 1 hour' },
    { value: '2h', minutes: 120, label: 'Every 2 hours' },
    { value: 'daily', minutes: null, label: 'Daily' },
  ]

  const match = standardPresets.find((p) => p.minutes === intervalMinutes)
  if (match) {
    return {
      options: standardPresets.map(({ value, label }) => ({ value, label })),
      defaultValue: match.value,
    }
  }

  return {
    options: [
      { value: 'custom', label: `Every ${intervalMinutes} min` },
      ...standardPresets.map(({ value, label }) => ({ value, label })),
    ],
    defaultValue: 'custom',
  }
}

const ANIMATION_OPTIONS = [
  { value: 'wave', label: 'Wave' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'sleepy', label: 'Sleepy' },
]

const SOUND_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'soft', label: 'Soft' },
  { value: 'none', label: 'None' },
]

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
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    repeat: '30m',
    startTime: '',
    endTime: '',
    animation: 'wave',
    sound: 'default',
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

  const handleReminderToggle = (key, checked) => {
    const current = settings.reminders || {
      water: true,
      eyeRest: true,
      movementBreak: true,
    }
    saveSettingsPatch({
      reminders: {
        ...current,
        [key]: checked,
      },
    })
  }

  const handlePencilClick = (reminder, e) => {
    openerRef.current = e?.currentTarget || null
    setEditingId(reminder.id)
    const { defaultValue } = getRepeatConfig(intervalMinutes)
    setDraft({
      title: reminder.title,
      description: reminder.defaultDesc,
      repeat: defaultValue,
      startTime: '',
      endTime: '',
      animation: reminder.defaultAnimation,
      sound: reminder.defaultSound,
    })
  }

  const handleCloseEdit = () => {
    setEditingId(null)
    openerRef.current?.focus()
  }

  // Focus Title input on open
  useEffect(() => {
    if (editingId) {
      const timer = setTimeout(() => {
        titleInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [editingId])

  // Escape key closes modal
  useEffect(() => {
    if (!editingId) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleCloseEdit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingId])

  // Lock page scroll behind modal
  useEffect(() => {
    if (!editingId) return
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
  }, [editingId])

  const editingReminder = BUILTIN_REMINDERS.find((r) => r.id === editingId)
  const { options: repeatOptions } = getRepeatConfig(intervalMinutes)

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
          soon={true}
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
          soon={true}
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
          soon={true}
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
          {BUILTIN_REMINDERS.map((r) => {
            const IconComp = r.icon
            const isChecked = settings.reminders?.[r.id] !== false
            const isEditing = editingId === r.id
            return (
              <div
                key={r.id}
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
                  <div className="sb-reminder-title">{r.title}</div>
                  <div className="sb-reminder-subline">
                    Every {intervalMinutes} {intervalMinutes === 1 ? 'minute' : 'minutes'}
                  </div>
                </div>
                <div className="sb-reminder-actions">
                  <Toggle
                    checked={isChecked}
                    onChange={(e) => handleReminderToggle(r.id, e.target.checked)}
                    ariaLabel={r.title}
                  />
                  <button
                    type="button"
                    className={`sb-btn-icon ${isEditing ? 'sb-btn-icon--active' : ''}`}
                    onClick={(e) => handlePencilClick(r, e)}
                    title="Edit reminder"
                    aria-label={`Edit ${r.title}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="sb-btn-icon"
                    disabled
                    title="Built-in reminders can't be deleted"
                    aria-label="Built-in reminders can't be deleted"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
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
          soon={true}
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

      {/* Centered Modal Overlay for Edit Reminder */}
      {editingReminder && (
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
                  Add / Edit Reminder
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
              <div className="sb-reminder-note">Custom reminders are coming soon.</div>

              <div className="sb-form-group">
                <label className="sb-form-label">Title</label>
                <input
                  ref={titleInputRef}
                  type="text"
                  className="sb-input"
                  value={draft.title}
                  onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                  aria-label="Reminder title"
                />
              </div>

              <div className="sb-form-group">
                <label className="sb-form-label">Description (optional)</label>
                <input
                  type="text"
                  className="sb-input"
                  value={draft.description}
                  placeholder="Add a friendly description..."
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, description: e.target.value }))
                  }
                  aria-label="Reminder description"
                />
              </div>

              <div className="sb-form-group">
                <label className="sb-form-label">Repeat</label>
                <Select
                  value={draft.repeat}
                  options={repeatOptions}
                  onChange={(e) => setDraft((prev) => ({ ...prev, repeat: e.target.value }))}
                  ariaLabel="Repeat frequency"
                />
              </div>

              <div className="sb-form-row-2col">
                <div className="sb-form-group">
                  <label className="sb-form-label">Start Time</label>
                  <input
                    type="time"
                    className="sb-time-input"
                    value={draft.startTime}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, startTime: e.target.value }))
                    }
                    aria-label="Start time"
                  />
                </div>
                <div className="sb-form-group">
                  <label className="sb-form-label">End Time (optional)</label>
                  <input
                    type="time"
                    className="sb-time-input"
                    value={draft.endTime}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, endTime: e.target.value }))
                    }
                    aria-label="End time"
                  />
                </div>
              </div>

              <div className="sb-form-row-2col">
                <div className="sb-form-group">
                  <label className="sb-form-label">Animation</label>
                  <Select
                    value={draft.animation}
                    options={ANIMATION_OPTIONS}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, animation: e.target.value }))
                    }
                    ariaLabel="Animation style"
                  />
                </div>
                <div className="sb-form-group">
                  <label className="sb-form-label">Sound</label>
                  <Select
                    value={draft.sound}
                    options={SOUND_OPTIONS}
                    onChange={(e) => setDraft((prev) => ({ ...prev, sound: e.target.value }))}
                    ariaLabel="Sound option"
                  />
                </div>
              </div>

              <div className="sb-edit-actions">
                <Button variant="secondary" onClick={handleCloseEdit}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled
                  aria-label="Save Reminder (Coming soon)"
                >
                  <span className="sb-soon-pill">Soon</span>
                  <span>Save Reminder</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
