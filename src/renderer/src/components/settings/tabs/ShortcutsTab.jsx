import React, { useState } from 'react'
import { Card, Row, Kbd, Button } from '../ui'
import { Keyboard, Pause, MessageSquare, Settings, Copy, Check, Terminal } from 'lucide-react'

export default function ShortcutsTab() {
  const [copiedId, setCopiedId] = useState(null)
  const isLinux = window.api?.platform === 'linux'

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

  const superKeyName = isLinux ? 'Super' : 'Win'

  return (
    <>
      <Card title="Shortcuts" icon={Keyboard}>
        <Row
          icon={Pause}
          label="Toggle pause"
          hint="Temporarily pause or resume reminder timers"
        >
          <div className="sb-keycap-group">
            <Kbd>Ctrl</Kbd>
            <span className="sb-keycap-plus">+</span>
            <Kbd>Alt</Kbd>
            <span className="sb-keycap-plus">+</span>
            <Kbd>P</Kbd>
          </div>
        </Row>
        <Row
          icon={MessageSquare}
          label="Open AI chat"
          hint="Quickly summon companion prompt"
        >
          <div className="sb-keycap-group">
            <Kbd>Ctrl</Kbd>
            <span className="sb-keycap-plus">+</span>
            <Kbd>{superKeyName}</Kbd>
            <span className="sb-keycap-plus">+</span>
            <Kbd>C</Kbd>
          </div>
        </Row>
        <Row
          icon={Settings}
          label="Open settings"
          hint="Open this configuration window"
        >
          <div className="sb-keycap-group">
            <Kbd>{superKeyName}</Kbd>
            <span className="sb-keycap-plus">+</span>
            <Kbd>Shift</Kbd>
            <span className="sb-keycap-plus">+</span>
            <Kbd>S</Kbd>
          </div>
        </Row>
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
