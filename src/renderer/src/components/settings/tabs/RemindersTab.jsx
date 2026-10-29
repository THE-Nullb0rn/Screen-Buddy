import React, { useState, useEffect } from 'react'
import { Card, Row, Toggle, NumberInput } from '../ui'
import { Clock, Droplet, Eye, Footprints } from 'lucide-react'

export default function RemindersTab({ settings, saveSettingsPatch }) {
  const [intervalInput, setIntervalInput] = useState(String(settings.intervalMinutes ?? 20))

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

  const waterChecked = settings.reminders?.water ?? true
  const eyeChecked = settings.reminders?.eyeRest ?? true
  const movementChecked = settings.reminders?.movementBreak ?? true

  return (
    <>
      <Card title="Reminder System">
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
      </Card>

      <Card title="Your Reminders">
        <Row
          icon={Droplet}
          label="Drink water"
          hint="Periodic prompts to drink water and stay hydrated"
        >
          <Toggle
            checked={waterChecked}
            onChange={(e) => handleReminderToggle('water', e.target.checked)}
            ariaLabel="Drink water"
          />
        </Row>
        <Row
          icon={Eye}
          label="Rest your eyes"
          hint="20-20-20 prompts to look 20 feet away and reduce eye strain"
        >
          <Toggle
            checked={eyeChecked}
            onChange={(e) => handleReminderToggle('eyeRest', e.target.checked)}
            ariaLabel="Rest your eyes"
          />
        </Row>
        <Row
          icon={Footprints}
          label="Movement break"
          hint="Prompts to stretch, check posture, and move around"
        >
          <Toggle
            checked={movementChecked}
            onChange={(e) => handleReminderToggle('movementBreak', e.target.checked)}
            ariaLabel="Movement break"
          />
        </Row>
      </Card>
    </>
  )
}
