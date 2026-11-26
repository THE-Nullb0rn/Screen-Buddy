import React, { useState, useEffect } from 'react'
import { Card, MasonryGrid, Row, Toggle, Button } from '../ui'
import UpdatePanel, { formatLastChecked } from '../UpdatePanel'
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
} from 'lucide-react'

export default function AdvancedTab({
  settings = {},
  saveSettingsPatch,
  onResetSettings,
  updateState,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  capabilities,
}) {
  const [settingsPath, setSettingsPath] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const autostartDisabled = capabilities?.autostart?.available === false
  const autostartHint = autostartDisabled
    ? (capabilities?.autostart?.reason || 'Available in the installed app')
    : 'Launch automatically on desktop login'
  const delayStartupHint = autostartDisabled
    ? (capabilities?.autostart?.reason || 'Available in the installed app')
    : 'Wait 10 seconds after login before showing the cat (applies to autostart only)'

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

  const fpsOptions = [30, 60]

  return (
    <MasonryGrid>
      <Card
        title="Updates"
        subtitle="Check for updates and manage update settings."
        icon={RefreshCw}
      >
        <Row
          icon={RefreshCw}
          label="Check for updates automatically"
          hint="Check automatically after startup and every 6 hours"
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
          hint={`Last checked: ${formatLastChecked(updateState?.lastCheckedAt || settings.lastUpdateCheck)}`}
        >
          <Button
            variant="primary"
            size="small"
            onClick={handleManualUpdateCheck}
            disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
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

        <UpdatePanel
          updateState={updateState}
          lastUpdateCheck={settings.lastUpdateCheck}
          compact={true}
          onRetry={handleManualUpdateCheck}
          onDownload={onDownloadUpdate}
          onInstall={onInstallUpdate}
        />
      </Card>

      <Card
        title="Performance"
        subtitle="Optimize performance and resource usage."
        icon={Zap}
      >
        <Row
          icon={Zap}
          label="Animation FPS"
          hint="Target framerate for cat animation loop"
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
        >
          <Toggle
            checked={Boolean(settings.limitBackgroundCpu)}
            onChange={(e) => saveSettingsPatch({ limitBackgroundCpu: e.target.checked })}
            ariaLabel="Limit background CPU usage"
          />
        </Row>
      </Card>

      <Card
        title="Startup & System"
        subtitle="Configure how Screen Buddy starts and runs with your system."
        icon={Laptop}
      >
        <Row
          icon={Laptop}
          label="Start with system"
          hint={autostartHint}
          className={autostartDisabled ? 'sb-row--disabled' : ''}
        >
          <Toggle
            checked={autostartDisabled ? false : Boolean(settings.autostart)}
            onChange={(e) => {
              if (!autostartDisabled) saveSettingsPatch({ autostart: e.target.checked })
            }}
            disabled={autostartDisabled}
            ariaLabel="Start with system"
          />
        </Row>

        <Row
          icon={Clock}
          label="Delay startup"
          hint={delayStartupHint}
          className={autostartDisabled ? 'sb-row--disabled' : ''}
        >
          <Toggle
            checked={autostartDisabled ? false : Boolean(settings.delayStartup)}
            onChange={(e) => {
              if (!autostartDisabled) saveSettingsPatch({ delayStartup: e.target.checked })
            }}
            disabled={autostartDisabled}
            ariaLabel="Delay startup"
          />
        </Row>

        <Row
          icon={Laptop}
          label="Show tray icon"
          hint="Hotkeys still work when the tray icon is hidden"
        >
          <Toggle
            checked={settings.showTrayIcon !== false}
            onChange={(e) => saveSettingsPatch({ showTrayIcon: e.target.checked })}
            ariaLabel="Show tray icon"
          />
        </Row>
      </Card>

      <Card
        title="Experimental & Developer"
        subtitle="Advanced settings for development and customization."
        icon={Code}
      >
        <Row
          icon={Code}
          label="Developer mode"
          hint="Detailed logs in the terminal and DevTools console"
        >
          <Toggle
            checked={Boolean(settings.developerMode)}
            onChange={(e) => saveSettingsPatch({ developerMode: e.target.checked })}
            ariaLabel="Developer mode"
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

      <Card
        title="Reset"
        subtitle="Restore all settings to default values."
        icon={AlertTriangle}
      >
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
    </MasonryGrid>
  )
}
