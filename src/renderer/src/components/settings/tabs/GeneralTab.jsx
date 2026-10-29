import React from 'react'
import { Card, Row, Toggle } from '../ui'
import { Power, Pause, RefreshCw } from 'lucide-react'

export default function GeneralTab({ settings, saveSettingsPatch }) {
  const handlePauseToggle = (checked) => {
    saveSettingsPatch({ paused: checked })
    if (window.api?.setPaused) {
      window.api.setPaused(checked)
    }
  }

  return (
    <Card title="App" icon={Power}>
      <Row
        icon={Power}
        label="Start with system"
        hint="Launch automatically on desktop login"
      >
        <Toggle
          checked={Boolean(settings.autostart)}
          onChange={(e) => saveSettingsPatch({ autostart: e.target.checked })}
          ariaLabel="Start with system"
        />
      </Row>
      <Row
        icon={Pause}
        label="Pause Screen Buddy"
        hint="Temporarily pause all reminder timers and nudges"
      >
        <Toggle
          checked={Boolean(settings.paused)}
          onChange={(e) => handlePauseToggle(e.target.checked)}
          ariaLabel="Pause Screen Buddy"
        />
      </Row>
      <Row
        icon={RefreshCw}
        label="Check for updates automatically"
        hint="Check GitHub releases when Settings opens"
      >
        <Toggle
          checked={settings.autoCheckUpdates !== false}
          onChange={(e) => saveSettingsPatch({ autoCheckUpdates: e.target.checked })}
          ariaLabel="Check for updates automatically"
        />
      </Row>
    </Card>
  )
}
