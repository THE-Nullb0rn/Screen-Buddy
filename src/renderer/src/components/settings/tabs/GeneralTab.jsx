import React, { useState, useEffect, useCallback } from 'react'
import { Card, Row, Toggle, Button } from '../ui'
import { Power, Pause, RefreshCw, Keyboard, AlertCircle } from 'lucide-react'

export default function GeneralTab({ settings, saveSettingsPatch }) {
  const [typingPerm, setTypingPerm] = useState(null)
  const isLinux = window.api?.platform === 'linux'

  const checkTypingPerm = useCallback(async () => {
    if (window.api?.checkTypingPermission) {
      try {
        const perm = await window.api.checkTypingPermission()
        setTypingPerm(perm)
      } catch (_) {
        setTypingPerm(null)
      }
    }
  }, [])

  useEffect(() => {
    if (isLinux && settings.systemTypingDetection) {
      checkTypingPerm()
    } else {
      setTypingPerm(null)
    }
  }, [isLinux, settings.systemTypingDetection, checkTypingPerm])

  const handlePauseToggle = (checked) => {
    saveSettingsPatch({ paused: checked })
    if (window.api?.setPaused) {
      window.api.setPaused(checked)
    }
  }

  return (
    <>
      <Card title="App">
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

      {isLinux && (
        <Card title="Cat reactions">
          <Row
            icon={Keyboard}
            label="React to typing system-wide"
            hint="Detect keystrokes across apps to delay reminders while actively working"
          >
            <Toggle
              checked={Boolean(settings.systemTypingDetection)}
              onChange={(e) => saveSettingsPatch({ systemTypingDetection: e.target.checked })}
              ariaLabel="React to typing system-wide"
            />
          </Row>

          {settings.systemTypingDetection && typingPerm && !typingPerm.permitted && (
            <div className="sb-permission-box">
              <div className="sb-permission-box__content">
                <AlertCircle size={18} className="sb-permission-box__icon" />
                <div className="sb-permission-box__info">
                  <span className="sb-permission-box__title">Permission required</span>
                  <p className="sb-permission-box__text">{typingPerm.instructions}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={checkTypingPerm}
                className="sb-permission-box__btn"
              >
                <RefreshCw size={12} />
                <span>Check again</span>
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
