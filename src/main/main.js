/**
 * screen-buddy — Electron main process entry point
 *
 * Responsibilities:
 *  - Create and configure the overlay BrowserWindow
 *  - Set up the system tray icon + context menu
 *  - Expose IPC handlers for the renderer (settings, tray actions, autostart)
 *  - Monitor power events to pause/resume the companion
 *
 * Platform: Linux (Fedora / Hyprland / Wayland) only.
 */

'use strict'

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen: electronScreen,
} = require('electron')
const path = require('path')

const { loadSettings, saveSettings, getSettingsPath } = require('./settings')
const { setAutostart, removeAutostart } = require('./autostart')

// ─── Wayland / Ozone flags ───────────────────────────────────────────────────
// Must be set before app.ready fires. Required for proper rendering under
// Hyprland's Wayland compositor. Safe to set on X11 (ignored gracefully).
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform')
// app.commandLine.appendSwitch('ozone-platform', 'wayland')

// Allow transparent windows on Wayland
app.commandLine.appendSwitch('enable-transparent-visuals')

// ─── Globals ─────────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let settings = null // loaded from disk at startup
let isPaused = false // runtime pause state (not persisted between sessions)

app.disableHardwareAcceleration()
// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  settings = loadSettings()

  createOverlayWindow()
  createTray()
  registerIpcHandlers()
  registerPowerMonitor()

  // Apply saved autostart preference on launch
  if (settings.autostart) {
    setAutostart()
  }
})

// Electron single-instance guard — prevent duplicate processes.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// Quit when all windows are closed (shouldn't normally happen for an overlay,
// but keeps the app well-behaved during development).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── Overlay window ──────────────────────────────────────────────────────────
/**
 * Creates a transparent, frameless, always-on-top fullscreen overlay.
 *
 * Key flags for Hyprland / Wayland:
 *   - transparent: true        → no background, mascot floats
 *   - frame: false             → no OS window decorations
 *   - alwaysOnTop: true        → stays above all app windows
 *   - skipTaskbar: true        → doesn't appear in taskbar/dock
 *   - focusable: false         → click-through by default (set per-hit-region via IPC)
 */
function createOverlayWindow() {
  const { width, height } = electronScreen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false, // click-through globally; renderer toggles per-region via IPC
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Start click-through everywhere — renderer will ask to enable input on hover
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  // Load the renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    // Development: load from the Vite dev server
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Production: load the built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Open DevTools in development for easy debugging
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  console.log('[main] Overlay window created:', width, 'x', height)
}

// ─── System tray ─────────────────────────────────────────────────────────────
/**
 * Creates the system tray icon and its context menu.
 * Falls back to an empty/placeholder icon if the asset isn't present yet.
 */
function createTray() {
  // Placeholder 16×16 empty PNG (1×1 transparent pixel, base64-encoded)
  // Replace with real tray icon later: nativeImage.createFromPath(iconPath)
  const placeholderIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACklEQVQ' +
    'I12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='
  )

  tray = new Tray(placeholderIcon)
  tray.setToolTip('screen-buddy')
  buildTrayMenu()

  console.log('[main] System tray initialised')
}

/**
 * Builds (or rebuilds) the tray context menu.
 * Called on creation and whenever pause state changes.
 */
function buildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: '🔔 Test Reminder',
      click: () => {
        // Tell the renderer to immediately trigger a reminder cycle
        mainWindow?.webContents.send('tray:test-reminder')
      },
    },
    { type: 'separator' },
    {
      label: '⚙️  Settings',
      click: () => {
        // Tell the renderer to open the settings modal
        mainWindow?.webContents.send('tray:open-settings')
      },
    },
    {
      label: isPaused ? '▶️  Resume' : '⏸️  Pause',
      click: () => {
        isPaused = !isPaused
        // Notify renderer of new pause state
        mainWindow?.webContents.send('tray:pause-state', isPaused)
        // Rebuild menu so the label flips
        buildTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: '✖  Exit',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(menu)
}

// ─── IPC handlers ────────────────────────────────────────────────────────────
/**
 * Register all IPC handlers that the renderer can call via window.api.*
 */
function registerIpcHandlers() {
  // ── Settings ──────────────────────────────────────────────────────────────

  /** Return the current settings object to the renderer */
  ipcMain.handle('settings:get', () => {
    return settings
  })

  /**
   * Persist updated settings sent from the renderer.
   * Handles autostart side-effect automatically.
   */
  ipcMain.handle('settings:set', (_event, updatedSettings) => {
    settings = { ...settings, ...updatedSettings }
    saveSettings(settings)

    // Toggle autostart .desktop file based on the new setting
    if (settings.autostart) {
      setAutostart()
    } else {
      removeAutostart()
    }

    console.log('[main] Settings saved:', settings)
    return settings
  })

  // ── Mouse hit-testing ─────────────────────────────────────────────────────

  /**
   * Renderer calls this when the pointer enters a clickable UI region
   * (e.g. the mascot area or a button). We disable ignore-mouse-events
   * so the window captures clicks normally.
   */
  ipcMain.on('mouse:enter-interactive', () => {
    mainWindow?.setIgnoreMouseEvents(false)
  })

  /**
   * Renderer calls this when the pointer leaves the interactive region.
   * Re-enable click-through everywhere else.
   * `forward: true` ensures pointer events still reach windows behind ours.
   */
  ipcMain.on('mouse:leave-interactive', () => {
    mainWindow?.setIgnoreMouseEvents(true, { forward: true })
  })

  // ── Pause / resume ────────────────────────────────────────────────────────

  /**
   * Renderer can toggle pause (e.g. from the settings modal checkbox).
   * We sync the main-process flag and rebuild the tray so it stays correct.
   */
  ipcMain.on('pause:set', (_event, paused) => {
    isPaused = paused
    buildTrayMenu()
  })

  // ── Misc ──────────────────────────────────────────────────────────────────

  /** Expose the resolved settings file path to the renderer for display */
  ipcMain.handle('settings:get-path', () => getSettingsPath())
}

// ─── Power monitor ───────────────────────────────────────────────────────────
/**
 * Use Electron's powerMonitor to pause reminders while the system is
 * suspended or the screen is locked, then resume when the user comes back.
 */
function registerPowerMonitor() {
  powerMonitor.on('suspend', () => {
    console.log('[main] System suspending — pausing reminders')
    mainWindow?.webContents.send('power:suspend')
  })

  powerMonitor.on('resume', () => {
    console.log('[main] System resumed — resuming reminders')
    mainWindow?.webContents.send('power:resume')
  })

  powerMonitor.on('lock-screen', () => {
    console.log('[main] Screen locked — pausing reminders')
    mainWindow?.webContents.send('power:lock-screen')
  })

  powerMonitor.on('unlock-screen', () => {
    console.log('[main] Screen unlocked — resuming reminders')
    mainWindow?.webContents.send('power:unlock-screen')
  })
}
