import React, { useState, useEffect } from 'react'
import { Card, Row, Toggle, Button } from '../ui'
import {
  RefreshCw,
  Zap,
  Laptop,
  Code,
  FileCode,
  FolderOpen,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  Clock,
  Loader2,
  ExternalLink,
} from 'lucide-react'

export default function AdvancedTab({
  settings = {},
  saveSettingsPatch,
  onResetSettings,
  updateState,
  onCheckUpdates,
}) {
  const [settingsPath, setSettingsPath] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    if (window.api?.getSettingsPath) {
      window.api.getSettingsPath().then((p) => setSettingsPath(p || ''))
    }
  }, [])

  const handleCopyPath = async () => {
    if (!settingsPath) return
    if (window.api?.copyText) {
      await window.api.copyText(settingsPath)
    } else {
      await navigator.clipboard.writeText(settingsPath)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const handleOpenFolder = () => {
    if (window.api?.openSettingsFolder) {
      window.api.openSettingsFolder()
    }
  }

  const handleExecuteReset = async () => {
    setIsResetting(true)
    try {
      if (onResetSettings) {
        await onResetSettings()
      } else if (window.api?.resetSettings) {
        await window.api.resetSettings()
      }
    } finally {
      setIsResetting(false)
      setConfirmReset(false)
    }
  }

  const handleManualUpdateCheck = () => {
    if (onCheckUpdates) {
      onCheckUpdates(false)
    }
  }

  const formatLastChecked = (ts) => {
    if (!ts) return 'Never checked yet'
    try {
      const d = new Date(ts)
      if (isNaN(d.getTime())) return 'Never checked yet'

      const now = new Date()
      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()

      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear()

      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

      if (isToday) {
        return `Today, ${timeStr}`
      }
      if (isYesterday) {
        return `Yesterday, ${timeStr}`
      }

      const isSameYear = d.getFullYear() === now.getFullYear()
      const dateStr = d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        ...(isSameYear ? {} : { year: 'numeric' }),
      })
      return `${dateStr}, ${timeStr}`
    } catch (_) {
      return 'Never checked yet'
    }
  }

  const fpsOptions = [30, 60]

  return (
    <>
      <Card title="Updates" icon={RefreshCw}>
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

        <Row
          icon={Clock}
          label="Update status"
          hint={`Last checked: ${formatLastChecked(settings.lastUpdateCheck)}`}
        >
          <Button
            variant="primary"
            size="small"
            onClick={handleManualUpdateCheck}
            disabled={updateState?.status === 'checking'}
          >
            {updateState?.status === 'checking' ? (
              <>
                <Loader2 size={13} className="sb-spinner" />
                <span>Checking…</span>
              </>
            ) : (
              <>
                <RefreshCw size={13} />
                <span>Check now</span>
              </>
            )}
          </Button>
        </Row>

        {updateState && updateState.status !== 'checking' && (
          <div className="sb-update-status-wrap">
            {updateState.status === 'up-to-date' && (
              <div className="sb-update-banner sb-update-banner--ok">
                <span>You&apos;re on the latest version</span>
              </div>
            )}
            {updateState.status === 'no-releases' && (
              <div className="sb-update-banner sb-update-banner--muted">
                <span>No releases published yet</span>
              </div>
            )}
            {updateState.status === 'offline' && (
              <div className="sb-update-banner sb-update-banner--danger">
                <span>Can&apos;t reach GitHub. Check your network connection.</span>
              </div>
            )}
            {updateState.status === 'error' && (
              <div className="sb-update-banner sb-update-banner--danger">
                <span>{updateState.error || 'Failed to check updates.'}</span>
              </div>
            )}
            {updateState.status === 'available' && (
              <div className="sb-new-version-card">
                <span className="sb-new-version-card__title">
                  New version v{updateState.latestVersion} available!
                </span>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() =>
                    window.api?.openExternal?.(
                      updateState.htmlUrl ||
                        'https://github.com/THE-Nullb0rn/Screen-Buddy/releases'
                    )
                  }
                >
                  <ExternalLink size={12} />
                  <span>Open on GitHub</span>
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Performance" icon={Zap}>
        <Row
          icon={Zap}
          label="Animation FPS"
          hint="Target framerate for cat animation loop"
          soon={true}
        >
          <div className="sb-segmented-group">
            {fpsOptions.map((fps) => (
              <button
                key={fps}
                type="button"
                className={`sb-segmented-btn ${(settings.animationFps ?? 60) === fps ? 'sb-segmented-btn--active' : ''}`}
                onClick={() => saveSettingsPatch({ animationFps: fps })}
              >
                {fps} FPS
              </button>
            ))}
          </div>
        </Row>

        <Row
          icon={Zap}
          label="Reduce resource usage"
          hint="Lower particle effects and rendering priority to save power"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.reduceResourceUsage)}
            onChange={(e) => saveSettingsPatch({ reduceResourceUsage: e.target.checked })}
            ariaLabel="Reduce resource usage"
          />
        </Row>

        <Row
          icon={Clock}
          label="Pause animation when idle"
          hint="Suspend sprite rendering when computer is idle"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.pauseAnimationIdle)}
            onChange={(e) => saveSettingsPatch({ pauseAnimationIdle: e.target.checked })}
            ariaLabel="Pause animation when idle"
          />
        </Row>

        <Row
          icon={Zap}
          label="Limit background CPU usage"
          hint="Throttles idle loop ticks when window is unfocused"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.limitBackgroundCpu)}
            onChange={(e) => saveSettingsPatch({ limitBackgroundCpu: e.target.checked })}
            ariaLabel="Limit background CPU usage"
          />
        </Row>
      </Card>

      <Card title="Startup & System" icon={Laptop}>
        <Row
          icon={Laptop}
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
          icon={Laptop}
          label="Start minimized"
          hint="Launch companion quietly in the background on startup"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.startMinimized)}
            onChange={(e) => saveSettingsPatch({ startMinimized: e.target.checked })}
            ariaLabel="Start minimized"
          />
        </Row>

        <Row
          icon={Clock}
          label="Delay startup"
          hint="Wait a few seconds after login before spawning buddy"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.delayStartup)}
            onChange={(e) => saveSettingsPatch({ delayStartup: e.target.checked })}
            ariaLabel="Delay startup"
          />
        </Row>

        <Row
          icon={Laptop}
          label="Minimize to system tray"
          hint="Keep running in system tray when companion windows close"
          soon={true}
        >
          <Toggle
            checked={settings.minimizeToTray !== false}
            onChange={(e) => saveSettingsPatch({ minimizeToTray: e.target.checked })}
            ariaLabel="Minimize to system tray"
          />
        </Row>

        <Row
          icon={Laptop}
          label="Show tray icon"
          hint="Display companion icon in notification tray"
          soon={true}
        >
          <Toggle
            checked={settings.showTrayIcon !== false}
            onChange={(e) => saveSettingsPatch({ showTrayIcon: e.target.checked })}
            ariaLabel="Show tray icon"
          />
        </Row>
      </Card>

      <Card title="Experimental & Developer" icon={Code}>
        <Row
          icon={Code}
          label="Experimental features"
          hint="Unlock experimental mechanics and beta modules"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.experimentalFeatures)}
            onChange={(e) => saveSettingsPatch({ experimentalFeatures: e.target.checked })}
            ariaLabel="Experimental features"
          />
        </Row>

        <Row
          icon={Code}
          label="Developer mode"
          hint="Enable dev logs and debugging tools"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.developerMode)}
            onChange={(e) => saveSettingsPatch({ developerMode: e.target.checked })}
            ariaLabel="Developer mode"
          />
        </Row>

        <Row
          icon={Code}
          label="Allow custom CSS"
          hint="Load user stylesheet overrides from config directory"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.allowCustomCss)}
            onChange={(e) => saveSettingsPatch({ allowCustomCss: e.target.checked })}
            ariaLabel="Allow custom CSS"
          />
        </Row>
      </Card>

      <Card title="Settings file" icon={FileCode}>
        <p className="sb-card-desc">
          Configuration is stored locally as JSON in your user directory:
        </p>

        <div className="sb-code-box">
          <code className="sb-code-box__text">{settingsPath || '~/.config/screen-buddy/settings.json'}</code>
          <div className="sb-code-box__actions">
            <Button
              variant="secondary"
              size="small"
              onClick={handleCopyPath}
              aria-label="Copy settings file path"
            >
              {copied ? (
                <>
                  <Check size={12} className="sb-icon--ok" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy</span>
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={handleOpenFolder}
              aria-label="Open settings folder in file manager"
            >
              <FolderOpen size={12} />
              <span>Open folder</span>
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Reset" icon={AlertTriangle}>
        <p className="sb-card-desc">
          Restore all application settings back to their original factory defaults.
        </p>

        {!confirmReset ? (
          <div>
            <Button
              variant="danger"
              onClick={() => setConfirmReset(true)}
              className="sb-btn--danger-action"
            >
              <RotateCcw size={14} />
              <span>Reset all settings to default</span>
            </Button>
          </div>
        ) : (
          <div className="sb-confirm-box">
            <div className="sb-confirm-box__msg">
              <AlertTriangle size={16} className="sb-icon--danger" />
              <span>This resets everything including your API key. Reset?</span>
            </div>
            <div className="sb-confirm-box__actions">
              <Button
                variant="secondary"
                size="small"
                onClick={() => setConfirmReset(false)}
                disabled={isResetting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="small"
                onClick={handleExecuteReset}
                disabled={isResetting}
              >
                {isResetting ? 'Resetting…' : 'Reset'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
