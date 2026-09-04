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

// ─── XDG autostart path ──────────────────────────────────────────────────────
const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')

const AUTOSTART_DIR = path.join(XDG_CONFIG_HOME, 'autostart')
const DESKTOP_FILE = path.join(AUTOSTART_DIR, 'screen-buddy.desktop')

// ─── .desktop file content ───────────────────────────────────────────────────
/**
 * Generate the .desktop entry content.
 * Exec path is the currently running Electron binary (process.execPath).
 * On a packaged build this is the wrapped app binary; in development it is
 * the raw `electron` binary with the project dir as the first argument.
 */
function buildDesktopEntry() {
  // In development, process.execPath is the electron binary. We need to pass
  // the app directory as the first argument.
  // In production, the packaged executable is self-contained.
  const execPath =
    process.env.NODE_ENV === 'development'
      ? `${process.execPath} ${path.resolve(__dirname, '../..')}`
      : process.execPath

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

/**
 * Write the autostart .desktop file, creating the autostart directory
 * if it does not already exist.
 */
function setAutostart() {
  try {
    fs.mkdirSync(AUTOSTART_DIR, { recursive: true })
    fs.writeFileSync(DESKTOP_FILE, buildDesktopEntry(), 'utf-8')
    console.log('[autostart] .desktop file written to', DESKTOP_FILE)
  } catch (err) {
    console.error('[autostart] Failed to write .desktop file:', err)
  }
}

/**
 * Remove the autostart .desktop file if it exists.
 */
function removeAutostart() {
  try {
    if (fs.existsSync(DESKTOP_FILE)) {
      fs.unlinkSync(DESKTOP_FILE)
      console.log('[autostart] .desktop file removed from', DESKTOP_FILE)
    }
  } catch (err) {
    console.error('[autostart] Failed to remove .desktop file:', err)
  }
}

/**
 * Check whether the autostart .desktop file currently exists.
 *
 * @returns {boolean}
 */
function isAutostartEnabled() {
  return fs.existsSync(DESKTOP_FILE)
}

module.exports = { setAutostart, removeAutostart, isAutostartEnabled }
