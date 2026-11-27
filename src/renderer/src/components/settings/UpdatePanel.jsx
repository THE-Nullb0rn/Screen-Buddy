import React, { useState } from 'react'
import { Button } from './ui'
import {
  Sparkles,
  Loader2,
  ExternalLink,
  Download,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react'

const RELEASES_URL = 'https://github.com/THE-Nullb0rn/Screen-Buddy/releases'

export function formatLastChecked(ts) {
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

    if (isToday) return `Today, ${timeStr}`
    if (isYesterday) return `Yesterday, ${timeStr}`

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

function formatDownloadSpeed(bytesPerSecond) {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  }
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}

export default function UpdatePanel({
  updateState,
  currentVersion = '',
  lastUpdateCheck = null,
  compact = false,
  onRetry,
  onDownload,
  onInstall,
  onOpenExternal,
}) {
  const [copiedPath, setCopiedPath] = useState(false)

  if (!updateState) return null

  const status = updateState.status || 'idle'
  const versionLabel = updateState.version || updateState.latestVersion || ''
  const appVer = currentVersion || updateState.currentVersion || ''
  const lastTs = updateState.lastCheckedAt || lastUpdateCheck
  const releaseUrl = updateState.htmlUrl || RELEASES_URL

  const copyPath = async (text) => {
    let success = false
    try {
      if (window.api && typeof window.api.copyText === 'function') {
        const res = await window.api.copyText(text)
        success = Boolean(res && res.ok)
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        success = true
      }
    } catch (_) {
      success = false
    }
    if (!success) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        success = true
      } catch (_) {
        success = false
      }
    }
    if (success) {
      setCopiedPath(true)
      setTimeout(() => setCopiedPath(false), 1500)
    }
  }

  const openUrl = (url) => {
    if (onOpenExternal) {
      onOpenExternal(url)
    } else if (window.api?.openExternal) {
      window.api.openExternal(url)
    }
  }

  return (
    <div className={`sb-update-status-wrap ${compact ? 'sb-update-status-wrap--compact' : ''}`}>
      {status === 'idle' && (
        <div className="sb-update-banner sb-update-banner--muted">
          <span>
            {lastTs
              ? `Last checked: ${formatLastChecked(lastTs)}`
              : 'Ready to check for updates.'}
          </span>
        </div>
      )}

      {status === 'checking' && (
        <div className="sb-update-banner sb-update-banner--muted">
          <span className="sb-update-banner__inline">
            <Loader2 size={14} className="sb-spinner" />
            <span>Checking for updates…</span>
          </span>
        </div>
      )}

      {status === 'up-to-date' && (
        <div className="sb-update-banner sb-update-banner--ok">
          <span>You&apos;re on the latest version{appVer ? ` (v${appVer})` : ''}</span>
          {!compact && lastTs && (
            <span className="sb-update-banner__meta">Checked {formatLastChecked(lastTs)}</span>
          )}
        </div>
      )}

      {status === 'no-releases' && (
        <div className="sb-update-banner sb-update-banner--muted">
          <span>No releases published yet</span>
          {!compact && lastTs && (
            <span className="sb-update-banner__meta">Checked {formatLastChecked(lastTs)}</span>
          )}
        </div>
      )}

      {status === 'dev' && (
        <div className="sb-update-banner sb-update-banner--muted">
          <span>
            Dev build{appVer ? ` (v${appVer})` : ''} — automatic updates apply to packaged releases
          </span>
          {!compact && lastTs && (
            <span className="sb-update-banner__meta">Checked {formatLastChecked(lastTs)}</span>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="sb-update-banner sb-update-banner--danger">
          <span className="sb-update-banner__inline">
            <AlertCircle size={14} />
            <span>{updateState.reason || updateState.error || 'Failed to check updates.'}</span>
          </span>
          {onRetry && (
            <Button variant="secondary" size="small" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}

      {status === 'available' && (
        <div className="sb-new-version-card">
          <div className="sb-new-version-card__header">
            <Sparkles size={16} className="sb-icon--accent" />
            <span className="sb-new-version-card__title">
              Update v{versionLabel} available
            </span>
            {updateState.devBuild && (
              <span className="sb-update-pill sb-update-pill--muted">Dev build</span>
            )}
          </div>

          {!compact && updateState.notes && (
            <pre className="sb-new-version-notes">{updateState.notes}</pre>
          )}

          {!updateState.canSelfUpdate && updateState.reason && (
            <p className="sb-update-note">{updateState.reason}</p>
          )}

          <div className="sb-new-version-card__action">
            {updateState.canSelfUpdate ? (
              <>
                <Button variant="primary" size="small" onClick={onDownload}>
                  <Download size={13} />
                  <span>Download update</span>
                </Button>
                <Button variant="secondary" size="small" onClick={() => openUrl(releaseUrl)}>
                  <ExternalLink size={13} />
                  <span>View changelog</span>
                </Button>
              </>
            ) : (
              <Button variant="primary" size="small" onClick={() => openUrl(releaseUrl)}>
                <ExternalLink size={13} />
                <span>View release</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {status === 'downloading' && (
        <div className="sb-new-version-card">
          <div className="sb-new-version-card__header">
            <Loader2 size={15} className="sb-spinner sb-icon--accent" />
            <span className="sb-new-version-card__title">
              Downloading v{versionLabel || 'update'}…
            </span>
          </div>
          <div className="sb-update-progress-track" role="progressbar" aria-valuenow={Math.round(updateState.percent || 0)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="sb-update-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, Number(updateState.percent) || 0))}%` }}
            />
          </div>
          <div className="sb-update-progress-meta">
            <span>{Math.round(Number(updateState.percent) || 0)}%</span>
            <span>{formatDownloadSpeed(updateState.bytesPerSecond)}</span>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div className="sb-new-version-card sb-new-version-card--ready">
          <div className="sb-new-version-card__header">
            <CheckCircle2 size={16} className="sb-icon--ok" />
            <span className="sb-new-version-card__title sb-new-version-card__title--ok">
              Update v{versionLabel} ready to install
            </span>
          </div>
          <p className="sb-update-note">
            Downloaded and ready. Restart Screen Buddy to apply the update.
          </p>
          <div className="sb-new-version-card__action">
            <Button variant="primary" size="small" onClick={onInstall}>
              <RotateCw size={13} />
              <span>Restart to update</span>
            </Button>
            <Button variant="secondary" size="small" onClick={() => openUrl(releaseUrl)}>
              <ExternalLink size={13} />
              <span>View changelog</span>
            </Button>
          </div>
          {updateState.restartHint?.kind === 'appimage' && updateState.restartHint.path && (
            <div className="sb-update-restart-hint" style={{ marginTop: '12px' }}>
              <p className="sb-update-note" style={{ marginBottom: '8px' }}>
                If Screen Buddy doesn&apos;t reopen by itself, start it again from your app launcher or run:
              </p>
              <div className="sb-code-box">
                <code className="sb-code-box__text">{updateState.restartHint.path}</code>
                <div className="sb-code-box__actions">
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => copyPath(updateState.restartHint.path)}
                    aria-label="Copy AppImage path"
                  >
                    {copiedPath ? (
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
                </div>
              </div>
            </div>
          )}
          {updateState.restartHint?.kind === 'start-menu' && (
            <div className="sb-update-restart-hint" style={{ marginTop: '12px' }}>
              <p className="sb-update-note">
                If Screen Buddy doesn&apos;t reopen by itself, start it again from the Start menu.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
