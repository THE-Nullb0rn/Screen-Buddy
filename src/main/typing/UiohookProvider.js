'use strict'

const TypingProvider = require('./TypingProvider')

// Keycodes matching DevInputProvider.js genuine-typing whitelist (translated to UiohookKey values).
// Note: NumpadDivide (3637) and NumpadEnter (3612) use libuiohook extended scan codes on Windows.
const ALLOWED_KEYCODES = new Set([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, // 1-0
  12, 13, 14, // - = Backspace
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, // q-p
  26, 27, 28, // [ ] Enter
  30, 31, 32, 33, 34, 35, 36, 37, 38, // a-l
  39, 40, 41, // ; ' `
  43, // \
  44, 45, 46, 47, 48, 49, 50, // z-m
  51, 52, 53, // , . /
  57, // Space
  3612, 3637, 55, 74, 78, // Numpad Enter, /, *, -, +
])

// Numpad digit/decimal scan codes emitted by uiohook only when NumLock is active on Windows
// (when NumLock is OFF, uiohook emits navigation codes 60999..61011 which are not in this set).
const NUMPAD_CODES = new Set([
  71, 72, 73, 75, 76, 77, 79, 80, 81, 82, 83,
])

const MODIFIER_KEYCODES = new Set([
  29, 3613, // Ctrl, CtrlRight
  56, 3640, // Alt, AltRight
  3675, 3676, // Meta, MetaRight (Win)
  42, 54, // Shift, ShiftRight
])

class UiohookProvider extends TypingProvider {
  constructor() {
    super()
    this._uiohook = null
    this._keydownHandler = null
    this._started = false
    this._ctrlHeld = false
    this._altHeld = false
    this._metaHeld = false
    this._loadError = null
  }

  get id() { return 'uiohook' }
  get name() { return 'Global Keyboard Hook (uiohook)' }

  _loadModule() {
    if (this._uiohook) return this._uiohook
    if (process.platform !== 'win32') return null
    try {
      // Lazy-loaded on win32 only so Linux never touches uiohook-napi.
      this._uiohook = require('uiohook-napi')
      this._loadError = null
      return this._uiohook
    } catch (err) {
      this._loadError = err
      return null
    }
  }

  checkAvailability() {
    if (process.platform !== 'win32') {
      return { available: false, reason: 'Windows only' }
    }
    const mod = this._loadModule()
    if (!mod || !mod.uIOhook) {
      return {
        available: false,
        reason: this._loadError ? `uiohook-napi unavailable (${this._loadError.message})` : 'uiohook-napi unavailable',
      }
    }
    return { available: true }
  }

  async isSupported() {
    return process.platform === 'win32'
  }

  async hasPermission() {
    return true
  }

  async requestPermission() {
    return { status: 'granted', instructions: '' }
  }

  async start(onActivity) {
    if (process.platform !== 'win32') {
      throw new Error('UiohookProvider is only supported on win32')
    }

    const mod = this._loadModule()
    if (!mod || !mod.uIOhook) {
      throw this._loadError || new Error('Failed to load uiohook-napi')
    }

    await this.stop()

    const { uIOhook } = mod
    this._ctrlHeld = false
    this._altHeld = false
    this._metaHeld = false

    // PRIVACY: Never store, log, or send key codes or characters anywhere;
    // only check transient allowlist/modifier state in memory and emit activity timestamps.
    this._keydownHandler = (e) => {
      if (!e || typeof e.keycode !== 'number') return
      const code = e.keycode

      if (MODIFIER_KEYCODES.has(code)) {
        return
      }

      const ctrl = Boolean(e.ctrlKey)
      const alt = Boolean(e.altKey)
      const meta = Boolean(e.metaKey)
      if (ctrl || alt || meta) {
        return
      }

      if (ALLOWED_KEYCODES.has(code) || NUMPAD_CODES.has(code)) {
        onActivity({ isActive: true })
      }
    }

    uIOhook.on('keydown', this._keydownHandler)
    try {
      uIOhook.start()
      this._started = true
    } catch (err) {
      uIOhook.removeListener('keydown', this._keydownHandler)
      this._keydownHandler = null
      this._started = false
      throw err
    }
  }

  async stop() {
    const uIOhook = this._uiohook?.uIOhook
    if (uIOhook && this._keydownHandler) {
      try {
        uIOhook.removeListener('keydown', this._keydownHandler)
      } catch (_) {
        /* ignore listener cleanup errors */
      }
    }
    this._keydownHandler = null

    if (uIOhook && this._started) {
      try {
        uIOhook.stop()
      } catch (_) {
        /* ignore stop errors */
      }
    }
    this._started = false
    this._ctrlHeld = false
    this._altHeld = false
    this._metaHeld = false
  }
}

module.exports = UiohookProvider
