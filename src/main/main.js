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
const mediaMonitor = require('./mediaMonitor')
const TypingDetector = require('./typing/TypingDetector')

// ─── Wayland / Ozone flags ───────────────────────────────────────────────────
// Must be set before app.ready fires. Required for proper rendering under
// Hyprland's Wayland compositor. Safe to set on X11 (ignored gracefully).
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform')

// Platform selector — default: native Wayland.
// ── XWayland diagnostic test ──────────────────────────────────────────────
// To force XWayland (e.g. to isolate Wayland input-region bugs), launch with:
//   SCREEN_BUDDY_OZONE=x11 npm run dev
// Revert by launching normally (no prefix). Do NOT commit x11 as the default.
// ─────────────────────────────────────────────────────────────────────────────
const ozoneOverride = process.env.SCREEN_BUDDY_OZONE  // 'x11' | 'wayland' | undefined
if (ozoneOverride === 'x11') {
  console.log('[main] ⚠️  XWayland diagnostic mode: ozone-platform=x11')
  app.commandLine.appendSwitch('ozone-platform', 'x11')
} else {
  // Default: native Wayland (for Hyprland / proper transparency)
  app.commandLine.appendSwitch('ozone-platform', 'wayland')
}

// Allow transparent windows on Wayland
app.commandLine.appendSwitch('enable-transparent-visuals')

// ─── Globals ─────────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let settings = null // loaded from disk at startup
let isPaused = false // runtime pause state (not persisted between sessions)
const TRAY_TOOLTIP_UPDATE_INTERVAL_MS = 10 * 1000
let lastTrayTooltipUpdateAt = 0
let lastTrayTooltipMode = null
let typingDetector = null

// Canonical Hyprland / Electron window title. Must match hyprctl title: regexes
// and the windowrulev2 entries in README / hyprland.conf.
const WINDOW_TITLE = 'screen-buddy-overlay'
const HYPR_TITLE_MATCH = `title:^(${WINDOW_TITLE})$`

// ─── Click-through state ──────────────────────────────────────────────────────
// Tracks whether the overlay is currently in interactive mode (cursor is over
// the cat / a card). Used by the periodic safety reassertion (see below) to
// avoid stomping an active hover/drag session.
// ROLLBACK: delete isInteractive + passthruInterval + the setInterval block in registerIpcHandlers.
let isInteractive = false
let passthruInterval = null

// ── Renderer diagnostic mode ────────────────────────────────────────────────
const rendererOverride = process.env.SCREEN_BUDDY_RENDERER
if (rendererOverride === 'swiftshader') {
  console.log('[main] ⚠️ SwiftShader diagnostic mode active')
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
} else {
  // Normal mode: disable hardware acceleration entirely (non-GL path)
  app.disableHardwareAcceleration()
}
// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  settings = loadSettings()

  typingDetector = new TypingDetector((channel, event) => {
    mainWindow?.webContents.send(channel, event)
  })

  createOverlayWindow()
  createTray()
  registerIpcHandlers()
  registerPowerMonitor()

  // Apply saved autostart preference on launch
  if (settings.autostart) {
    setAutostart()
  }
  
  // Start typing detection based on initial settings
  typingDetector.updateSettings(settings)

  // Start media playback monitor — sends real-time updates to renderer
  mediaMonitor.start((status) => {
    mainWindow?.webContents.send('media:status', status)
  })

  mainWindow?.webContents.on('did-finish-load', () => {
    const current = mediaMonitor.getStatus()
    if (current && (current.playing || current.title || current.artist)) {
      mainWindow?.webContents.send('media:status', current)
    }
  })
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

