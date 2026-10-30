import React from 'react'
import { Card, Row, Toggle, Slider } from '../ui'
import { Power, Pause, RefreshCw, Volume2, Volume, MessageSquare } from 'lucide-react'

export default function GeneralTab({ settings, saveSettingsPatch }) {
  const handlePauseToggle = (checked) => {
    saveSettingsPatch({ paused: checked })
    if (window.api?.setPaused) {
      window.api.setPaused(checked)
    }
  }

  return (
    <>
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

      <Card title="Sound Effects" icon={Volume2}>
        <Row
          icon={Volume2}
          label="Sound Effects"
          hint="Play sound effects for interactions"
        >
          <Toggle
            checked={Boolean(settings.soundEffects)}
            onChange={(e) => saveSettingsPatch({ soundEffects: e.target.checked })}
            ariaLabel="Sound Effects"
          />
        </Row>
        <Row
          icon={Volume}
          label="Volume"
          hint="Volume for sound effects"
        >
          <Slider
            value={settings.soundVolume ?? 70}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(e) => saveSettingsPatch({ soundVolume: Number(e.target.value) })}
            ariaLabel="Volume"
          />
        </Row>
        <Row
          icon={MessageSquare}
          label="Cat voice / meows"
          hint="Play meow sounds when interacting with the cat"
        >
          <Toggle
            checked={Boolean(settings.catVoiceSounds)}
            onChange={(e) => saveSettingsPatch({ catVoiceSounds: e.target.checked })}
            ariaLabel="Cat voice / meows"
          />
        </Row>
      </Card>
    </>
  )
}
