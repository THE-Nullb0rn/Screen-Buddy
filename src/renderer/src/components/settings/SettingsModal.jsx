import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Settings,
  Palette,
  Cat,
  Bell,
  MessageCircle,
  Sparkles,
  Keyboard,
  SlidersHorizontal,
  Info,
  X,
  Check,
} from 'lucide-react'

import bannerImg from '../../assets/settings/banner.webp'
import sidebarCatImg from '../../assets/settings/sidebar-cat.webp'

import GeneralTab from './tabs/GeneralTab'
import AppearanceTab from './tabs/AppearanceTab'
import BehaviorTab from './tabs/BehaviorTab'
import RemindersTab from './tabs/RemindersTab'
import NotificationsTab from './tabs/NotificationsTab'
import ChatTab from './tabs/ChatTab'
import ShortcutsTab from './tabs/ShortcutsTab'
import AdvancedTab from './tabs/AdvancedTab'
import AboutTab from './tabs/AboutTab'
import './SettingsModal.css'

export const SETTINGS_TABS = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    tagline: 'Stay productive together!',
    subtitle: 'Basic settings for Screen Buddy.',
    bannerPosition: 'right center',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    tagline: 'Make Screen Buddy your own!',
    subtitle: 'Customize themes and visual appearance.',
    bannerPosition: '85% center',
  },
  {
    id: 'behavior',
    label: 'Behavior',
    icon: Cat,
    tagline: 'Playful, calm, or focused!',
    subtitle: 'Tune companion habits and personality.',
    bannerPosition: '75% 35%',
  },
  {
    id: 'reminders',
    label: 'Reminders',
    icon: Bell,
    tagline: 'Little reminders for a better you!',
    subtitle: 'Set up reminders and let Screen Buddy help you stay on track.',
    bannerPosition: '80% center',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: MessageCircle,
    tagline: 'Stay informed, stay cozy!',
    subtitle: 'Configure desktop notifications.',
    bannerPosition: '90% 45%',
  },
  {
    id: 'chat',
    label: 'Chat & AI',
    icon: Sparkles,
    tagline: "Chat, learn, ask anything — I'm here!",
    subtitle: 'Configure how Screen Buddy chats and uses AI.',
    bannerPosition: '70% center',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: Keyboard,
    tagline: 'Hotkeys for a faster, cuter workflow!',
    subtitle: 'Keyboard shortcuts to control Screen Buddy.',
    bannerPosition: '85% 40%',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: SlidersHorizontal,
    tagline: 'Advanced settings for more control!',
    subtitle: 'Fine-tune Screen Buddy with advanced settings.',
    bannerPosition: '65% 40%',
  },
  {
    id: 'about',
    label: 'About',
    icon: Info,
    tagline: 'Thanks for having me around!',
    subtitle: 'Learn more about Screen Buddy, check for updates and see the credits.',
    bannerPosition: 'right 60%',
  },
]

