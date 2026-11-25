import React, { useState, useEffect } from 'react'
import { Card, Row, Kbd, Button } from '../ui'
import { Keyboard, Pause, MessageSquare, Settings, Copy, Check, Terminal, Bell } from 'lucide-react'

function splitAccelerator(accel, isLinux) {
  if (typeof accel !== 'string' || !accel.trim()) return []
  return accel
    .split('+')
    .map((part) => {
      const p = part.trim()
      if (/^control$/i.test(p)) return 'Ctrl'
      if (/^(super|meta)$/i.test(p)) return isLinux ? 'Super' : 'Win'
      return p
    })
    .filter(Boolean)
}

export default function ShortcutsTab({ settings }) {
  const [copiedId, setCopiedId] = useState(null)
  const [shortcutStatus, setShortcutStatus] = useState({})
  const platform = window.api?.platform || 'linux'
  const isLinux = platform === 'linux'
  const isWin32 = platform === 'win32'

  useEffect(() => {
    if (!isWin32) return
    window.api?.getShortcutStatus?.().then((s) => {
      if (s && typeof s === 'object') setShortcutStatus(s)
    }).catch(() => {})
    const off = window.api?.on?.('shortcuts:status-updated', (s) => {
      if (s && typeof s === 'object') setShortcutStatus(s)
    })
    return off
  }, [isWin32])

  const copyToClipboard = async (text, id) => {
    if (window.api?.copyText) {
      await window.api.copyText(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    setCopiedId(id)
    setTimeout(() => {
      setCopiedId(null)
    }, 1200)
  }

  const hyprlandBinds = [
    {
      id: 'call',
      label: 'Call cat',
      code: 'bind = CTRL ALT, C, exec, touch "$XDG_RUNTIME_DIR/screen-buddy-call"',
    },
    {
      id: 'settings',
      label: 'Open settings',
      code: 'bind = SUPER SHIFT, S, exec, touch "$XDG_RUNTIME_DIR/screen-buddy-settings"',
    },
    {
      id: 'pause',
      label: 'Toggle pause',
      code: 'bind = CTRL ALT, P, exec, sh -c \'date +%s%N > "$XDG_RUNTIME_DIR/screen-buddy-toggle"\'',
    },
    {
      id: 'chat',
      label: 'Open AI chat',
      code: 'bind = CTRL SUPER, C, exec, touch "$XDG_RUNTIME_DIR/screen-buddy-chat"',
    },
  ]

  const shortcutItems = [
    {
      settingKey: 'shortcutCallCat',
      icon: Bell,
      label: 'Call cat',
      hint: 'Call the cat to walk to your cursor',
      accel: settings?.shortcutCallCat || 'Ctrl+Alt+C',
    },
    {
      settingKey: 'shortcutTogglePause',
      icon: Pause,
      label: 'Toggle pause',
      hint: 'Temporarily pause or resume reminder timers',
      accel: settings?.shortcutTogglePause || 'Ctrl+Alt+P',
    },
    {
      settingKey: 'shortcutChat',
      icon: MessageSquare,
      label: 'Open AI chat',
      hint: 'Quickly summon companion prompt',
      accel: settings?.shortcutChat || (isWin32 ? 'Ctrl+Alt+Shift+C' : 'Ctrl+Super+C'),
    },
    {
      settingKey: 'shortcutSettings',
      icon: Settings,
      label: 'Open settings',
      hint: 'Open this configuration window',
      accel: settings?.shortcutSettings || (isWin32 ? 'Ctrl+Alt+Shift+S' : 'Super+Shift+S'),
    },
  ]

  return (
    <>
      <Card
        title="Shortcuts"
        subtitle="Main shortcuts to control Screen Buddy."
        icon={Keyboard}
      >
        {shortcutItems.map((item) => {
          const keys = splitAccelerator(item.accel, isLinux)
          const reg = shortcutStatus?.[item.settingKey]
          const failed = isWin32 && reg && reg.registered === false
          return (
            <Row
              key={item.settingKey}
              icon={item.icon}
              label={item.label}
              hint={item.hint}
            >
              <div className="sb-shortcut-control">
                <div className="sb-keycap-group">
                  {keys.map((k, idx) => (
                    <React.Fragment key={`${item.settingKey}-${k}-${idx}`}>
                      {idx > 0 && <span className="sb-keycap-plus">+</span>}
                      <Kbd>{k}</Kbd>
                    </React.Fragment>
                  ))}
                </div>
                {failed && (
                  <span className="sb-status-pill sb-status-pill--danger">
                    {reg.error || 'In use by another app'}
                  </span>
                )}
              </div>
            </Row>
          )
        })}
      </Card>

      {isLinux && (
        <Card title="Hyprland binds" icon={Terminal}>
          <p className="sb-card-desc">
            Add these exact binds to your <code>hyprland.conf</code> to trigger Screen Buddy shortcuts:
          </p>

          <div className="sb-binds-list">
            {hyprlandBinds.map((bind) => (
              <div key={bind.id} className="sb-bind-item">
                <span className="sb-bind-item__label">{bind.label}</span>
                <div className="sb-code-box">
                  <code className="sb-code-box__text">{bind.code}</code>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => copyToClipboard(bind.code, bind.id)}
                    aria-label={`Copy ${bind.label} bind`}
                  >
                    {copiedId === bind.id ? (
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
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
