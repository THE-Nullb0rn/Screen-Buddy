/**
 * screen-buddy — Linux autostart module
 *
 * Manages the ~/.config/autostart/screen-buddy.desktop file that tells
 * XDG-compliant desktop environments (GNOME, KDE, Hyprland via wayfire-autostart
 * or similar) to launch screen-buddy on login.
 *
 * Deliberately avoids Electron's app.setLoginItemSettings(), which only works
 * on Windows and macOS.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { app } = require('electron')

// ─── XDG autostart path ──────────────────────────────────────────────────────
const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')

const AUTOSTART_DIR = path.join(XDG_CONFIG_HOME, 'autostart')
const DESKTOP_FILE = path.join(AUTOSTART_DIR, 'screen-buddy.desktop')

/**
 * Escape a string for use inside double quotes in an Exec key per the
 * Desktop Entry Specification.
 * Inside a quoted argument, the characters '"', '`', '$', and '\' must be escaped.
 */
function quoteDesktopArg(arg) {
  const escaped = String(arg).replace(/["`$\\]/g, '\\$&')
  return `"${escaped}"`
}

// ─── .desktop file content ───────────────────────────────────────────────────
/**
 * Generate the .desktop entry content.
 * Exec path is the currently running Electron binary or AppImage file.
 * On a packaged build this is the wrapped app binary or process.env.APPIMAGE;
 * in development it is the raw `electron` binary with the project dir as the first argument.
 */
function buildDesktopEntry() {
  let execPath
  if (process.env.NODE_ENV === 'development') {
    execPath = `${quoteDesktopArg(process.execPath)} ${quoteDesktopArg(path.resolve(__dirname, '..'))} --autostart`
  } else if (process.env.APPIMAGE) {
    execPath = `${quoteDesktopArg(process.env.APPIMAGE)} --autostart`
  } else {
    execPath = `${quoteDesktopArg(process.execPath)} --autostart`
  }

  return `[Desktop Entry]
Type=Application
Name=screen-buddy
Comment=Desktop companion for self-care reminders
Exec=${execPath}
Icon=screen-buddy
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
# Added by screen-buddy autostart setting
`
}

// ─── Public API ──────────────────────────────────────────────────────────────

function getAutostartStatus() {
  if (process.platform === 'win32') {
    if (!app.isPackaged) {
      return {
        available: false,
        devBuild: true,
        enabled: false,
        reason: 'Available in the installed app',
      }
    }
    const info = app.getLoginItemSettings({ args: ['--autostart'] })
    return {
      available: true,
      devBuild: false,
      enabled: Boolean(info?.openAtLogin),
    }
  }
  if (process.platform === 'linux') {
    return {
      available: true,
      enabled: fs.existsSync(DESKTOP_FILE),
    }
  }
  return {
    available: false,
    enabled: false,
    reason: 'Autostart is unsupported on this platform',
  }
}

/**
 * Write the autostart entry / registry login item.
 */
function setAutostart() {
  if (process.platform === 'win32') {
    if (!app.isPackaged) {
      return { success: false, supported: false, devBuild: true, message: 'Autostart is disabled in dev builds' }
    }
    try {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] })
      return { success: true, supported: true }
    } catch (err) {
      console.error('[autostart] Failed to enable Windows login item:', err)
      return { success: false, supported: true, error: err.message }
    }
  }
  if (process.platform !== 'linux') {
    return { success: false, supported: false, message: 'Autostart is unsupported for now on this platform' }
  }
  try {
    const content = buildDesktopEntry()
    if (fs.existsSync(DESKTOP_FILE)) {
      const existing = fs.readFileSync(DESKTOP_FILE, 'utf-8')
      if (existing === content) {
        return { success: true, supported: true }
      }
    }
    fs.mkdirSync(AUTOSTART_DIR, { recursive: true })
    fs.writeFileSync(DESKTOP_FILE, content, 'utf-8')
    console.log('[autostart] .desktop file written to', DESKTOP_FILE)
    return { success: true, supported: true }
  } catch (err) {
    console.error('[autostart] Failed to write .desktop file:', err)
    return { success: false, supported: true, error: err.message }
  }
}

/**
 * Remove the autostart entry / registry login item.
 */
function removeAutostart() {
  if (process.platform === 'win32') {
    if (!app.isPackaged) {
      return { success: false, supported: false, devBuild: true, message: 'Autostart is disabled in dev builds' }
    }
    try {
      app.setLoginItemSettings({ openAtLogin: false, args: ['--autostart'] })
      return { success: true, supported: true }
    } catch (err) {
      console.error('[autostart] Failed to remove Windows login item:', err)
      return { success: false, supported: true, error: err.message }
    }
  }
  if (process.platform !== 'linux') {
    return { success: false, supported: false, message: 'Autostart is unsupported for now on this platform' }
  }
  try {
    if (fs.existsSync(DESKTOP_FILE)) {
      fs.unlinkSync(DESKTOP_FILE)
      console.log('[autostart] .desktop file removed from', DESKTOP_FILE)
    }
    return { success: true, supported: true }
  } catch (err) {
    console.error('[autostart] Failed to remove .desktop file:', err)
    return { success: false, supported: true, error: err.message }
  }
}

/**
 * Check whether autostart is currently enabled.
 *
 * @returns {boolean}
 */
function isAutostartEnabled() {
  if (process.platform === 'win32') {
    if (!app.isPackaged) return false
    return Boolean(app.getLoginItemSettings({ args: ['--autostart'] })?.openAtLogin)
  }
  if (process.platform !== 'linux') return false
  return fs.existsSync(DESKTOP_FILE)
}

module.exports = { setAutostart, removeAutostart, isAutostartEnabled, getAutostartStatus }