export default function SettingsModal({ settings: initialSettings, onClose }) {
  const [settings, setSettings] = useState(initialSettings)
  const [activeTab, setActiveTab] = useState('general')
  const [saveStatus, setSaveStatus] = useState(null) // 'saved' | null
  const [saveError, setSaveError] = useState(null)
  const [updateState, setUpdateState] = useState(null)
  const saveTimerRef = useRef(null)
  const tabButtonRefs = useRef({})

  const visibleTabs = SETTINGS_TABS.filter((t) => !t.hidden)
  const currentTabObj = visibleTabs.find((t) => t.id === activeTab) || visibleTabs[0]

  // Sync external settings updates from main process
  useEffect(() => {
    setSettings(initialSettings)
  }, [initialSettings])

  useEffect(() => {
    if (!window.api?.on) return
    const off = window.api.on('settings:updated', (updated) => {
      setSettings(updated)
    })
    return off
  }, [])

  // Instant apply settings patch
  const saveSettingsPatch = useCallback(
    async (patch) => {
      try {
        setSaveError(null)
        setSettings((prev) => ({
          ...prev,
          ...patch,
          ...(patch.reminders ? { reminders: { ...prev.reminders, ...patch.reminders } } : {}),
        }))

        const updated = await window.api.setSettings(patch)
        setSettings(updated)

        setSaveStatus('saved')
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          setSaveStatus(null)
        }, 1200)
      } catch (err) {
        setSaveError(err.message || 'Failed to save setting')
        try {
          const fresh = await window.api.getSettings()
          setSettings(fresh)
        } catch (_reReadErr) {
          /* ignore re-read error */
        }
      }
    },
    []
  )

  // Auto check for updates on mount if autoCheckUpdates is enabled
  const runUpdateCheck = useCallback(
    async (isSilent = false) => {
      if (!window.api?.updates?.check) return
      if (!isSilent) {
        setUpdateState({ status: 'checking' })
      }
      try {
        const res = await window.api.updates.check()
        setUpdateState(res)
        if (
          res &&
          (res.status === 'up-to-date' ||
            res.status === 'available' ||
            res.status === 'no-releases')
        ) {
          saveSettingsPatch({ lastUpdateCheck: Date.now() })
        }
      } catch (err) {
        if (!isSilent) {
          setUpdateState({ status: 'error', error: err.message || 'Update check failed' })
        }
      }
    },
    [saveSettingsPatch]
  )

  useEffect(() => {
    if (settings?.autoCheckUpdates !== false) {
      runUpdateCheck(true)
    }
  }, [settings?.autoCheckUpdates, runUpdateCheck])

  const handleResetSettings = useCallback(async () => {
    try {
      const fresh = await window.api.resetSettings()
      setSettings(fresh)
      setSaveStatus('saved')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        setSaveStatus(null)
      }, 1200)
    } catch (err) {
      setSaveError(err.message || 'Failed to reset settings')
    }
  }, [])

  // Keyboard navigation: Escape to close, Arrow keys for tabs
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Only navigate tabs if focus is currently within the tab list
        const isTabFocused = Object.values(tabButtonRefs.current).some(
          (ref) => ref === document.activeElement
        )
        if (isTabFocused) {
          e.preventDefault()
          const currentIndex = visibleTabs.findIndex((t) => t.id === activeTab)
          let nextIndex = currentIndex
          if (e.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % visibleTabs.length
          } else {
            nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length
          }
          const nextTab = visibleTabs[nextIndex]
          setActiveTab(nextTab.id)
          tabButtonRefs.current[nextTab.id]?.focus()
        }
      }
    },
    [activeTab, visibleTabs, onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!settings) return null

  const TabIcon = currentTabObj.icon
  const hasUpdateBadge = updateState?.status === 'available'

  return (
    <div className="settings-window">
      {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sb-sidebar">
        {/* Brand row */}
        <div className="sb-sidebar__brand">
          <div className="sb-sidebar__brand-avatar" aria-hidden="true">
            <Cat size={20} className="sb-sidebar__brand-cat" />
          </div>
          <div className="sb-sidebar__brand-text">
            <h1 className="sb-sidebar__title">Screen Buddy</h1>
            <p className="sb-sidebar__subtitle">Your desktop companion</p>
          </div>
        </div>

        {/* Tab navigation list */}
        <nav className="sb-sidebar__nav" role="tablist" aria-label="Settings navigation">
          {visibleTabs.map((tab) => {
            const IconComponent = tab.icon
            const isActive = activeTab === tab.id
            const isAboutTab = tab.id === 'about'
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabButtonRefs.current[tab.id] = el
                }}
                role="tab"
                type="button"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`sb-tab-btn ${isActive ? 'sb-tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <IconComponent size={18} className="sb-tab-btn__icon" aria-hidden="true" />
                <span className="sb-tab-btn__label">{tab.label}</span>
                {isAboutTab && hasUpdateBadge && (
                  <span className="sb-tab-badge" title="Update available" />
                )}
              </button>
            )
          })}
        </nav>

        {/* Bottom Cat Image with Tagline */}
        <div className="sb-sidebar__footer">
          <div className="sb-sidebar__cat-img-wrapper">
            <img
              src={sidebarCatImg}
              alt=""
              aria-hidden="true"
              className="sb-sidebar__cat-img"
            />
            <div className="sb-sidebar__cat-gradient" />
          </div>
          <p className="sb-sidebar__tagline">
            &ldquo;{currentTabObj.tagline}&rdquo;
          </p>
        </div>
      </aside>

      {/* ── Right Content Area ───────────────────────────────────────────── */}
      <div className="sb-main">
        {/* Header Banner */}
        <header className="sb-banner">
          <img
            src={bannerImg}
            alt=""
            aria-hidden="true"
            className="sb-banner__img"
            style={{ objectPosition: currentTabObj.bannerPosition || 'right center' }}
          />
          <div className="sb-banner__gradient" />

          <div className="sb-banner__content">
            <div className="sb-banner__icon-wrap">
              <TabIcon size={36} className="sb-banner__icon" />
            </div>
            <div className="sb-banner__text">
              <h2 className="sb-banner__title">{currentTabObj.label}</h2>
              <p className="sb-banner__subtitle">{currentTabObj.subtitle}</p>
            </div>
          </div>

          <div className="sb-banner__top-actions">
            {saveStatus === 'saved' && (
              <div className="sb-saved-pill">
                <Check size={12} className="sb-saved-pill__check" />
                <span>Saved</span>
              </div>
            )}
            {saveError && (
              <div className="sb-saved-pill sb-saved-pill--error">
                <span>{saveError}</span>
              </div>
            )}
            <button
              type="button"
              className="sb-close-btn"
              onClick={onClose}
              aria-label="Close settings"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Scrollable Tab Content Cards */}
        <main className="sb-content">
          <div className="sb-content__grid">
            {activeTab === 'general' && (
              <GeneralTab settings={settings} saveSettingsPatch={saveSettingsPatch} />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab settings={settings} saveSettingsPatch={saveSettingsPatch} />
            )}
            {activeTab === 'behavior' && (
              <BehaviorTab settings={settings} saveSettingsPatch={saveSettingsPatch} />
            )}
            {activeTab === 'reminders' && (
              <RemindersTab settings={settings} saveSettingsPatch={saveSettingsPatch} />
            )}
            {activeTab === 'notifications' && (
              <NotificationsTab settings={settings} saveSettingsPatch={saveSettingsPatch} />
            )}
            {activeTab === 'chat' && (
              <ChatTab settings={settings} saveSettingsPatch={saveSettingsPatch} />
            )}
            {activeTab === 'shortcuts' && <ShortcutsTab />}
            {activeTab === 'advanced' && (
              <AdvancedTab
                settings={settings}
                saveSettingsPatch={saveSettingsPatch}
                onResetSettings={handleResetSettings}
                updateState={updateState}
                onCheckUpdates={runUpdateCheck}
              />
            )}
            {activeTab === 'about' && (
              <AboutTab updateState={updateState} onCheckUpdates={runUpdateCheck} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
