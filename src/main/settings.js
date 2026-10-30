/**
 * screen-buddy — Settings persistence module
 *
 * Stores settings as JSON in the Linux XDG config directory:
 *   ~/.config/screen-buddy/settings.json
 *
 * Deliberately avoids Electron's app.getPath('userData') which can vary,
 * in favour of the canonical XDG_CONFIG_HOME path expected on Fedora/Arch/etc.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// ─── XDG config path ─────────────────────────────────────────────────────────
// Honour XDG_CONFIG_HOME if set, fall back to ~/.config
const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')

const SETTINGS_DIR = path.join(XDG_CONFIG_HOME, 'screen-buddy')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

// ─── Defaults ────────────────────────────────────────────────────────────────
/**
 * Default settings object.
 * These are merged with any saved values so new keys are always present.
 */
const DEFAULT_SETTINGS = {
  /** How often reminders fire, in minutes */
  intervalMinutes: 20,

  /** Whether reminders are globally paused */
  paused: false,

  /** Last settled top-left position of the 350×350 mascot window. */
  mascotPosition: {
    x: 0,
    y: 0,
  },

  /** Write ~/.config/autostart/screen-buddy.desktop on login */
  autostart: false,

  /** Which reminder types are enabled */
  reminders: {
    water: true,
    eyeRest: true,
    movementBreak: true,
  },

  /** Master toggle for reminders */
  remindersEnabled: true,

  /** Reminder notifications, sounds, and animations */
  reminderNotifications: true,
  reminderSound: true,
  reminderCatAnimation: true,

  /** Reminder advanced options */
  reminderSnoozeDuration: 5,
  reminderAutoSnoozeLimit: 3,
  reminderShowMissed: true,
  reminderGroupSimilar: true,

  /** Whether screen-buddy should act as the desktop notification daemon */
  notificationsEnabled: true,

  /** Notification daemon mode: 'system' (default) or 'cat' (desktop notification daemon) */
  notificationMode: 'system',

  /** List of app names (case-insensitive) to block from showing notifications */
  notificationAppBlocklist: [],

  /** Gemini model to use for the AI chat */
  geminiModel: 'gemini-3.5-flash-lite',

  /** Global typing activity detection */
  systemTypingDetection: false,

  /** Check for updates when Settings opens */
  autoCheckUpdates: true,

  // ── Appearance ──
  catStyle: 'black-cat',
  catSize: 100,
  catOpacity: 100,
  catAnimationSpeed: 'normal',

  // ── Behavior ──
  mouseReaction: false,
  appFocusReaction: false,
  mediaReaction: false,
  clickToInteract: true,
  dragBehavior: true,
  doubleClickAction: 'chat',
  rightDoubleClickAction: 'settings',
  pettingEffects: true,
  hungerEnabled: false,
  hungerRate: 'normal',
  hungerNotify: true,
  hungerBehavior: 'search-food',
  hungerPauseSleeping: true,
  moodEnabled: false,
  moodIndicator: false,

  // ── Notifications ──
  notificationAnimations: true,
  notificationSounds: false,
  notificationAutoHide: true,
  notificationDuration: 5,
  notificationCardReminders: true,
  notificationCardChat: true,
  notificationCardHunger: true,
  notificationCardMusic: true,
  notificationCardUpdates: true,

  // ── Advanced ──
  animationFps: 60,
  reduceResourceUsage: false,
  pauseAnimationIdle: false,
  limitBackgroundCpu: false,
  startMinimized: false,
  delayStartup: false,
  minimizeToTray: true,
  showTrayIcon: true,
  experimentalFeatures: false,
  developerMode: false,
  allowCustomCss: false,
  lastUpdateCheck: null,
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load settings from disk, merging with defaults.
 * Creates the settings file with defaults if it doesn't exist.
 *
 * @returns {object} Resolved settings object
 */
function loadSettings() {
  try {
    // Ensure the config directory exists
    fs.mkdirSync(SETTINGS_DIR, { recursive: true })

    if (!fs.existsSync(SETTINGS_FILE)) {
      // First run: write defaults to disk
      saveSettings(DEFAULT_SETTINGS)
      console.log('[settings] Created default settings at', SETTINGS_FILE)
      return { ...DEFAULT_SETTINGS }
    }

    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    const saved = JSON.parse(raw)

    let needsSave = false

    // Migration for existing installs: if notificationMode key is not present, set to 'cat' and persist
    if (saved && typeof saved === 'object' && !('notificationMode' in saved)) {
      saved.notificationMode = 'cat'
      needsSave = true
    }

    // Backwards compatibility migration: merge old 'posture' and 'stretch' into 'movementBreak'
    if (saved.reminders) {
      if (saved.reminders.movementBreak === undefined) {
        const hadPostureOrStretch =
          saved.reminders.stretch === true || saved.reminders.posture === true
        saved.reminders.movementBreak =
          hadPostureOrStretch ||
          (saved.reminders.stretch === undefined && saved.reminders.posture === undefined)
      }
      delete saved.reminders.posture
      delete saved.reminders.stretch
    }

    // Deep merge: saved values override defaults, but new default keys are added
    const merged = deepMerge(DEFAULT_SETTINGS, saved)
    if (needsSave) {
      saveSettings(merged)
      console.log('[settings] Migrated existing install: notificationMode set to "cat"')
    }
    console.log('[settings] Loaded from', SETTINGS_FILE)
    return merged
  } catch (err) {
    console.error('[settings] Failed to load settings, using defaults:', err)
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Persist the given settings object to disk.
 *
 * @param {object} settings — The full settings object to write
 */
function saveSettings(settings) {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    console.error('[settings] Failed to save settings:', err)
  }
}

/**
 * Return the absolute path to the settings file (for display in the UI).
 *
 * @returns {string}
 */
function getSettingsPath() {
  return SETTINGS_FILE
}

function debugLog(key, reason) {
  if (process.env.SCREEN_BUDDY_DEBUG === '1') {
    console.debug(`[settings] Dropping invalid setting for "${key}": ${reason}`)
  }
}

/**
 * Validate and sanitize a settings update patch.
 * Keys not in the defined validation list pass through unchanged.
 * Drops invalid values silently (debug-log only when SCREEN_BUDDY_DEBUG=1).
 * Never throws and never logs the value of geminiApiKey.
 *
 * @param {object} patch
 * @returns {object} Sanitized copy of patch
 */
function validateSettingsUpdate(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return {}
  }

  const sanitized = {}

  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'intervalMinutes': {
        if (typeof value === 'number' && Number.isFinite(value)) {
          const clamped = Math.min(120, Math.max(1, Math.round(value)))
          sanitized.intervalMinutes = clamped
        } else {
          debugLog('intervalMinutes', 'must be a finite number')
        }
        break
      }

      case 'paused':
      case 'autostart':
      case 'notificationsEnabled':
      case 'systemTypingDetection':
      case 'autoCheckUpdates':
      case 'mouseReaction':
      case 'appFocusReaction':
      case 'mediaReaction':
      case 'clickToInteract':
      case 'dragBehavior':
      case 'pettingEffects':
      case 'hungerEnabled':
      case 'hungerNotify':
      case 'hungerPauseSleeping':
      case 'moodEnabled':
      case 'moodIndicator':
      case 'notificationAnimations':
      case 'notificationSounds':
      case 'notificationAutoHide':
      case 'notificationCardReminders':
      case 'notificationCardChat':
      case 'notificationCardHunger':
      case 'notificationCardMusic':
      case 'notificationCardUpdates':
      case 'remindersEnabled':
      case 'reminderNotifications':
      case 'reminderSound':
      case 'reminderCatAnimation':
      case 'reminderShowMissed':
      case 'reminderGroupSimilar':
      case 'reduceResourceUsage':
      case 'pauseAnimationIdle':
      case 'limitBackgroundCpu':
      case 'startMinimized':
      case 'delayStartup':
      case 'minimizeToTray':
      case 'showTrayIcon':
      case 'experimentalFeatures':
      case 'developerMode':
      case 'allowCustomCss': {
        if (typeof value === 'boolean') {
          sanitized[key] = value
        } else {
          debugLog(key, 'must be a boolean')
        }
        break
      }

      case 'notificationMode': {
        if (value === 'system' || value === 'cat') {
          sanitized.notificationMode = value
        } else {
          debugLog('notificationMode', 'must be "system" or "cat"')
        }
        break
      }

      case 'notificationAppBlocklist': {
        if (Array.isArray(value)) {
          const cleaned = []
          for (const item of value) {
            if (typeof item === 'string') {
              const trimmed = item.trim()
              if (trimmed.length > 0 && trimmed.length <= 100) {
                cleaned.push(trimmed)
                if (cleaned.length === 100) break
              }
            }
          }
          sanitized.notificationAppBlocklist = cleaned
        } else {
          debugLog('notificationAppBlocklist', 'must be an array')
        }
        break
      }

      case 'reminders': {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const cleanedReminders = {}
          for (const rKey of ['water', 'eyeRest', 'movementBreak']) {
            if (typeof value[rKey] === 'boolean') {
              cleanedReminders[rKey] = value[rKey]
            }
          }
          sanitized.reminders = cleanedReminders
        } else {
          debugLog('reminders', 'must be an object')
        }
        break
      }

      case 'geminiModel': {
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (trimmed.length > 0 && trimmed.length <= 100) {
            sanitized.geminiModel = trimmed
          } else {
            debugLog('geminiModel', 'must be non-empty and max 100 chars')
          }
        } else {
          debugLog('geminiModel', 'must be a string')
        }
        break
      }

      case 'geminiApiKey': {
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (trimmed.length <= 300) {
            sanitized.geminiApiKey = trimmed
          } else {
            debugLog('geminiApiKey', 'exceeds max 300 chars')
          }
        } else {
          debugLog('geminiApiKey', 'must be a string')
        }
        break
      }

      case 'catStyle': {
        if (typeof value === 'string' && ['black-cat'].includes(value)) {
          sanitized.catStyle = value
        } else {
          debugLog('catStyle', 'invalid cat style')
        }
        break
      }

      case 'catSize': {
        if (typeof value === 'number' && Number.isFinite(value)) {
          sanitized.catSize = Math.min(150, Math.max(50, Math.round(value)))
        } else {
          debugLog('catSize', 'must be a number between 50 and 150')
        }
        break
      }

      case 'catOpacity': {
        if (typeof value === 'number' && Number.isFinite(value)) {
          sanitized.catOpacity = Math.min(100, Math.max(20, Math.round(value)))
        } else {
          debugLog('catOpacity', 'must be a number between 20 and 100')
        }
        break
      }

      case 'catAnimationSpeed': {
        if (typeof value === 'string' && ['slow', 'normal', 'fast'].includes(value)) {
          sanitized.catAnimationSpeed = value
        } else {
          debugLog('catAnimationSpeed', 'must be slow, normal, or fast')
        }
        break
      }

      case 'doubleClickAction': {
        if (typeof value === 'string' && ['chat', 'settings', 'none'].includes(value)) {
          sanitized.doubleClickAction = value
        } else {
          debugLog('doubleClickAction', 'invalid double click action')
        }
        break
      }

      case 'rightDoubleClickAction': {
        if (typeof value === 'string' && ['chat', 'settings', 'none'].includes(value)) {
          sanitized.rightDoubleClickAction = value
        } else {
          debugLog('rightDoubleClickAction', 'invalid right double click action')
        }
        break
      }

      case 'hungerRate': {
        if (typeof value === 'string' && ['slow', 'normal', 'fast'].includes(value)) {
          sanitized.hungerRate = value
        } else {
          debugLog('hungerRate', 'must be slow, normal, or fast')
        }
        break
      }

      case 'hungerBehavior': {
        if (typeof value === 'string' && ['search-food', 'sad', 'sit'].includes(value)) {
          sanitized.hungerBehavior = value
        } else {
          debugLog('hungerBehavior', 'invalid hunger behavior')
        }
        break
      }

      case 'notificationDuration': {
        if (typeof value === 'number' && Number.isFinite(value)) {
          sanitized.notificationDuration = Math.min(30, Math.max(2, Math.round(value)))
        } else {
          debugLog('notificationDuration', 'must be a number between 2 and 30')
        }
        break
      }

      case 'reminderSnoozeDuration': {
        const num = Number(value)
        if ([5, 10, 15].includes(num)) {
          sanitized.reminderSnoozeDuration = num
        } else {
          debugLog('reminderSnoozeDuration', 'must be 5, 10, or 15')
        }
        break
      }

      case 'reminderAutoSnoozeLimit': {
        const num = Number(value)
        if ([1, 2, 3, 5].includes(num)) {
          sanitized.reminderAutoSnoozeLimit = num
        } else {
          debugLog('reminderAutoSnoozeLimit', 'must be 1, 2, 3, or 5')
        }
        break
      }

      case 'animationFps': {
        if (value === 30 || value === 60) {
          sanitized.animationFps = value
        } else {
          debugLog('animationFps', 'must be 30 or 60')
        }
        break
      }

      case 'lastUpdateCheck': {
        if (value === null || (typeof value === 'number' && Number.isFinite(value))) {
          sanitized.lastUpdateCheck = value
        } else {
          debugLog('lastUpdateCheck', 'must be a timestamp or null')
        }
        break
      }

      case 'mascotPosition': {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof value.x === 'number' &&
          Number.isFinite(value.x) &&
          typeof value.y === 'number' &&
          Number.isFinite(value.y)
        ) {
          sanitized.mascotPosition = { x: value.x, y: value.y }
        } else {
          debugLog('mascotPosition', 'must be an object with finite numeric x and y')
        }
        break
      }

      default: {
        sanitized[key] = value
        break
      }
    }
  }

  return sanitized
}

/**
 * Determine the effective notification mode.
 * Returns 'cat' only on Linux when settings.notificationMode is 'cat';
 * otherwise returns 'system'.
 *
 * @param {object} settings
 * @returns {'system' | 'cat'}
 */
function getEffectiveNotificationMode(settings) {
  if (process.platform === 'linux' && settings && settings.notificationMode === 'cat') {
    return 'cat'
  }
  return 'system'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Shallow-recursive merge: for each key in `defaults`, if `override` has
 * the same key and both values are plain objects, recurse; otherwise use
 * the override value.  New keys from `defaults` not present in `override`
 * are preserved.
 *
 * @param {object} defaults
 * @param {object} override
 * @returns {object}
 */
function deepMerge(defaults, override) {
  const result = { ...defaults }
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key]) &&
      typeof defaults[key] === 'object' &&
      defaults[key] !== null
    ) {
      result[key] = deepMerge(defaults[key], override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

module.exports = {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  getSettingsPath,
  validateSettingsUpdate,
  getEffectiveNotificationMode,
}
