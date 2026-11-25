import React, { useState, useEffect } from 'react'
import SettingsModal from './components/settings/SettingsModal'
import './styles/theme.css'

export default function SettingsApp() {
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    const off = window.api.on('settings:updated', setSettings)
    return off
  }, [])

  const handleClose = () => {
    window.close()
  }

  if (!settings) return null

  return (
    <div style={{ width: '100vw', height: '100vh', maxHeight: '100vh', overflow: 'clip' }}>
      <SettingsModal
        settings={settings}
        onClose={handleClose}
      />
    </div>
  )
}
