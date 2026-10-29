import React, { useState, useEffect } from 'react'
import { Card, Button } from '../ui'
import { FileCode, FolderOpen, AlertTriangle, RotateCcw, Copy, Check } from 'lucide-react'

export default function AdvancedTab({ onResetSettings }) {
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

  return (
    <>
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
