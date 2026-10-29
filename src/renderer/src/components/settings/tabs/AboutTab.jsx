import React, { useState, useEffect } from 'react'
import { Card, Row, Button } from '../ui'
import {
  Cat,
  RefreshCw,
  ExternalLink,
  Info,
  Shield,
  Star,
  MessageSquare,
  Sparkles,
  Heart,
  Loader2,
} from 'lucide-react'

export default function AboutTab({ updateState, onCheckUpdates }) {
  const [appInfo, setAppInfo] = useState(null)

  useEffect(() => {
    if (window.api?.getAppInfo) {
      window.api.getAppInfo().then(setAppInfo)
    } else if (window.api?.getVersion) {
      window.api.getVersion().then((ver) => setAppInfo({ version: ver }))
    }
  }, [])

  const openUrl = (url) => {
    if (window.api?.openExternal) {
      window.api.openExternal(url)
    }
  }

  const version = appInfo?.version || ''

  return (
    <>
      <Card className="sb-about-hero-card">
        <div className="sb-about-hero">
          <div className="sb-about-avatar" aria-hidden="true">
            <Cat size={32} className="sb-about-avatar__icon" />
          </div>
          <div className="sb-about-hero__info">
            <div className="sb-about-title-row">
              <h2 className="sb-about-title">Screen Buddy</h2>
              {version && <span className="sb-version-badge">v{version}</span>}
            </div>
            <p className="sb-about-desc">
              A cute desktop companion that keeps you company and helps you take care of yourself while you work.
            </p>
          </div>
        </div>

        <div className="sb-about-actions">
          <Button
            variant="primary"
            onClick={() => onCheckUpdates && onCheckUpdates(false)}
            disabled={updateState?.status === 'checking'}
          >
            {updateState?.status === 'checking' ? (
              <>
                <Loader2 size={14} className="sb-spinner" />
                <span>Checking…</span>
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                <span>Check for Updates</span>
              </>
            )}
          </Button>

          <Button
            variant="secondary"
            onClick={() => openUrl('https://github.com/THE-Nullb0rn/Screen-Buddy/releases')}
          >
            <ExternalLink size={14} />
            <span>View Changelog</span>
          </Button>

          <Button
            variant="secondary"
            onClick={() => openUrl('https://github.com/THE-Nullb0rn/Screen-Buddy')}
          >
            <ExternalLink size={14} />
            <span>Visit GitHub</span>
          </Button>
        </div>

        {/* Update status results */}
        {updateState && updateState.status !== 'checking' && (
          <div className="sb-update-status-wrap">
            {updateState.status === 'up-to-date' && (
              <div className="sb-update-banner sb-update-banner--ok">
                <span>You&apos;re on the latest version{version ? ` (v${version})` : ''}</span>
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
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => onCheckUpdates && onCheckUpdates(false)}
                >
                  Try again
                </Button>
              </div>
            )}

            {updateState.status === 'available' && (
              <div className="sb-new-version-card">
                <div className="sb-new-version-card__header">
                  <Sparkles size={16} className="sb-icon--accent" />
                  <span className="sb-new-version-card__title">
                    New version v{updateState.latestVersion} is out!
                  </span>
                </div>
                {updateState.notes && (
                  <pre className="sb-new-version-notes">{updateState.notes}</pre>
                )}
                <div className="sb-new-version-card__action">
                  <Button
                    variant="primary"
                    size="small"
                    onClick={() =>
                      openUrl(
                        updateState.htmlUrl ||
                          'https://github.com/THE-Nullb0rn/Screen-Buddy/releases'
                      )
                    }
                  >
                    <ExternalLink size={13} />
                    <span>Open on GitHub</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        title="App information"
        subtitle="General information about Screen Buddy."
        icon={Info}
      >
        <Row label="Version" hint="Current release build">
          <span className="sb-info-value">{version ? `v${version}` : '—'}</span>
        </Row>
        <Row label="Electron" hint="Desktop runtime">
          <span className="sb-info-value">{appInfo?.electron ? `v${appInfo.electron}` : '—'}</span>
        </Row>
        <Row label="Chromium" hint="Browser rendering engine">
          <span className="sb-info-value">{appInfo?.chrome ? `v${appInfo.chrome}` : '—'}</span>
        </Row>
        <Row label="Node.js" hint="JavaScript backend runtime">
          <span className="sb-info-value">{appInfo?.node ? `v${appInfo.node}` : '—'}</span>
        </Row>
        <Row label="Platform" hint="Operating system and CPU architecture">
          <span className="sb-info-value">
            {appInfo ? `${appInfo.platform} ${appInfo.arch}` : 'Linux'}
          </span>
        </Row>
        <Row label="Data directory" hint="Settings and state storage path">
          <code className="sb-info-path">{appInfo?.dataDir || '~/.config/screen-buddy'}</code>
        </Row>
      </Card>

      <Card
        title="Credits"
        subtitle="Special thanks to the amazing tools and people."
        icon={Heart}
      >
        <Row label="Electron" hint="Cross-platform desktop application framework">
          <Button variant="secondary" size="small" onClick={() => openUrl('https://www.electronjs.org')}>
            <ExternalLink size={13} />
            <span>electronjs.org</span>
          </Button>
        </Row>
        <Row label="React" hint="UI component library">
          <Button variant="secondary" size="small" onClick={() => openUrl('https://react.dev')}>
            <ExternalLink size={13} />
            <span>react.dev</span>
          </Button>
        </Row>
        <Row label="Pixelpaws" hint="Sprite artwork by jordansbc (MIT)">
          <Button variant="secondary" size="small" onClick={() => openUrl('https://github.com/jordansbc/pixelpaws')}>
            <ExternalLink size={13} />
            <span>GitHub</span>
          </Button>
        </Row>
        <Row label="Inter font" hint="Carefully crafted typeface for computer screens by Rasmus Andersson">
          <Button variant="secondary" size="small" onClick={() => openUrl('https://rsms.me/inter')}>
            <ExternalLink size={13} />
            <span>rsms.me</span>
          </Button>
        </Row>
        <Row label="Lucide icons" hint="Community-crafted open source icon library">
          <Button variant="secondary" size="small" onClick={() => openUrl('https://lucide.dev')}>
            <ExternalLink size={13} />
            <span>lucide.dev</span>
          </Button>
        </Row>
      </Card>

      {/* License Card: Only shown if a LICENSE file exists in the repo root */}
      {appInfo?.license && (
        <Card
          title="License"
          subtitle="Screen Buddy is open source and free to use."
          icon={Shield}
        >
          <Row label={appInfo.license} hint="Open source license terms">
            <Button
              variant="secondary"
              size="small"
              onClick={() => openUrl('https://github.com/THE-Nullb0rn/Screen-Buddy')}
            >
              <ExternalLink size={13} />
              <span>View Source Code</span>
            </Button>
          </Row>
        </Card>
      )}

      <Card
        title="Support the project"
        subtitle="If you like Screen Buddy, consider supporting the development!"
        icon={Star}
      >
        <Row label="Star on GitHub" hint="Show some love and help others discover Screen Buddy">
          <Button
            variant="secondary"
            size="small"
            onClick={() => openUrl('https://github.com/THE-Nullb0rn/Screen-Buddy')}
          >
            <Star size={13} />
            <span>Give a Star</span>
          </Button>
        </Row>
        <Row label="Feedback & Issues" hint="Report bugs or request new features">
          <Button
            variant="secondary"
            size="small"
            onClick={() => openUrl('https://github.com/THE-Nullb0rn/Screen-Buddy/issues')}
          >
            <MessageSquare size={13} />
            <span>Feedback</span>
          </Button>
        </Row>
      </Card>
    </>
  )
}
