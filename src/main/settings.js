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

  /** Write ~/.config/autostart/screen-buddy.desktop on login */
  autostart: false,

  /** Which reminder types are enabled */
  reminders: {
    water: true,
    eyeRest: true,
    movementBreak: true,
  },
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

module.exports = { loadSettings, saveSettings, getSettingsPath }
