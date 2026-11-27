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
function getAutostartDir() {
  const configHome =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configHome, 'autostart')
}

function getDesktopFile() {
  return path.join(getAutostartDir(), 'screen-buddy.desktop')
}

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
      enabled: fs.existsSync(getDesktopFile()),
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
    const desktopFile = getDesktopFile()
    const content = buildDesktopEntry()
    if (fs.existsSync(desktopFile)) {
      const existing = fs.readFileSync(desktopFile, 'utf-8')
      if (existing === content) {
        return { success: true, supported: true }
      }
    }
    fs.mkdirSync(getAutostartDir(), { recursive: true })
    fs.writeFileSync(desktopFile, content, 'utf-8')
    console.log('[autostart] .desktop file written to', desktopFile)
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
    const desktopFile = getDesktopFile()
    if (fs.existsSync(desktopFile)) {
      fs.unlinkSync(desktopFile)
      console.log('[autostart] .desktop file removed from', desktopFile)
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
  return fs.existsSync(getDesktopFile())
}

/**
 * Self-heal Linux AppImage autostart .desktop entry if Exec differs from process.env.APPIMAGE.
 * Linux AppImage only. Never creates entry if it does not already exist.
 *
 * @param {string} [newAppImagePath]
 * @returns {boolean}
 */
function repairAutostartExecIfNeeded(newAppImagePath) {
  if (process.platform !== 'linux') return false
  if (newAppImagePath && typeof newAppImagePath === 'string') {
    process.env.APPIMAGE = newAppImagePath
  }
  if (!process.env.APPIMAGE) return false

  const desktopFile = getDesktopFile()
  if (!fs.existsSync(desktopFile)) return false

  try {
    const existing = fs.readFileSync(desktopFile, 'utf-8')
    const content = buildDesktopEntry()
    if (existing === content) return false

    const existingExec = existing.split('\n').find((l) => l.startsWith('Exec='))
    const expectedExec = content.split('\n').find((l) => l.startsWith('Exec='))

    if (!existingExec || existingExec.trim() === expectedExec?.trim()) {
      return false
    }

    fs.mkdirSync(getAutostartDir(), { recursive: true })
    fs.writeFileSync(desktopFile, content, 'utf-8')
    console.log('[autostart] repaired Exec path')
    return true
  } catch (err) {
    console.warn('[autostart] Failed to repair Exec path:', err.message)
    return false
  }
}

module.exports = {
  setAutostart,
  removeAutostart,
  isAutostartEnabled,
  getAutostartStatus,
  repairAutostartExecIfNeeded,
}
