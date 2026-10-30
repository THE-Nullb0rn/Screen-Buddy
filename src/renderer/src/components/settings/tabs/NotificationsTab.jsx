import React from 'react'
import { Card, Row, Toggle, Slider } from '../ui'
import {
  Bell,
  Sparkles,
  Volume2,
  Clock,
  MessageCircle,
  Utensils,
  Music,
  RefreshCw,
} from 'lucide-react'

export default function NotificationsTab({ settings = {}, saveSettingsPatch }) {
  const currentDuration = settings.notificationDuration ?? 5
  const autoHide = settings.notificationAutoHide !== false

  return (
    <>
      <Card
        title="Notification Settings"
        subtitle="Configure general notification behavior."
        icon={Bell}
      >
        <Row
          icon={Bell}
          label="Enable notifications"
          hint="Show Screen Buddy cards (reminders, hunger, music)"
        >
          <Toggle
            checked={settings.notificationsEnabled !== false}
            onChange={(e) => saveSettingsPatch({ notificationsEnabled: e.target.checked })}
            ariaLabel="Enable notifications"
          />
        </Row>

        <Row
          icon={Sparkles}
          label="Show notification animations"
          hint="Animate cards when they appear and disappear"
        >
          <Toggle
            checked={settings.notificationAnimations !== false}
            onChange={(e) => saveSettingsPatch({ notificationAnimations: e.target.checked })}
            ariaLabel="Show notification animations"
          />
        </Row>

        <Row
          icon={Volume2}
          label="Notification sounds"
          hint="Play soft audio cues with companion alerts"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.notificationSounds)}
            onChange={(e) => saveSettingsPatch({ notificationSounds: e.target.checked })}
            ariaLabel="Notification sounds"
          />
        </Row>

        <Row
          icon={Clock}
          label="Auto-hide notifications"
          hint="Automatically dismiss card after display duration"
        >
          <Toggle
            checked={autoHide}
            onChange={(e) => saveSettingsPatch({ notificationAutoHide: e.target.checked })}
            ariaLabel="Auto-hide notifications"
          />
        </Row>

        <Row
          icon={Clock}
          label="Display duration"
          hint="How long cards stay visible before fading"
          className={!autoHide ? 'sb-row--disabled' : ''}
        >
          <Slider
            value={currentDuration}
            min={2}
            max={30}
            step={1}
            unit="s"
            disabled={!autoHide}
            onChange={(e) => saveSettingsPatch({ notificationDuration: Number(e.target.value) })}
            ariaLabel="Display duration"
          />
        </Row>
      </Card>

      <Card
        title="Notification Types"
        subtitle="Choose which events should show notifications."
        icon={MessageCircle}
      >
        <Row
          icon={Bell}
          label="Reminders"
          hint="Hydration, eye rest, and movement nudges"
        >
          <Toggle
            checked={settings.reminderNotifications !== false}
            onChange={(e) => saveSettingsPatch({ reminderNotifications: e.target.checked })}
            ariaLabel="Reminder cards"
          />
        </Row>

        <Row
          icon={Utensils}
          label="Hunger & Needs"
          hint="Alerts when your buddy is hungry or needs care"
        >
          <Toggle
            checked={settings.hungerNotify !== false}
            onChange={(e) => saveSettingsPatch({ hungerNotify: e.target.checked })}
            ariaLabel="Hunger cards"
          />
        </Row>

        <Row
          icon={Music}
          label="Music Playing"
          hint="Now-playing song alerts from supported players"
        >
          <Toggle
            checked={settings.notificationCardMusic !== false}
            onChange={(e) => saveSettingsPatch({ notificationCardMusic: e.target.checked })}
            ariaLabel="Music cards"
          />
        </Row>

        <Row
          icon={RefreshCw}
          label="Updates"
          hint="New version and release announcements"
          soon={true}
        >
          <Toggle
            checked={settings.notificationCardUpdates !== false}
            onChange={(e) => saveSettingsPatch({ notificationCardUpdates: e.target.checked })}
            ariaLabel="Update alerts"
          />
        </Row>
      </Card>
    </>
  )
}
