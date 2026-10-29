import React, { useState, useEffect, useCallback } from 'react'
import { Card, Row, Toggle, Select, Button } from '../ui'
import {
  Keyboard,
  MousePointer,
  AppWindow,
  Music,
  Hand,
  Move,
  Mouse,
  Sparkles,
  Utensils,
  Bell,
  Smile,
  Moon,
  AlertCircle,
  RefreshCw,
  Zap,
} from 'lucide-react'

export default function BehaviorTab({ settings, saveSettingsPatch }) {
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

  const doubleClickOptions = [
    { value: 'chat', label: 'Open Chat' },
    { value: 'settings', label: 'Open Settings' },
    { value: 'none', label: 'Do Nothing' },
  ]

  const rightClickOptions = [
    { value: 'menu', label: 'Open Menu' },
    { value: 'chat', label: 'Open Chat' },
    { value: 'pause', label: 'Toggle Pause' },
  ]

  const hungerRateOptions = [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
  ]

  const hungerBehaviorOptions = [
    { value: 'search-food', label: 'Look for food' },
    { value: 'sad', label: 'Act sad' },
    { value: 'sit', label: 'Sit quietly' },
  ]

  return (
    <>
      <Card
        title="Activity Reactions"
        subtitle="Choose what wakes up Screen Buddy and how it reacts."
        icon={Zap}
      >
        {isLinux && (
          <>
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
          </>
        )}

        <Row
          icon={MousePointer}
          label="Mouse movement"
          hint="React when you move the mouse actively"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.mouseReaction)}
            onChange={(e) => saveSettingsPatch({ mouseReaction: e.target.checked })}
            ariaLabel="Mouse movement reaction"
          />
        </Row>

        <Row
          icon={AppWindow}
          label="Application focus"
          hint="React when you switch or focus an application window"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.appFocusReaction)}
            onChange={(e) => saveSettingsPatch({ appFocusReaction: e.target.checked })}
            ariaLabel="Application focus reaction"
          />
        </Row>

        <Row
          icon={Music}
          label="Media playback"
          hint="React to background music or video playback"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.mediaReaction)}
            onChange={(e) => saveSettingsPatch({ mediaReaction: e.target.checked })}
            ariaLabel="Media playback reaction"
          />
        </Row>
      </Card>

      <Card
        title="Interaction Behavior"
        subtitle="How Screen Buddy responds to your interactions."
        icon={Hand}
      >
        <Row
          icon={Hand}
          label="Click to interact"
          hint="Left click to pet or interact with the cat"
          soon={true}
        >
          <Toggle
            checked={settings.clickToInteract !== false}
            onChange={(e) => saveSettingsPatch({ clickToInteract: e.target.checked })}
            ariaLabel="Click to interact"
          />
        </Row>

        <Row
          icon={Move}
          label="Drag behavior"
          hint="Allow dragging the cat around the screen"
          soon={true}
        >
          <Toggle
            checked={settings.dragBehavior !== false}
            onChange={(e) => saveSettingsPatch({ dragBehavior: e.target.checked })}
            ariaLabel="Drag behavior"
          />
        </Row>

        <Row
          icon={Mouse}
          label="Double click action"
          hint="Action triggered on double clicking the cat"
          soon={true}
        >
          <Select
            value={settings.doubleClickAction || 'chat'}
            onChange={(e) => saveSettingsPatch({ doubleClickAction: e.target.value })}
            options={doubleClickOptions}
            ariaLabel="Double click action"
          />
        </Row>

        <Row
          icon={Mouse}
          label="Right click action"
          hint="Action triggered on right clicking the cat"
          soon={true}
        >
          <Select
            value={settings.rightClickAction || 'menu'}
            onChange={(e) => saveSettingsPatch({ rightClickAction: e.target.value })}
            options={rightClickOptions}
            ariaLabel="Right click action"
          />
        </Row>

        <Row
          icon={Sparkles}
          label="Petting effects"
          hint="Show visual heart/sparkle particles when petting"
          soon={true}
        >
          <Toggle
            checked={settings.pettingEffects !== false}
            onChange={(e) => saveSettingsPatch({ pettingEffects: e.target.checked })}
            ariaLabel="Petting effects"
          />
        </Row>
      </Card>

      <Card
        title="Hunger & Needs"
        subtitle="Keep your buddy happy and healthy."
        icon={Utensils}
      >
        <Row
          icon={Utensils}
          label="Enable hunger system"
          hint="Your buddy gets hungry over time and needs feeding"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.hungerEnabled)}
            onChange={(e) => saveSettingsPatch({ hungerEnabled: e.target.checked })}
            ariaLabel="Enable hunger system"
          />
        </Row>

        <Row
          icon={Utensils}
          label="Hunger rate"
          hint="How fast hunger levels increase"
          soon={true}
        >
          <Select
            value={settings.hungerRate || 'normal'}
            onChange={(e) => saveSettingsPatch({ hungerRate: e.target.value })}
            options={hungerRateOptions}
            ariaLabel="Hunger rate"
          />
        </Row>

        <Row
          icon={Bell}
          label="Notify when hungry"
          hint="Show a gentle hunger alert bubble"
          soon={true}
        >
          <Toggle
            checked={settings.hungerNotify !== false}
            onChange={(e) => saveSettingsPatch({ hungerNotify: e.target.checked })}
            ariaLabel="Notify when hungry"
          />
        </Row>

        <Row
          icon={Utensils}
          label="Behavior when hungry"
          hint="How your buddy acts when hungry"
          soon={true}
        >
          <Select
            value={settings.hungerBehavior || 'search-food'}
            onChange={(e) => saveSettingsPatch({ hungerBehavior: e.target.value })}
            options={hungerBehaviorOptions}
            ariaLabel="Behavior when hungry"
          />
        </Row>

        <Row
          icon={Moon}
          label="Pause hunger while sleeping"
          hint="Do not increase hunger when the cat is sleeping"
          soon={true}
        >
          <Toggle
            checked={settings.hungerPauseSleeping !== false}
            onChange={(e) => saveSettingsPatch({ hungerPauseSleeping: e.target.checked })}
            ariaLabel="Pause hunger while sleeping"
          />
        </Row>
      </Card>

      <Card
        title="Mood System"
        subtitle="Your buddy's mood changes based on your activity and interactions."
        icon={Smile}
      >
        <Row
          icon={Smile}
          label="Enable mood system"
          hint="Let your buddy have dynamic moods based on activity"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.moodEnabled)}
            onChange={(e) => saveSettingsPatch({ moodEnabled: e.target.checked })}
            ariaLabel="Enable mood system"
          />
        </Row>

        <Row
          icon={Smile}
          label="Show mood indicator"
          hint="Display mood icon near the cat"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.moodIndicator)}
            onChange={(e) => saveSettingsPatch({ moodIndicator: e.target.checked })}
            ariaLabel="Show mood indicator"
          />
        </Row>
      </Card>
    </>
  )
}