// Clean up child processes before exit
app.on('will-quit', () => {
  mediaMonitor.stop()
  if (passthruInterval) {
    clearInterval(passthruInterval)
    passthruInterval = null
  }
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
 *   - resizable: true          → required so programmatic setSize() works on Wayland;
 *                                 frameless + transparent still hide chrome / resize handles
 */
function createOverlayWindow() {
  mainWindow = new BrowserWindow({
    title: WINDOW_TITLE,
    width: 350,  // Enough to fit cat and reminder cards
    height: 350,
    x: 0,
    y: 0,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Must stay true: on Linux/Wayland, resizable:false can also block
    // programmatic BrowserWindow.setSize() (not just user resize).
    // Frameless + transparent overlay has no visible chrome to drag-resize.
    resizable: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // No longer rely on setIgnoreMouseEvents. Window is physically small.
  mainWindow.once('ready-to-show', () => {
    console.log('[main] ready-to-show fired. Small window mode.')
  })

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log('[main] LOAD FAILED:', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.log('[main] RENDERER CRASHED:', details);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Prevent the renderer <title> from changing the Hyprland-visible title.
    mainWindow.setTitle(WINDOW_TITLE)
    console.log(`[main] Overlay window did-finish-load. Electron title="${mainWindow.getTitle()}" (canonical=${WINDOW_TITLE})`)

    if (process.env.SCREEN_BUDDY_AUTO_DRAG === '1') {
      setTimeout(async () => {
        try {
          const wait = (ms) => new Promise((res) => setTimeout(res, ms))
          const hit = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const el = document.querySelector('.mascot-container')
              if (!el) return { error: 'no-el' }
              const r = el.getBoundingClientRect()
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), inner: [window.innerWidth, window.innerHeight] }
            })()
          `)
          if (hit?.error) {
            console.error('[main] AUTO_DRAG', hit)
            return
          }
          const send = (payload) => {
            mainWindow.webContents.sendInputEvent(payload)
          }
          console.log('[main] AUTO_DRAG real Chromium mouseDown at', JSON.stringify(hit))
          send({ type: 'mouseDown', x: hit.x, y: hit.y, button: 'left', clickCount: 1 })
          for (let i = 1; i <= 8; i++) {
            await wait(150)
            send({ type: 'mouseMove', x: hit.x + i * 24, y: hit.y + i * 10 })
          }
          const mid = await mainWindow.webContents.executeJavaScript(`
            ({ inner: [window.innerWidth, window.innerHeight], dragging: document.querySelector('.mascot-container')?.classList.contains('is-dragging') })
          `)
          console.log('[main] AUTO_DRAG mid-hold (before mouseUp)', JSON.stringify(mid), 't=' + Date.now())
          await wait(400)
          send({ type: 'mouseUp', x: hit.x + 192, y: hit.y + 80, button: 'left', clickCount: 1 })
          console.log('[main] AUTO_DRAG real Chromium mouseUp t=' + Date.now())
          await wait(800)
          const after = await mainWindow.webContents.executeJavaScript(`
            ({ inner: [window.innerWidth, window.innerHeight], dragging: document.querySelector('.mascot-container')?.classList.contains('is-dragging') })
          `)
          console.log('[main] AUTO_DRAG after mouseUp', JSON.stringify(after))
        } catch (err) {
          console.error('[main] AUTO_DRAG failed', err)
        }
      }, 3000)
    }
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('[main] Overlay window dom-ready event fired.')
  });

  // Load the renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    // Development: load from the Vite dev server
    const url = process.env.VITE_DEV_SERVER_URL
    console.log(`[main] LOADING RENDERER via loadURL: "${url}"`)
    mainWindow.loadURL(url)
  } else {
    // Production: load the built index.html from the project root's dist/ folder.
    const resolvedPath = path.join(app.getAppPath(), 'dist/index.html')
    console.log(`[main] LOADING RENDERER via loadFile: "${resolvedPath}"`)
    mainWindow.loadFile(resolvedPath).catch((err) => {
      console.error('[main] loadFile threw an error:', err)
    })
  }
  // Open DevTools in development for easy debugging
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // showInactive() prevents stealing focus from the user's active app on startup
  mainWindow.showInactive()
  console.log(`[main] Overlay created!`)
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

const ALL_REMINDER_TYPES = ['water', 'eyeRest', 'movementBreak']

function getEnabledReminderTypes(s) {
  const reminders = s?.reminders || {}
  const enabled = ALL_REMINDER_TYPES.filter((t) => reminders[t] !== false)
  return enabled.length > 0 ? enabled : ALL_REMINDER_TYPES
}

let lastTestReminderType = null

function getNextTestReminderType(s) {
  const enabled = getEnabledReminderTypes(s)
  if (enabled.length <= 1) return enabled[0]
  const candidates = enabled.filter((t) => t !== lastTestReminderType)
  const chosen = candidates[Math.floor(Math.random() * candidates.length)]
  lastTestReminderType = chosen
  return chosen
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
        const type = getNextTestReminderType(settings)
        // Tell the renderer to immediately trigger a reminder cycle
        mainWindow?.webContents.send('tray:test-reminder', { type })
      },
    },
    {
      label: '⏱️ Pomodoro & Stopwatch',
      submenu: [
        {
          label: '🍅 Start Pomodoro (25m / 5m)',
          click: () => {
            mainWindow?.webContents.send('timer:start-pomodoro')
          },
        },
        {
          label: '⏱️ Start Stopwatch',
          click: () => {
            mainWindow?.webContents.send('timer:start-stopwatch')
          },
        },
        {
          label: '⏹️ Stop / Reset',
          click: () => {
            mainWindow?.webContents.send('timer:stop')
          },
        },
        { type: 'separator' },
        {
          label: '⚡ Test: Fast Pomodoro (5s work)',
          click: () => {
            mainWindow?.webContents.send('timer:test-pomodoro-work-end')
          },
        },
      ],
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
    
    // Update typing detector settings
    if (typingDetector) {
      typingDetector.updateSettings(settings)
    }

    console.log('[main] Settings saved:', settings)
    return settings
  })

  // ── Typing ────────────────────────────────────────────────────────────────

  ipcMain.handle('typing:check-permission', () => {
    return typingDetector ? typingDetector.checkPermissionStatus() : null
  })


  // ── Window Movement (Hyprland IPC via hyprctl) & Resizing ──────────────
  //
  // Throttled to ~30 fps. We store the latest requested (x,y) and flush it
  // with a single `hyprctl` child process at most every 33 ms.  If a process
  // is already in-flight we skip until it finishes, then immediately flush
  // the newest queued position.

  let _movePending = null   // { x, y } — latest requested position
  let _moveInFlight = false // true while a hyprctl process is running
  let _moveTimer = null     // setInterval handle
  const util = require('util')
  const execFile = util.promisify(require('child_process').execFile)

  async function flushMove() {
    if (_moveInFlight || !_movePending) return
    const { x, y } = _movePending
    _movePending = null
    _moveInFlight = true

    const cmdArgs = [
      'dispatch', 'movewindowpixel',
      `exact ${Math.round(x)} ${Math.round(y)},${HYPR_TITLE_MATCH}`
    ]
    console.log(
      `[main] hyprctl ${cmdArgs.join(' ')} (mode=${currentWindowMode} repositionInProgress=${mascotRepositionInProgress} trackedSize=${currentWinW}x${currentWinH})`
    )

    try {
      const util = require('util')
      const execFile = util.promisify(require('child_process').execFile)
      await execFile('hyprctl', cmdArgs)
    } catch (err) {
      console.error('[main] hyprctl spawn error:', err)
    } finally {
      _moveInFlight = false
      // If another position arrived while we were running, flush it now
      if (_movePending) flushMove()
    }
  }

  let currentWinW = 350
  let currentWinH = 350
  let currentWindowMode = 'mascot'
  let mascotRepositionInProgress = false

  async function logHyprlandClientBounds(tag) {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      console.log(`[main] ${tag} hyprctl clients skipped (not on Hyprland)`)
      return null
    }
    try {
      const { stdout } = await execFile('hyprctl', ['clients', '-j'])
      const clients = JSON.parse(stdout)
      const matches = clients.filter((c) => {
        const title = String(c.title || '')
        const cls = String(c.class || c.initialClass || '')
        return title === WINDOW_TITLE || title.includes('screen-buddy') || cls.toLowerCase().includes('screen-buddy') || cls.toLowerCase().includes('electron')
      })
      if (!matches.length) {
        console.log(`[main] ${tag} hyprctl clients: no screen-buddy/electron window found (scanned ${clients.length} clients)`)
        return null
      }
      for (const buddy of matches) {
        console.log(
          `[main] ${tag} hyprctl client title="${buddy.title}" class="${buddy.class}" initialClass="${buddy.initialClass}" at (${buddy.at?.[0]}, ${buddy.at?.[1]}) size ${buddy.size?.[0]}x${buddy.size?.[1]} floating=${buddy.floating} mapped=${buddy.mapped} hidden=${buddy.hidden} workspace=${buddy.workspace?.name}`
        )
      }
      // Size gating must use the overlay window, not some other Electron client
      // (Cursor, Vite, etc.) that also matches class=electron.
      const overlay = matches.find((c) => c.title === WINDOW_TITLE)
        || matches.find((c) => String(c.title || '').includes('screen-buddy'))
        || matches.find((c) => String(c.class || c.initialClass || '').toLowerCase().includes('screen-buddy'))
      if (!overlay) {
        console.log(`[main] ${tag} hyprctl clients: overlay title=${WINDOW_TITLE} not found among ${matches.length} electron-like client(s)`)
        return null
      }
      return overlay
    } catch (err) {
      console.error(`[main] ${tag} hyprctl clients error:`, err)
      return null
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // Hyprland's reported window size lags Electron's getSize(). The renderer
  // must not switch CSS coordinate space until hyprctl clients agrees.
  const HYPR_SIZE_POLL_MS = 40
  const HYPR_SIZE_POLL_TIMEOUT_MS = 1000

  function formatHyprSize(client) {
    const size = client?.size
    return Array.isArray(size) ? `${size[0]}x${size[1]}` : 'unknown'
  }

  /**
   * Poll hyprctl clients until the compositor reports the target size.
   * Electron getSize() is logged only as a contrast — it is not used to
   * decide `applied`.
   */
  async function waitForHyprlandSize(width, height, tag) {
    const started = Date.now()
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      console.error(
        `[main] ${tag} HYPRCTL SIZE POLL FAILED: not on Hyprland ` +
        `(HYPRLAND_INSTANCE_SIGNATURE unset). Cannot confirm compositor size ${width}x${height}.`
      )
      return { applied: false, compositorSize: null, attempts: 0, elapsedMs: 0 }
    }

    let attempt = 0
    let lastClient = null
    while (Date.now() - started < HYPR_SIZE_POLL_TIMEOUT_MS) {
      attempt += 1
      lastClient = await logHyprlandClientBounds(`${tag} hyprctl poll #${attempt}`)
      const size = lastClient?.size
      const applied = Array.isArray(size) && size[0] === width && size[1] === height
      const elapsedMs = Date.now() - started
      console.log(
        `[main] ${tag} hyprctl poll #${attempt} compositorSize=${formatHyprSize(lastClient)} ` +
        `expected=${width}x${height} applied=${applied} elapsed=${elapsedMs}ms ` +
        `electron getSize=${JSON.stringify(mainWindow?.getSize?.())} (ignored for applied)`
      )
      if (applied) {
        return { applied: true, compositorSize: size, attempts: attempt, elapsedMs }
      }
      await delay(HYPR_SIZE_POLL_MS)
    }

    const elapsedMs = Date.now() - started
    const lastSize = lastClient?.size || null
    console.error(
      `[main] ${tag} HYPRCTL SIZE POLL FAILED: compositor still ${formatHyprSize(lastClient)} ` +
      `after ${elapsedMs}ms (${attempt} attempts), expected ${width}x${height}. ` +
      `electron getSize=${JSON.stringify(mainWindow?.getSize?.())} is not the source of truth. ` +
      `Renderer must not treat this resize as applied.`
    )
    return { applied: false, compositorSize: lastSize, attempts: attempt, elapsedMs }
  }

  async function resizeHyprlandWindow(width, height, tag) {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
    const cmdArgs = [
      'dispatch', 'resizewindowpixel',
      `exact ${Math.round(width)} ${Math.round(height)},${HYPR_TITLE_MATCH}`
    ]
    console.log(`[main] ${tag} hyprctl ${cmdArgs.join(' ')}`)
    try {
      await execFile('hyprctl', cmdArgs)
    } catch (err) {
      console.error(`[main] ${tag} hyprctl resize error:`, err)
    }
  }

  async function applyDragWindowSize(width, height) {
    const sizeBefore = mainWindow?.getSize?.()
    const boundsBefore = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode drag calling setSize(${width}, ${height}) + setPosition(0, 0); ` +
      `resizable=${mainWindow?.isResizable?.()} ` +
      `electron getSize before=${JSON.stringify(sizeBefore)} ` +
      `getBounds before=${JSON.stringify(boundsBefore)}`
    )
    mainWindow?.setSize(width, height)
    mainWindow?.setPosition(0, 0)
    const sizeAfter = mainWindow?.getSize?.()
    const boundsAfter = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode drag setSize RETURNED; ` +
      `electron getSize after=${JSON.stringify(sizeAfter)} ` +
      `getBounds after=${JSON.stringify(boundsAfter)} ` +
      `(Electron size is not used to gate the renderer)`
    )

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      _movePending = null
      await resizeHyprlandWindow(width, height, 'window:mode drag-start')
      try {
        await execFile('hyprctl', ['dispatch', 'movewindowpixel', `exact 0 0,${HYPR_TITLE_MATCH}`])
      } catch (err) {
        console.error('[main] hyprctl drag move error:', err)
      }
    }

    return waitForHyprlandSize(width, height, 'window:mode drag-start')
  }

  async function applyMascotWindowSize(tag) {
    const sizeBefore = mainWindow?.getSize?.()
    const boundsBefore = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode mascot calling setSize(350, 350) (${tag}); ` +
      `resizable=${mainWindow?.isResizable?.()} ` +
      `electron getSize before=${JSON.stringify(sizeBefore)} ` +
      `getBounds before=${JSON.stringify(boundsBefore)}`
    )
    mainWindow?.setSize(350, 350)
    const sizeAfter = mainWindow?.getSize?.()
    const boundsAfter = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode mascot setSize(350, 350) RETURNED (${tag}); ` +
      `electron getSize after=${JSON.stringify(sizeAfter)} ` +
      `getBounds after=${JSON.stringify(boundsAfter)} ` +
      `(Electron size is not used to gate the renderer)`
    )
    await resizeHyprlandWindow(350, 350, `window:mode mascot ${tag}`)
    return waitForHyprlandSize(350, 350, `window:mode mascot ${tag}`)
  }

  ipcMain.on('window:move', (event, x, y) => {
    // Ignore all renderer move requests during drag. The renderer positions the cat
    // visually within the fullscreen window, and we reposition the window natively
    // only when 'window:mode -> mascot' is emitted on release.
    if (mascotRepositionInProgress) {
      console.log(
        `[main] window:move DURING mascot reposition (blocked, currentWindowMode='${currentWindowMode}') catCenter=(${x}, ${y}) trackedSize=${currentWinW}x${currentWinH}`
      )
    }
    if (currentWindowMode === 'drag' || mascotRepositionInProgress) return

    // Incoming x,y = desired cat center on the physical screen.
    // Convert to window top-left and clamp so the logical window stays on-screen.
    // We use the tracked currentWinW/H because mainWindow.getSize() is asynchronous
    // on Wayland and will return stale fullscreen bounds immediately after a drag release.
    const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize

    let wx = Math.round(x - currentWinW / 2)
    let wy = Math.round(y - currentWinH / 2)
    wx = Math.max(0, Math.min(wx, screenW - currentWinW))
    wy = Math.max(0, Math.min(wy, screenH - currentWinH))

    // 1. Standard Electron setPosition (fallback / X11)
    mainWindow?.setPosition(wx, wy)

    // 2. Hyprland — queue latest position, flushed by the timer
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      _movePending = { x: wx, y: wy }
      if (!_moveTimer) {
        _moveTimer = setInterval(flushMove, 33) // ~30 fps
        flushMove() // fire immediately for the first move
      }
    }
  })

  // Serialize mode changes so a fast pointer-up cannot shrink while expand is still in-flight.
  let windowModeChain = Promise.resolve()

  ipcMain.handle('window:mode', (event, mode, ...args) => {
    const run = () => applyWindowMode(mode, args)
    const pending = windowModeChain.then(run, run)
    windowModeChain = pending.then(() => undefined, () => undefined)
    return pending
  })

  async function applyWindowMode(mode, args) {
    const modeEnteredAt = Date.now()
    const { screen } = require('electron')
    if (mode === 'drag') {
      // Block roam/move immediately while we expand — this is the drag guard.
      currentWindowMode = 'drag'
      // Temporarily expand to full work area so pointer events stay inside
      const { width, height } = screen.getPrimaryDisplay().workAreaSize
      currentWinW = width
      currentWinH = height
      const verify = await applyDragWindowSize(width, height)
      console.log(
        `[main] window:mode -> drag (${width}x${height} at 0,0) title=${WINDOW_TITLE} ` +
        `applied=${verify.applied} compositorSize=${JSON.stringify(verify.compositorSize)} ` +
        `pollAttempts=${verify.attempts} pollElapsed=${verify.elapsedMs}ms ` +
        `handler ${Date.now() - modeEnteredAt}ms`
      )
      return { applied: verify.applied, width, height, compositorSize: verify.compositorSize, elapsedMs: verify.elapsedMs }
    } else if (mode === 'settings') {
      currentWindowMode = 'settings'
      currentWinW = 800
      currentWinH = 600
      mainWindow?.setSize(800, 600)
      mainWindow?.center()
    } else {
      // 'mascot' — keep currentWindowMode as 'drag' (or previous) until shrink +
      // reposition are done, so window:move / roaming cannot interrupt.
      mascotRepositionInProgress = true
      currentWinW = 350
      currentWinH = 350

      const [catX, catY] = args
      let verify = { applied: false, compositorSize: null, attempts: 0, elapsedMs: 0 }
      try {
        if (catX !== undefined && catY !== undefined) {
          const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
          let wx = Math.round(catX - 350 / 2)
          let wy = Math.round(catY - 350 / 2)
          wx = Math.max(0, Math.min(wx, screenW - 350))
          wy = Math.max(0, Math.min(wy, screenH - 350))

          // Reposition first so that when the window shrinks, its top-left is already in the right spot,
          // avoiding the cat being clipped out by a 350x350 window stuck at 0,0.
          mainWindow?.setPosition(wx, wy)
          if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
            _movePending = null
            try {
              await execFile('hyprctl', ['dispatch', 'movewindowpixel', `exact ${wx} ${wy},${HYPR_TITLE_MATCH}`])
            } catch (err) {
              console.error('[main] hyprctl mascot move error:', err)
            }
          }

          // Shrink after the reposition is confirmed
          verify = await applyMascotWindowSize('drag-end')
          console.log(`[main] window:mode -> mascot at window (${wx}, ${wy}) from cat center (${catX}, ${catY}) electronTitle="${mainWindow?.getTitle?.()}" hyprMatch=${HYPR_TITLE_MATCH} applied=${verify.applied} compositorSize=${JSON.stringify(verify.compositorSize)}`)
        } else {
          verify = await applyMascotWindowSize('no-coords')
        }
      } finally {
        mascotRepositionInProgress = false
        currentWindowMode = 'mascot'
        console.log(`[main] window:mode mascot handler finished in ${Date.now() - modeEnteredAt}ms; currentWindowMode now '${currentWindowMode}' applied=${verify.applied}`)
      }
      return { applied: verify.applied, width: 350, height: 350, compositorSize: verify.compositorSize, elapsedMs: verify.elapsedMs }
    }
  }

  // Remove old mouse hit-testing since we rely on natural small window bounds
  ipcMain.on('mouse:enter-interactive', () => {})
  ipcMain.on('mouse:leave-interactive', () => {})

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

  // ── Pomodoro / Stopwatch status ───────────────────────────────────────────
  ipcMain.on('timer:update-status', (_event, { mode, formattedTime, running }) => {
    if (!tray) return

    if (running && mode && formattedTime) {
      const prefix = mode.startsWith('pomodoro') ? '🍅' : '⏱️'
      const now = Date.now()
      const modeChanged = mode !== lastTrayTooltipMode

      // Some Linux StatusNotifier hosts close open submenus whenever the
      // tooltip changes. Status still arrives each second, but we only write
      // the tooltip on start/mode changes and at most once every 10 seconds.
      if (modeChanged || now - lastTrayTooltipUpdateAt >= TRAY_TOOLTIP_UPDATE_INTERVAL_MS) {
        tray.setToolTip(`screen-buddy — ${prefix} ${formattedTime}`)
        lastTrayTooltipUpdateAt = now
        lastTrayTooltipMode = mode
      }
      return
    }

    // Reset immediately when the timer stops; this is not a periodic tick.
    if (lastTrayTooltipMode !== null) {
      tray.setToolTip('screen-buddy')
      lastTrayTooltipMode = null
      lastTrayTooltipUpdateAt = 0
    }
  })

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
