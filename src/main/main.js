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

function ignoreEpipe(err) {
  if (err?.code === 'EPIPE') return
  throw err
}
process.stdout.on('error', ignoreEpipe)
process.stderr.on('error', ignoreEpipe)

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  powerMonitor,
  globalShortcut,
  screen: electronScreen,
  shell,
  clipboard,
} = require('electron')
const path = require('path')
const net = require('net')
const fs = require('fs')
const os = require('os')
const util = require('util')
const { execFile: execFileCallback, spawn } = require('child_process')

// Ensure app name and userData stay canonical across platforms.
// On Linux, userData MUST remain ~/.config/screen-buddy regardless of productName.
app.setName('screen-buddy')
if (process.platform === 'win32') {
  app.setAppUserModelId('io.github.the-nullb0rn.screen-buddy')
  app.on('session-end', () => app.quit())
}
const userDataArg = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--user-data-dir='))
const customUserData = userDataArg
  ? userDataArg.slice('--user-data-dir='.length)
  : (process.env.SCREEN_BUDDY_USER_DATA_DIR || null)
if (customUserData) {
  app.setPath('userData', customUserData)
} else if (process.platform === 'linux') {
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  app.setPath('userData', path.join(xdgConfigHome, 'screen-buddy'))
}

const execFileAsync = util.promisify(execFileCallback)


const { DEFAULT_SETTINGS, loadSettings, saveSettings, getSettingsPath, validateSettingsUpdate } = require('./settings')
const {
  setAutostart,
  removeAutostart,
  getAutostartStatus,
  repairAutostartExecIfNeeded,
} = require('./autostart')
const mediaMonitor = require('./mediaMonitor')
const TypingDetector = require('./typing/TypingDetector')
const { NotificationsManager } = require('./notifications')
const { watchTrayHost } = require('./trayHost')
const {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateState,
  initUpdater,
  notifyUpdaterSettingsChanged,
  cleanupUpdater,
} = require('./updater')
const {
  NORMAL_WIN_W,
  NORMAL_WIN_H,
  NORMAL_CAT_CX,
  NORMAL_CAT_CY,
  TREATMENT_WIN_W,
  TREATMENT_WIN_H,
  TREATMENT_CAT_CX,
  TREATMENT_CAT_CY,
  getDisplayForPoint,
  getDisplayCatGeometry,
  getDefaultMascotPosition,
  clampWindowPosition,
  clampCatCenterPosition,
  computeBubblePosition,
} = require('./displayGeometry')

// Electron single-instance guard — prevent duplicate processes.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv) => {
    console.log('[main] second-instance launch detected; argv:', argv.slice(1).join(' '))
    if (argv.includes('--settings')) {
      openSettingsWindow()
    }
  })
}

// ─── Chromium / Wayland / Ozone flags ─────────────────────────────────────────
// Must be set before app.ready fires.
// Cross-platform switches (in-process network service, AudioServiceOutOfProcess disable)
// remain merged into single comma-separated enable-features / disable-features lists.
const enableFeatures = ['NetworkServiceInProcess2']
const disableFeatures = ['AudioServiceOutOfProcess']

if (process.platform === 'win32') {
  disableFeatures.push('CalculateNativeWinOcclusion')
}

if (process.platform === 'linux') {
  // Required for proper rendering and portal shortcuts under Linux/Wayland compositors.
  enableFeatures.unshift('UseOzonePlatform', 'GlobalShortcutsPortal')
  app.commandLine.appendSwitch('in-process-gpu')

  // Platform selector:
  // 1. SCREEN_BUDDY_OZONE overrides ('x11' | 'wayland').
  // 2. Otherwise default to 'wayland' if WAYLAND_DISPLAY, HYPRLAND_INSTANCE_SIGNATURE,
  //    or XDG_SESSION_TYPE === 'wayland' is detected.
  // 3. Fall back to 'x11' when session is X11 (XDG_SESSION_TYPE === 'x11' or no WAYLAND_DISPLAY).
  const ozoneOverride = process.env.SCREEN_BUDDY_OZONE // 'x11' | 'wayland' | undefined
  let ozonePlatform = 'wayland'
  if (ozoneOverride === 'x11' || ozoneOverride === 'wayland') {
    ozonePlatform = ozoneOverride
    if (ozoneOverride === 'x11') {
      console.log('[main] ⚠️  XWayland diagnostic mode: ozone-platform=x11')
    }
  } else {
    const isWayland =
      process.env.XDG_SESSION_TYPE === 'wayland' ||
      Boolean(process.env.WAYLAND_DISPLAY) ||
      Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)
    const isX11 =
      process.env.XDG_SESSION_TYPE === 'x11' ||
      (!process.env.WAYLAND_DISPLAY && !process.env.HYPRLAND_INSTANCE_SIGNATURE)

    if (isWayland) {
      ozonePlatform = 'wayland'
    } else if (isX11) {
      ozonePlatform = 'x11'
    } else {
      ozonePlatform = 'wayland'
    }
  }
  app.commandLine.appendSwitch('ozone-platform', ozonePlatform)

  // Allow transparent windows on Wayland
  app.commandLine.appendSwitch('enable-transparent-visuals')
}

app.commandLine.appendSwitch('enable-features', enableFeatures.join(','))
app.commandLine.appendSwitch('disable-features', disableFeatures.join(','))

// ─── Globals ─────────────────────────────────────────────────────────────────
let mainWindow = null
let settingsWindow = null
let pendingSettingsTab = null
let bubbleWindow = null
let bubbleWindowReady = false
let bubbleMapped = false
let bubbleSkipLogged = false
let lastCardState = null // latest snapshot sent by App.jsx via bubble:card-state
let tray = null
let trayHostWatcher = null
let settings = null // loaded from disk at startup
let notificationsManager = null
let stopEyeTrackingPolling = null
let startEyeTrackingPolling = null
let eyeTrackingTimer = null
let updateIdlePollTimer = null
// Manual pause is intentionally not persisted. Fullscreen pause is a separate
// transient reason, so leaving fullscreen never overrides a manual pause.
let isPaused = false
let autoPausedForFullscreen = false
let hyprlandEventSocket = null
let hyprlandEventReconnectTimer = null
let fullscreenSafetyPoll = null
let fullscreenReconcileTimer = null
let isShuttingDown = false
let isQuitting = false
let quitWatchdogTimer = null
let persistSettingsWindowBoundsRef = null
let stopIdlePollTimer = null

let singleInstanceLockReleased = false
function releaseSingleInstanceLock() {
  if (singleInstanceLockReleased) return
  singleInstanceLockReleased = true
  try {
    app.releaseSingleInstanceLock()
  } catch (_) {
    /* ignore */
  }
}

let outOfProcessWatchdogStarted = false
function startOutOfProcessWatchdog() {
  if (process.platform !== 'linux') return
  if (outOfProcessWatchdogStarted) return
  outOfProcessWatchdogStarted = true
  try {
    const parentPid = process.pid
    const cmd = `sleep 4; if kill -0 ${parentPid} 2>/dev/null; then if grep -s -a -i -q screen-buddy /proc/${parentPid}/cmdline 2>/dev/null; then kill -9 ${parentPid} 2>/dev/null; fi; fi`
    const child = require('child_process').spawn('sh', ['-c', cmd], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  } catch (_) {
    /* ignore */
  }
}

function ensureQuitWatchdog() {
  releaseSingleInstanceLock()
  startOutOfProcessWatchdog()
  if (quitWatchdogTimer) return
  quitWatchdogTimer = setTimeout(() => {
    console.log('[main] quit watchdog: forcing exit')
    try {
      app.exit(0)
    } catch (_) { /* ignore */ }
    process.exit(0)
  }, 3000)
}

function destroyAllWindows() {
  console.log('[main] Destroying all remaining windows')
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try {
      if (typeof persistSettingsWindowBoundsRef === 'function') {
        persistSettingsWindowBoundsRef()
      }
    } catch (_) {
      /* ignore */
    }
    try {
      settingsWindow.destroy()
    } catch (_) {
      /* ignore */
    }
    settingsWindow = null
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    try {
      bubbleWindow.destroy()
    } catch (_) {
      /* ignore */
    }
    bubbleWindow = null
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy()
    } catch (_) {
      /* ignore */
    }
    mainWindow = null
  }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.destroy()
        } catch (_) {
          /* ignore */
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
}

let signalHandlersRegistered = false
function setupSignalHandlers() {
  if (signalHandlersRegistered) return
  signalHandlersRegistered = true
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      console.log(`[main] Received ${sig} — quitting application`)
      releaseSingleInstanceLock()
      isQuitting = true
      isShuttingDown = true
      ensureQuitWatchdog()
      destroyAllWindows()
      app.quit()
    })
  }
}
const TRAY_TOOLTIP_UPDATE_INTERVAL_MS = 10 * 1000
let lastTrayTooltipUpdateAt = 0
let lastTrayTooltipMode = null
let typingDetector = null

// ─── Idle / Power State ────────────────────────────────────────────────────
let lastUserActivityTime = Date.now()
let isSystemIdleState = false
let lastKnownCursorX = null
let lastKnownCursorY = null
let lastEyeCursorSampleTime = 0
let lastActivityReason = 'init'
let lastCursorMovedTime = Date.now()
let hyprctlSpawnCount = 0

function noteUserActivity(reason) {
  lastUserActivityTime = Date.now()
  lastActivityReason = reason
  if (isSystemIdleState) {
    isSystemIdleState = false
    console.log(`[power] System active (resumed via ${reason})`)
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('power:idle', false, reason)
    }
  }
}

// ─── Mood State Persistence ────────────────────────────────────────────────
let latestMoodState = null

function getMoodStateFilePath() {
  return path.join(app.getPath('userData'), 'mood-state.json')
}

function getMoodStateTmpPath() {
  return path.join(app.getPath('userData'), 'mood-state.json.tmp')
}

function loadAndCatchUpMoodState() {
  const defaultState = {
    affection: 60,
    energy: 80,
    savedAt: Date.now(),
  }

  try {
    const filePath = getMoodStateFilePath()
    if (!fs.existsSync(filePath)) {
      return defaultState
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return defaultState
    }

    let affection = Number(parsed.affection)
    let energy = Number(parsed.energy)
    const savedAt = Number(parsed.savedAt)

    if (!Number.isFinite(affection) || !Number.isFinite(energy) || !Number.isFinite(savedAt)) {
      return defaultState
    }

    affection = Math.min(100, Math.max(0, affection))
    energy = Math.min(100, Math.max(0, energy))

    const now = Date.now()
    const maxElapsedMs = 4 * 60 * 60 * 1000 // 4 hours
    const elapsed = Math.min(Math.max(0, now - savedAt), maxElapsedMs)

    // Affection decay for elapsed time (1 per 3 min)
    const affectionDecay = elapsed / (3 * 60 * 1000)
    affection = Math.min(100, Math.max(0, affection - affectionDecay))

    // Energy moves toward 70 by at most the same elapsed ratio (simple linear, clamped)
    const elapsedRatio = elapsed / maxElapsedMs
    energy = Math.min(100, Math.max(0, energy + (70 - energy) * elapsedRatio))

    return {
      affection,
      energy,
      savedAt: now,
    }
  } catch (err) {
    console.error('[main] Failed to load mood state, using defaults:', err)
    return defaultState
  }
}

function saveMoodStateToDisk(state) {
  if (!state || typeof state !== 'object') return
  try {
    const userDataDir = app.getPath('userData')
    fs.mkdirSync(userDataDir, { recursive: true })
    const filePath = getMoodStateFilePath()
    const tmpPath = getMoodStateTmpPath()
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    console.error('[main] Failed to save mood state to disk:', err)
  }
}

// ─── Chat state (session-only, never persisted) ───────────────────────────────
// Tracks the current chat UI state so the hotkey watcher can guard correctly.
// Values mirror the renderer chatState: 'idle' | 'input' | 'waiting' | 'reply'
let chatInputOpen = 'idle'
// Ring-buffer: last 10 messages (5 turns) for Gemini context.
let chatHistory = [] // Array of { role: 'user'|'model', parts: [{ text }] }

// Canonical Hyprland / Electron window title. Must match hyprctl title: regexes
// and the windowrulev2 entries in README / hyprland.conf.
const WINDOW_TITLE = 'screen-buddy-overlay'
const HYPR_TITLE_MATCH = `title:^(${WINDOW_TITLE})$`
const HOTKEY_ACCELERATOR = 'Control+Alt+P'
const HOTKEY_CONTROL_FILE = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'screen-buddy-toggle')
const CHAT_HOTKEY_CONTROL_FILE = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'screen-buddy-chat')
const CALL_HOTKEY_CONTROL_FILE = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'screen-buddy-call')

const initialDebugEnv = process.env.SCREEN_BUDDY_DEBUG === '1'

function syncDeveloperMode(devMode) {
  if (devMode || initialDebugEnv) {
    process.env.SCREEN_BUDDY_DEBUG = '1'
  } else {
    delete process.env.SCREEN_BUDDY_DEBUG
  }
}

// The floor overhang is ~66px. We add 100px so main.js doesn't artificially clip 
// the window if the workAreaSize is slightly smaller than the renderer's full 1080 display.
const BOTTOM_OVERHANG_PX = 100

// Bubble window size confirmation poll — same timeout as the cat window.
const BUBBLE_SIZE_POLL_TIMEOUT_MS = 1000
const BUBBLE_SIZE_POLL_INTERVAL_MS = 20

// ─── Click-through state ──────────────────────────────────────────────────────

// Tracks whether the overlay is currently in interactive mode (cursor is over
// the cat / a card). Used by the periodic safety reassertion (see below) to
// avoid stomping an active hover/drag session.
// ROLLBACK: delete isInteractive + passthruInterval + the setInterval block in registerIpcHandlers.
let isInteractive = false
let passthruInterval = null

// ─── Safe settings broadcast ──────────────────────────────────────────────────
/**
 * Return a copy of the settings object with the Gemini API key removed.
 * MUST be used for all broadcasts to renderer windows — the key must never
 * reach any renderer process.
 */
function safeSettingsForRenderer(s) {
  if (!s) return s
  // eslint-disable-next-line no-unused-vars
  const { geminiApiKey, ...safe } = s
  return safe
}

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
  if (!gotLock) return
  setupSignalHandlers()
  settings = loadSettings()
  syncDeveloperMode(Boolean(settings?.developerMode))

  typingDetector = new TypingDetector((channel, event) => {
    noteUserActivity('typing_event')
    // Optional chaining alone is insufficient: a closed BrowserWindow is still
    // a non-null object whose webContents.send() throws "Object has been destroyed".
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, event)
    }
  })

  createOverlayWindow()

  notificationsManager = new NotificationsManager(() => settings, mainWindow, { onShow: showBubbleWindow, onHide: hideBubbleWindow })
  notificationsManager.applySettings()
  trayHostWatcher = watchTrayHost({
    onReady: () => {
      destroyTray()
      if (settings?.showTrayIcon !== false) {
        createTray()
      }
    },
    onLost: () => {
      destroyTray()
    },
  })
  registerIpcHandlers()
  registerPowerMonitor()
  if (process.platform === 'linux') {
    installHyprlandHotkeyFallback()
    installChatHotkeyFallback()
    installCallHotkeyFallback()
    registerGlobalPauseShortcut()
    registerGlobalCallShortcut()
  } else if (process.platform === 'win32') {
    registerWindowsHotkeys()
  } else {
    registerGlobalPauseShortcut()
    registerGlobalCallShortcut()
  }
  startHyprlandFullscreenMonitor()

  if (process.platform === 'win32') {
    const winHelper = require('./winMediaFullscreenHelper')
    winHelper.start({
      limitBackgroundCpu: Boolean(settings?.limitBackgroundCpu),
      onFullscreen: (fullscreen, reason) => {
        console.log(`[fullscreen] state=${fullscreen} reason=${reason}`)
        setFullscreenAutoPause(fullscreen, `Windows ${reason}`)
      },
      onCapabilitiesChanged: () => {
        const caps = getPlatformCapabilities()
        if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
          settingsWindow.webContents.send('platform:capabilities-updated', caps)
        }
      },
    })
  }

  // Monitor display changes (resolution, scaling, connect/disconnect)
  const handleDisplayChange = (eventType) => {
    logDisplayMetrics(eventType)
    restoreMascotPositionOnResume(eventType)
    sendDisplayGeometryToRenderer()
  }
  electronScreen.on('display-added', () => handleDisplayChange('display-added'))
  electronScreen.on('display-removed', () => handleDisplayChange('display-removed'))
  electronScreen.on('display-metrics-changed', () => handleDisplayChange('display-metrics-changed'))

  // Apply saved autostart preference on launch
  if (app.isPackaged) {
    if (process.platform === 'linux' && process.env.APPIMAGE) {
      if (settings.autostart) {
        if (!repairAutostartExecIfNeeded(undefined, settings.autostart)) {
          setAutostart()
        }
      }
    } else if (settings.autostart) {
      setAutostart()
    }
  }

  // Start typing detection based on initial settings
  typingDetector.updateSettings(settings)

  // Start media playback monitor — sends real-time updates to renderer
  mediaMonitor.start((status) => {
    mainWindow?.webContents.send('media:status', status)
  })

  initUpdater({
    getSettings: () => settings,
    broadcast: (state) => {
      if (isShuttingDown) return
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('updates:state', state)
      }
      if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
        settingsWindow.webContents.send('updates:state', state)
      }
    },
    onCheckPersisted: (ts) => {
      if (isShuttingDown || !settings) return
      settings = { ...settings, lastUpdateCheck: ts }
      saveSettings(settings)
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('settings:updated', settings)
      }
      if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
        settingsWindow.webContents.send('settings:updated', settings)
      }
    },
  })

  mainWindow?.webContents.on('did-finish-load', () => {
    const current = mediaMonitor.getStatus()
    if (current && (current.playing || current.title || current.artist)) {
      mainWindow?.webContents.send('media:status', current)
    }
    sendDisplayGeometryToRenderer()

    if (process.env.SCREEN_BUDDY_DEBUG === '1' && process.env.SCREEN_BUDDY_DEBUG_OPEN) {
      const target = String(process.env.SCREEN_BUDDY_DEBUG_OPEN).trim().toLowerCase()
      setTimeout(() => {
        if (isShuttingDown || isQuitting) return
        console.log(`[debug] SCREEN_BUDDY_DEBUG_OPEN=${target} triggering`)
        if (target.includes('settings')) {
          openSettingsWindow()
        }
        if (target.includes('chat')) {
          triggerChatOpen('debug-hook')
        }
        if (target.includes('call')) {
          triggerCallCat()
        }
      }, 600)
    }

    if (process.env.SCREEN_BUDDY_DEBUG === '1' && process.env.SCREEN_BUDDY_DEBUG_QUIT_TRAY === '1') {
      const delay = Number(process.env.SCREEN_BUDDY_DEBUG_QUIT_TRAY_DELAY_MS) || 2000
      setTimeout(() => {
        if (isShuttingDown || isQuitting) return
        console.log('[debug] SCREEN_BUDDY_DEBUG_QUIT_TRAY triggering tray quit')
        const quitItem = global.__sbDebugTrayMenu?.items?.find((item) => item.label && item.label.includes('Exit'))
        if (quitItem && typeof quitItem.click === 'function') {
          quitItem.click()
        } else {
          app.quit()
        }
      }, delay)
    }

    if (process.env.SCREEN_BUDDY_DEBUG === '1' && process.env.SCREEN_BUDDY_DEBUG_CLOSE_OVERLAY === '1') {
      const delay = Number(process.env.SCREEN_BUDDY_DEBUG_CLOSE_OVERLAY_DELAY_MS) || 2000
      setTimeout(() => {
        if (isShuttingDown || isQuitting) return
        console.log('[debug] SCREEN_BUDDY_DEBUG_CLOSE_OVERLAY triggering mainWindow.close()')
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close()
        }
      }, delay)
    }
  })

  if (process.argv.includes('--settings')) {
    openSettingsWindow()
  }

  if (process.env.SCREEN_BUDDY_DEBUG === '1') {
    global.__sbDebugSetCursor = (pt) => {
      debugCursorOverride = pt ? { x: pt.x, y: pt.y } : null
    }
    global.__sbDebugTriggerCall = () => triggerCallCat()
    global.__sbDebugTriggerChat = () => triggerChatOpen('debug-hook')
    global.__sbDebugGetCallWatch = () => activeCallWatch ? { callId: activeCallWatch.callId, anchorX: activeCallWatch.anchorX, anchorY: activeCallWatch.anchorY } : null
    global.__sbDebugCloseOverlay = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close()
      }
    }
  }
  const isDevDebug = !app.isPackaged && (process.env.SCREEN_BUDDY_DEBUG === '1' || Boolean(settings?.developerMode))
  if (isDevDebug) {
    startDevCpuLogging()
    setTimeout(() => logAppMetrics('30s-after-ready'), 30000)
    let memTimerCount = 0
    const memTimer = setInterval(() => {
      memTimerCount++
      logAppMetrics(`${memTimerCount * 2}min`)
      if (memTimerCount >= 6) {
        clearInterval(memTimer)
      }
    }, 120000)
    if (memTimer.unref) memTimer.unref()
  }
})

function logAppMetrics(context = '') {
  if (process.env.SCREEN_BUDDY_DEBUG !== '1' && !settings?.developerMode) return
  try {
    const metrics = app.getAppMetrics()
    const memUsage = process.memoryUsage()
    const toMb = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    const kbToMb = (kb) => (kb / 1024).toFixed(1) + ' MB'

    let overlayPid = null
    let bubblesPid = null
    let settingsPid = null
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      try { overlayPid = mainWindow.webContents.getOSProcessId() } catch (err) { void err }
    }
    if (bubbleWindow && !bubbleWindow.isDestroyed() && !bubbleWindow.webContents.isDestroyed()) {
      try { bubblesPid = bubbleWindow.webContents.getOSProcessId() } catch (err) { void err }
    }
    if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
      try { settingsPid = settingsWindow.webContents.getOSProcessId() } catch (err) { void err }
    }

    const tag = context ? `:${context}` : ''
    console.log(`[mem${tag}] Main process memory: heapUsed=${toMb(memUsage.heapUsed)}, external=${toMb(memUsage.external)}, arrayBuffers=${toMb(memUsage.arrayBuffers)}, rss=${toMb(memUsage.rss)}`)

    for (const m of metrics) {
      let role = m.type
      if (m.type === 'Tab') {
        if (overlayPid && m.pid === overlayPid) role = 'Renderer:Overlay'
        else if (bubblesPid && m.pid === bubblesPid) role = 'Renderer:Bubbles'
        else if (settingsPid && m.pid === settingsPid) role = 'Renderer:Settings'
        else role = 'Renderer:Tab'
      }
      const nameStr = m.name ? ` (${m.name})` : ''
      const ws = kbToMb(m.memory.workingSetSize)
      const pb = m.memory.privateBytes ? ` priv=${kbToMb(m.memory.privateBytes)}` : ''
      console.log(`[mem${tag}]   PID ${m.pid} | ${role}${nameStr} | workingSet=${ws}${pb}`)
    }
  } catch (err) {
    console.warn('[mem] getAppMetrics logging failed:', err.message)
  }
}

let devCpuInterval = null

function startDevCpuLogging() {
  if (app.isPackaged) return
  if (devCpuInterval) return

  devCpuInterval = setInterval(() => {
    try {
      const metrics = app.getAppMetrics()
      let overlayPid = null
      let bubblesPid = null
      let settingsPid = null

      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        try {
          overlayPid = mainWindow.webContents.getOSProcessId()
        } catch (err) {
          void err
        }
      }
      if (bubbleWindow && !bubbleWindow.isDestroyed() && !bubbleWindow.webContents.isDestroyed()) {
        try {
          bubblesPid = bubbleWindow.webContents.getOSProcessId()
        } catch (err) {
          void err
        }
      }
      if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
        try {
          settingsPid = settingsWindow.webContents.getOSProcessId()
        } catch (err) {
          void err
        }
      }

      let mainCpu = 0
      let overlayCpu = 0
      let bubblesCpu = 0
      let settingsCpu = 0
      let gpuCpu = 0
      let otherCpu = 0
      let totalCpu = 0

      for (const m of metrics) {
        const usage = m.cpu?.percentCPUUsage || 0
        totalCpu += usage
        if (m.type === 'Browser') {
          mainCpu += usage
        } else if (m.type === 'GPU') {
          gpuCpu += usage
        } else if (m.type === 'Tab') {
          if (overlayPid && m.pid === overlayPid) {
            overlayCpu += usage
          } else if (bubblesPid && m.pid === bubblesPid) {
            bubblesCpu += usage
          } else if (settingsPid && m.pid === settingsPid) {
            settingsCpu += usage
          } else {
            otherCpu += usage
          }
        } else {
          otherCpu += usage
        }
      }

      const r = (val) => val.toFixed(1)
      console.log(`[cpu] main=${r(mainCpu)}% overlay=${r(overlayCpu)}% bubbles=${r(bubblesCpu)}% settings=${r(settingsCpu)}% gpu=${r(gpuCpu)}% other=${r(otherCpu)}% total=${r(totalCpu)}%`)
    } catch (err) {
      void err
    }
  }, 15000)
}

// Quit when all windows are closed (shouldn't normally happen for an overlay,
// but keeps the app well-behaved during development).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Clean up child processes before exit
app.on('will-quit', () => {
  console.log('[main] Application shutting down (will-quit)')
  isShuttingDown = true
  isQuitting = true
  ensureQuitWatchdog()

  if (devCpuInterval) {
    clearInterval(devCpuInterval)
    devCpuInterval = null
  }
  if (passthruInterval) {
    clearInterval(passthruInterval)
    passthruInterval = null
  }
  if (trayRetryTimeout) {
    clearTimeout(trayRetryTimeout)
    trayRetryTimeout = null
  }

  // Stop typing detection first — kills any /dev/input 'cat' child processes
  // and nulls the IPC sender so no destroyed-webContents errors can fire.
  // stop() is idempotent; safe to call even if never started.
  try {
    typingDetector?.stop()
  } catch (err) {
    console.warn('[cleanup] typingDetector stop error:', err.message)
  }

  try {
    stopCallCursorWatch()
  } catch (err) {
    console.warn('[cleanup] stopCallCursorWatch error:', err.message)
  }

  try {
    mediaMonitor.stop()
  } catch (err) {
    console.warn('[cleanup] mediaMonitor stop error:', err.message)
  }

  if (process.platform === 'win32') {
    try {
      require('./winMediaFullscreenHelper').stop()
    } catch (_) {
      /* ignore helper cleanup errors */
    }
    try {
      typingDetector?._uiohookProvider?.stop()
    } catch (_) {
      /* ignore uiohook stop errors */
    }
  }

  try {
    destroyTray()
  } catch (err) {
    console.warn('[cleanup] destroyTray error:', err.message)
  }

  try {
    notificationsManager?.stop()
  } catch (err) {
    console.warn('[cleanup] notificationsManager stop error:', err.message)
  }

  try {
    cleanupUpdater()
  } catch (err) {
    console.warn('[cleanup] cleanupUpdater error:', err.message)
  }

  try {
    trayHostWatcher?.stop()
  } catch (err) {
    console.warn('[cleanup] trayHostWatcher stop error:', err.message)
  }

  try {
    globalShortcut.unregisterAll()
  } catch (err) {
    console.warn('[cleanup] globalShortcut unregister error:', err.message)
  }

  try {
    stopHyprlandFullscreenMonitor()
  } catch (err) {
    console.warn('[cleanup] stopHyprlandFullscreenMonitor error:', err.message)
  }

  if (process.platform === 'linux') {
    try { removeHyprlandHotkeyFallback() } catch (err) { console.warn('[cleanup] removeHyprlandHotkeyFallback error:', err.message) }
    try { removeChatHotkeyFallback() } catch (err) { console.warn('[cleanup] removeChatHotkeyFallback error:', err.message) }
    try { stopEyeTrackingPolling?.() } catch (err) { console.warn('[cleanup] stopEyeTrackingPolling error:', err.message) }
    try { stopIdlePollTimer?.() } catch (err) { console.warn('[cleanup] stopIdlePollTimer error:', err.message) }
    try { removeCallHotkeyFallback() } catch (err) { console.warn('[cleanup] removeCallHotkeyFallback error:', err.message) }
  } else {
    try { stopEyeTrackingPolling?.() } catch (err) { console.warn('[cleanup] stopEyeTrackingPolling error:', err.message) }
    try { stopIdlePollTimer?.() } catch (err) { console.warn('[cleanup] stopIdlePollTimer error:', err.message) }
  }

  if (latestMoodState) {
    try {
      saveMoodStateToDisk(latestMoodState)
    } catch (err) {
      console.warn('[cleanup] saveMoodStateToDisk error:', err.message)
    }
  }
  console.log('[main] Cleanup completed (will-quit)')
})

app.on('quit', (event, exitCode) => {
  if (process.env.SCREEN_BUDDY_DEBUG === '1') {
    console.log(`[main] quit event (exitCode=${exitCode})`)
    console.log('[updater] fake autoInstallOnAppQuit triggered on quit event')
  }
  if (process.platform === 'linux') {
    setImmediate(() => {
      try {
        process.exit(typeof exitCode === 'number' ? exitCode : 0)
      } catch (_) {
        /* ignore */
      }
    })
  }
})

let beforeQuitHandled = false
app.on('before-quit', () => {
  releaseSingleInstanceLock()
  if (beforeQuitHandled) return
  beforeQuitHandled = true
  console.log('[main] Quitting application (before-quit)')
  isQuitting = true
  isShuttingDown = true
  ensureQuitWatchdog()

  if (latestMoodState) {
    try {
      saveMoodStateToDisk(latestMoodState)
    } catch (err) {
      console.warn('[main] saveMoodStateToDisk error:', err.message)
    }
  }

  destroyAllWindows()
})

// ─── Pause / fullscreen / hotkey state ──────────────────────────────────────
let isParked = false
let preParkSavedPos = null // { x, y }
let parkBubbleVisible = false // whether bubble window was visible when parked

async function getOverlayDiagnosticInfo() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    if (!mainWindow || mainWindow.isDestroyed()) return 'window=null/destroyed'
    const bounds = mainWindow.getBounds()
    return `mapped=${mainWindow.isVisible()} at=[${bounds.x},${bounds.y}] size=[${bounds.width},${bounds.height}]`
  }
  try {
    const { stdout } = await execFileAsync('hyprctl', ['clients', '-j'])
    const clients = JSON.parse(stdout)
    if (!Array.isArray(clients)) return 'clients=invalid'
    const overlay = clients.find((c) => c?.title === WINDOW_TITLE && (c?.floating === true || clients.filter((k) => k?.title === WINDOW_TITLE).length === 1))
      || clients.find((c) => c?.title === WINDOW_TITLE)
    if (!overlay) return 'overlay=not-found'
    return `mapped=${overlay.mapped} hidden=${overlay.hidden} pinned=${overlay.pinned} ws=${overlay.workspace?.id} at=[${overlay.at?.[0]},${overlay.at?.[1]}] size=[${overlay.size?.[0]},${overlay.size?.[1]}] focusHistoryID=${overlay.focusHistoryID}`
  } catch (err) {
    return `error=${err.message}`
  }
}

async function logParkDiagnostic(action, reason, method, phase) {
  const info = await getOverlayDiagnosticInfo()
  console.log(`[park] ${action}:${phase} reason=${reason} method=${method} ${info}`)
}

async function park(reason) {
  if (isParked) return
  isParked = true

  const isHyprland = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)
  if (!isHyprland) {
    await logParkDiagnostic('park', reason, 'hide', 'before')
    mainWindow?.hide()
    if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
      parkBubbleVisible = true
      bubbleMapped = false
      bubbleWindow.hide()
    } else {
      parkBubbleVisible = false
    }
    setTimeout(() => {
      logParkDiagnostic('park', reason, 'hide', 'after')
    }, 300)
    return
  }

  // Hyprland session: keep window mapped, alpha 0 + offscreen (-3000, -3000)
  preParkSavedPos = {
    x: lastKnownCatWinX,
    y: lastKnownCatWinY,
  }

  // Ignore mouse events while parked so clicks and hovers pass right through
  try {
    mainWindow?.setIgnoreMouseEvents(true)
  } catch (err) {
    if (process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.warn('[park] setIgnoreMouseEvents(true) failed:', err.message)
    }
  }

  await logParkDiagnostic('park', reason, 'alpha+offscreen', 'before')

  // Park overlay: set alpha 0 and move offscreen
  try {
    await execFileAsync('hyprctl', ['dispatch', 'setprop', `title:^(${WINDOW_TITLE})$`, 'alpha', '0', 'lock'])
    await execFileAsync('hyprctl', ['dispatch', 'setprop', `title:^(${WINDOW_TITLE})$`, 'alphainactive', '0', 'lock'])
    await execFileAsync('hyprctl', ['dispatch', 'setprop', `title:^(${WINDOW_TITLE})$`, 'alphafullscreen', '0', 'lock'])
    await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', `exact -3000 -3000,title:^(${WINDOW_TITLE})$`])
  } catch (err) {
    console.warn('[park] overlay park commands failed:', err.message)
  }

  // Park bubbles window if mapped/visible
  if (bubbleMapped || (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible())) {
    parkBubbleVisible = true
    try {
      bubbleWindow?.setIgnoreMouseEvents(true)
      await execFileAsync('hyprctl', ['dispatch', 'setprop', 'title:^(screen-buddy-bubbles)$', 'alpha', '0', 'lock'])
      await execFileAsync('hyprctl', ['dispatch', 'setprop', 'title:^(screen-buddy-bubbles)$', 'alphainactive', '0', 'lock'])
      await execFileAsync('hyprctl', ['dispatch', 'setprop', 'title:^(screen-buddy-bubbles)$', 'alphafullscreen', '0', 'lock'])
      await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', 'exact -3000 -3000,title:^(screen-buddy-bubbles)$'])
      console.log('[park] parked bubbles window (alpha 0 + offscreen)')
    } catch (err) {
      console.warn('[park] bubbles park failed:', err.message)
    }
  } else {
    parkBubbleVisible = false
  }

  setTimeout(() => {
    logParkDiagnostic('park', reason, 'alpha+offscreen', 'after')
  }, 300)
}

async function unpark(reason) {
  if (reason === 'quit') return
  if (!isParked) return
  isParked = false

  const isHyprland = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)

  if (!isHyprland) {
    if (reason === 'quit') return
    await logParkDiagnostic('unpark', reason, 'hide', 'before')
    mainWindow?.showInactive()
    if (parkBubbleVisible && bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleMapped = false
      bubbleWindow.showInactive()
      positionBubbleWindow()
    }
    parkBubbleVisible = false
    setTimeout(() => {
      logParkDiagnostic('unpark', reason, 'hide', 'after')
    }, 300)
    return
  }

  await logParkDiagnostic('unpark', reason, 'alpha+offscreen', 'before')

  // Move overlay back to pre-park position
  const restoreX = preParkSavedPos?.x ?? lastKnownCatWinX
  const restoreY = preParkSavedPos?.y ?? lastKnownCatWinY
  if (restoreX !== null && restoreY !== null) {
    try {
      await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', `exact ${restoreX} ${restoreY},title:^(${WINDOW_TITLE})$`])
    } catch (err) {
      console.warn('[park] offscreen restore move failed:', err.message)
    }
  }

  // Restore overlay alpha
  try {
    await execFileAsync('hyprctl', ['dispatch', 'setprop', `title:^(${WINDOW_TITLE})$`, 'alpha', '1', 'lock'])
    await execFileAsync('hyprctl', ['dispatch', 'setprop', `title:^(${WINDOW_TITLE})$`, 'alphainactive', '1', 'lock'])
    await execFileAsync('hyprctl', ['dispatch', 'setprop', `title:^(${WINDOW_TITLE})$`, 'alphafullscreen', '1', 'lock'])
  } catch (err) {
    if (process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.warn('[park] setprop restore alpha error:', err.message)
    }
  }

  // Restore mouse interactions
  try {
    mainWindow?.setIgnoreMouseEvents(false)
  } catch (err) {
    if (process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.warn('[park] setIgnoreMouseEvents(false) failed:', err.message)
    }
  }

  // Unpark bubbles window if it was parked
  if (parkBubbleVisible) {
    parkBubbleVisible = false
    try {
      bubbleWindow?.setIgnoreMouseEvents(false)
      await execFileAsync('hyprctl', ['dispatch', 'setprop', 'title:^(screen-buddy-bubbles)$', 'alpha', '1', 'lock'])
      await execFileAsync('hyprctl', ['dispatch', 'setprop', 'title:^(screen-buddy-bubbles)$', 'alphainactive', '1', 'lock'])
      await execFileAsync('hyprctl', ['dispatch', 'setprop', 'title:^(screen-buddy-bubbles)$', 'alphafullscreen', '1', 'lock'])
      await positionBubbleWindow(restoreX, restoreY)
      console.log('[park] unparked bubbles window (restored alpha 1 + position)')
    } catch (err) {
      console.warn('[park] bubbles unpark failed:', err.message)
    }
  }

  // If a card arrived while parked, display it now
  if (lastCardState && lastCardState.hasContent && bubbleWindow && !bubbleWindow.isDestroyed()) {
    if (!bubbleWindow.isVisible() && bubbleWindowReady && !notificationsManager?.activeNotification) {
      bubbleMapped = false
      bubbleSkipLogged = false
      bubbleWindow.showInactive()
      waitForBubbleMapped().then(async () => {
        if (currentBubbleW !== 300 || currentBubbleH !== 120) {
          await applyBubbleWindowSize(currentBubbleW, currentBubbleH)
        } else {
          await positionBubbleWindow()
        }
      }).catch((err) => {
        console.warn('[bubble] deferred card show failed on unpark:', err.message)
      })
    }
  }

  // Always run reRaiseAndPinWindows sequence at 0, 120, 400, and 900 ms on unpark
  triggerRaiseSequence('unpark')

  // Post-unpark verification at 300ms
  setTimeout(async () => {
    const info = await getOverlayDiagnosticInfo()
    console.log(`[park] unpark:after reason=${reason} method=alpha+offscreen ${info}`)

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE && !isShuttingDown) {
      try {
        const { stdout } = await execFileAsync('hyprctl', ['clients', '-j'])
        const clients = JSON.parse(stdout)
        if (Array.isArray(clients)) {
          const overlay = clients.find((c) => c?.title === WINDOW_TITLE && (c?.floating === true || clients.filter((k) => k?.title === WINDOW_TITLE).length === 1))
            || clients.find((c) => c?.title === WINDOW_TITLE)
          const expectedX = preParkSavedPos?.x ?? lastKnownCatWinX
          const expectedY = preParkSavedPos?.y ?? lastKnownCatWinY
          const posOk = overlay && expectedX !== null && expectedY !== null &&
            overlay.at?.[0] === expectedX && overlay.at?.[1] === expectedY
          const isOk = overlay && overlay.mapped === true && overlay.pinned === true && posOk

          if (!isOk) {
            console.log(`[park] unpark anomaly detected (mapped=${overlay?.mapped} pinned=${overlay?.pinned} at=${JSON.stringify(overlay?.at)} expected=[${expectedX},${expectedY}]); running recovery restore+repin+reraise`)
            await restoreMascotPositionOnResume('unpark-anomaly')
            await reRaiseAndPinWindows('unpark-anomaly')
          }
        }
      } catch (err) {
        if (process.env.SCREEN_BUDDY_DEBUG === '1') {
          console.warn('[park] unpark verification check error:', err.message)
        }
      }
    }
  }, 300)
}

function triggerRaiseSequence(label) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  const delays = [0, 120, 400, 900]
  for (const ms of delays) {
    if (ms === 0) {
      if (!isParked && !isShuttingDown) {
        reRaiseAndPinWindows(`${label}:${ms}ms`)
      }
    } else {
      setTimeout(() => {
        if (!isParked && !isShuttingDown) {
          reRaiseAndPinWindows(`${label}:${ms}ms`)
        }
      }, ms)
    }
  }
}

function effectivePauseState() {
  return isPaused || autoPausedForFullscreen
}

function broadcastPauseState(source) {
  const paused = effectivePauseState()
  if (paused) {
    stopCallCursorWatch()
  }
  mainWindow?.webContents.send('tray:pause-state', paused)
  notificationsManager?.setPaused(paused)
  typingDetector?.setPaused(paused)

  if (paused) {
    park(autoPausedForFullscreen ? 'fullscreen' : 'manual')
  } else {
    unpark('resume')
  }

  buildTrayMenu()
  console.log(`[main] Pause state updated by ${source}: manual=${isPaused} fullscreen=${autoPausedForFullscreen} effective=${paused}`)
}

function setManualPaused(paused, source) {
  const next = Boolean(paused)
  if (isPaused === next) return
  isPaused = next
  broadcastPauseState(source)
}

function toggleManualPause(source) {
  setManualPaused(!isPaused, source)
}

function setFullscreenAutoPause(paused, source) {
  const next = Boolean(paused)
  if (autoPausedForFullscreen === next) return
  autoPausedForFullscreen = next
  broadcastPauseState(source)
}

function getPlatformCapabilities() {
  if (process.platform === 'win32') {
    const winHelper = require('./winMediaFullscreenHelper')
    const helperCaps = winHelper.getCapabilities()
    return {
      typing: typingDetector ? typingDetector.getCapabilityStatus() : { available: false, reason: 'Typing detector not initialized' },
      media: helperCaps.media,
      fullscreen: helperCaps.fullscreen,
      autostart: getAutostartStatus(),
    }
  }
  return {
    typing: { available: true },
    media: { available: true },
    fullscreen: { available: true },
    autostart: getAutostartStatus(),
  }
}

function registerGlobalPauseShortcut() {
  // Electron 32 requires this portal feature on native Wayland. Hyprland may
  // still decline it, so the documented control-file bind remains available.
  const registered = globalShortcut.register(HOTKEY_ACCELERATOR, () => {
    console.log(`[main] globalShortcut callback fired for ${HOTKEY_ACCELERATOR}`)
    toggleManualPause('globalShortcut')
  })
  const isRegistered = globalShortcut.isRegistered(HOTKEY_ACCELERATOR)
  console.log(`[main] globalShortcut.register(${HOTKEY_ACCELERATOR}) => ${registered}; isRegistered => ${isRegistered}`)
  if (!registered || !isRegistered) {
    console.warn(`[main] Global shortcut unavailable on this Wayland session; use the documented Hyprland control-file bind.`)
  }
}

function installHyprlandHotkeyFallback() {
  if (process.platform !== 'linux') return
  try {
    fs.writeFileSync(HOTKEY_CONTROL_FILE, '', { mode: 0o600 })
    fs.watchFile(HOTKEY_CONTROL_FILE, { interval: 250 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return
      console.log('[main] Hyprland hotkey control file changed; toggling manual pause')
      toggleManualPause('Hyprland control file')
    })
    console.log(`[main] Hyprland hotkey fallback ready; control file: ${HOTKEY_CONTROL_FILE}`)
  } catch (err) {
    console.error('[main] Could not create Hyprland hotkey control file:', err)
  }
}

function removeHyprlandHotkeyFallback() {
  if (process.platform !== 'linux') return
  try {
    fs.unwatchFile(HOTKEY_CONTROL_FILE)
    if (fs.existsSync(HOTKEY_CONTROL_FILE)) fs.unlinkSync(HOTKEY_CONTROL_FILE)
  } catch (err) {
    console.warn('[main] Could not remove Hyprland hotkey control file:', err.message)
  }
}

// ─── Chat hotkey (SUPER+C via Hyprland control file) ─────────────────────────

function installChatHotkeyFallback() {
  if (process.platform !== 'linux') return
  try {
    fs.writeFileSync(CHAT_HOTKEY_CONTROL_FILE, '', { mode: 0o600 })
    fs.watchFile(CHAT_HOTKEY_CONTROL_FILE, { interval: 250 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return

      // Guard 1: global pause (manual or fullscreen auto-pause)
      if (effectivePauseState()) {
        console.log('[main] Chat hotkey ignored — app is paused')
        return
      }

      // Guard 2: still waiting for a Gemini reply — ignore a second trigger
      if (chatInputOpen === 'waiting') {
        console.log('[main] Chat hotkey ignored — waiting for Gemini reply')
        return
      }

      console.log('[main] Chat hotkey triggered; chatInputOpen=%s', chatInputOpen)
      mainWindow?.webContents.send('chat:open')

      // Focus only when opening the input (not when toggling a reply off).
      // When chatInputOpen is 'reply' the renderer will dismiss it; no focus needed.
      // Focus is now handled asynchronously when chat:state reaches main process
    })
    console.log(`[main] Chat hotkey fallback ready; control file: ${CHAT_HOTKEY_CONTROL_FILE}`)
  } catch (err) {
    console.error('[main] Could not create chat hotkey control file:', err)
  }
}

function removeChatHotkeyFallback() {
  if (process.platform !== 'linux') return
  try {
    fs.unwatchFile(CHAT_HOTKEY_CONTROL_FILE)
    if (fs.existsSync(CHAT_HOTKEY_CONTROL_FILE)) fs.unlinkSync(CHAT_HOTKEY_CONTROL_FILE)
  } catch (err) {
    console.warn('[main] Could not remove chat hotkey control file:', err.message)
  }
}

// ─── Call cat hotkey (CTRL+ALT+C via Hyprland control file / globalShortcut) ─

const CALL_CANCEL_MOVE_PX = 60
const CALL_WATCH_INTERVAL_MS = 100
const HYPR_CALL_WATCH_INTERVAL_MS = 125
let callWatchSeq = 0
let activeCallWatch = null
let debugCursorOverride = null

function isValidCursorPoint(pt) {
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false
  const displays = electronScreen.getAllDisplays()
  return displays.some((d) => {
    const b = d?.bounds
    return b && pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height
  })
}

async function readCurrentCursorPoint() {
  if (process.env.SCREEN_BUDDY_DEBUG === '1' && debugCursorOverride) {
    return { ...debugCursorOverride }
  }
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    if (
      eyeTrackingTimer &&
      lastKnownCursorX != null &&
      lastKnownCursorY != null &&
      Date.now() - lastEyeCursorSampleTime < 250
    ) {
      return { x: lastKnownCursorX, y: lastKnownCursorY }
    }
    try {
      hyprctlSpawnCount++
      const { stdout } = await execFileAsync('hyprctl', ['cursorpos'])
      const trimmed = (stdout || '').trim()
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed)
        return { x: parsed.x, y: parsed.y }
      }
      const parts = trimmed.split(/[\s,]+/).map(Number)
      return { x: parts[0] || 0, y: parts[1] || 0 }
    } catch (_e) {
      return electronScreen.getCursorScreenPoint()
    }
  }
  return electronScreen.getCursorScreenPoint()
}

function stopCallCursorWatch() {
  if (!activeCallWatch) return
  if (activeCallWatch.timer) clearTimeout(activeCallWatch.timer)
  if (activeCallWatch.safetyTimer) clearTimeout(activeCallWatch.safetyTimer)
  activeCallWatch = null
}

function startCallCursorWatch(callId, anchorX, anchorY) {
  stopCallCursorWatch()
  const intervalMs = process.env.HYPRLAND_INSTANCE_SIGNATURE
    ? HYPR_CALL_WATCH_INTERVAL_MS
    : CALL_WATCH_INTERVAL_MS
  const watch = {
    callId,
    anchorX,
    anchorY,
    timer: null,
    safetyTimer: setTimeout(() => {
      if (activeCallWatch?.callId === callId) stopCallCursorWatch()
    }, 30000),
  }
  activeCallWatch = watch

  const tick = async () => {
    if (!activeCallWatch || activeCallWatch.callId !== callId) return
    if (isShuttingDown || effectivePauseState() || !mainWindow || mainWindow.isDestroyed()) {
      stopCallCursorWatch()
      return
    }
    try {
      const pt = await readCurrentCursorPoint()
      if (!activeCallWatch || activeCallWatch.callId !== callId) return
      if (isValidCursorPoint(pt)) {
        const movedPx = Math.hypot(pt.x - watch.anchorX, pt.y - watch.anchorY)
        if (movedPx > CALL_CANCEL_MOVE_PX) {
          const roundedMove = Math.round(movedPx)
          stopCallCursorWatch()
          console.log(`[call] cancelled: cursor moved ${roundedMove}px`)
          if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('mascot:call-cancel', { callId, movedPx: roundedMove })
          }
          return
        }
      }
    } catch (_) {
      /* ignore transient cursor query errors */
    }
    if (activeCallWatch && activeCallWatch.callId === callId) {
      watch.timer = setTimeout(tick, intervalMs)
    }
  }

  watch.timer = setTimeout(tick, intervalMs)
}

async function triggerCallCat() {
  if (effectivePauseState()) {
    console.log('[main] Call cat ignored — app is paused')
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const pt = await readCurrentCursorPoint()
    if (!isValidCursorPoint(pt)) {
      console.log(`[call] ignored invalid cursor point (${pt?.x}, ${pt?.y})`)
      return
    }
    const cursorX = pt.x
    const cursorY = pt.y
    const callId = ++callWatchSeq
    startCallCursorWatch(callId, cursorX, cursorY)
    console.log(`[main] Call cat triggered at cursor (${cursorX}, ${cursorY})`)
    mainWindow.webContents.send('mascot:call', { callId, cursorX, cursorY })
  } catch (err) {
    console.warn('[main] Call cat failed:', err.message)
  }
}

function installCallHotkeyFallback() {
  if (process.platform !== 'linux') return
  try {
    fs.writeFileSync(CALL_HOTKEY_CONTROL_FILE, '', { mode: 0o600 })
    fs.watchFile(CALL_HOTKEY_CONTROL_FILE, { interval: 250 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return
      triggerCallCat()
    })
    console.log(`[main] Call cat fallback ready; control file: ${CALL_HOTKEY_CONTROL_FILE}`)
  } catch (err) {
    console.error('[main] Could not create call cat hotkey control file:', err)
  }
}

function removeCallHotkeyFallback() {
  if (process.platform !== 'linux') return
  try {
    fs.unwatchFile(CALL_HOTKEY_CONTROL_FILE)
    if (fs.existsSync(CALL_HOTKEY_CONTROL_FILE)) fs.unlinkSync(CALL_HOTKEY_CONTROL_FILE)
  } catch (err) {
    console.warn('[main] Could not remove call cat hotkey control file:', err.message)
  }
}

let shortcutRegistrationStatus = {}

function toElectronAccelerator(accel) {
  if (typeof accel !== 'string') return ''
  return accel
    .split('+')
    .map((part) => {
      const trimmed = part.trim()
      if (/^ctrl$/i.test(trimmed)) return 'Control'
      if (/^win$/i.test(trimmed)) return 'Super'
      return trimmed
    })
    .filter(Boolean)
    .join('+')
}

function triggerChatOpen(source = 'unknown') {
  console.log(`[chat] open requested via ${source} (chatInputOpen=${chatInputOpen}, paused=${effectivePauseState()}, chatEnabled=${settings?.chatEnabled !== false})`)
  if (effectivePauseState()) {
    console.log(`[chat] open ignored (${source}) — app is paused`)
    return
  }
  if (settings?.chatEnabled === false) {
    console.log(`[chat] open ignored (${source}) — chatEnabled is false`)
    return
  }
  if (chatInputOpen === 'waiting') {
    console.log(`[chat] open ignored (${source}) — waiting for Gemini reply`)
    return
  }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('chat:open', source)
    console.log(`[chat] sent chat:open to overlay (${source})`)
  }
}

function registerWindowsHotkeys() {
  if (process.platform !== 'win32') return
  globalShortcut.unregisterAll()
  const specs = [
    { key: 'shortcutCallCat', label: 'Call cat', handler: () => triggerCallCat() },
    { key: 'shortcutTogglePause', label: 'Toggle pause', handler: () => toggleManualPause('globalShortcut') },
    { key: 'shortcutChat', label: 'Open AI chat', handler: () => triggerChatOpen('hotkey') },
  ]
  const nextStatus = {}
  for (const spec of specs) {
    const rawAccel = settings?.[spec.key] || DEFAULT_SETTINGS[spec.key]
    const electronAccel = toElectronAccelerator(rawAccel)
    let ok = false
    try {
      const registered = electronAccel ? globalShortcut.register(electronAccel, spec.handler) : false
      const isReg = electronAccel ? globalShortcut.isRegistered(electronAccel) : false
      ok = Boolean(registered && isReg)
    } catch (_err) {
      ok = false
    }
    if (ok) {
      console.log(`[hotkey] registered ${spec.key} (${rawAccel})`)
      nextStatus[spec.key] = { accelerator: rawAccel, registered: true, error: null }
    } else {
      console.warn(`[hotkey] failed to register ${rawAccel} (in use by another app)`)
      nextStatus[spec.key] = { accelerator: rawAccel, registered: false, error: 'In use by another app' }
    }
  }
  shortcutRegistrationStatus = nextStatus
  if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isDestroyed()) {
    settingsWindow.webContents.send('shortcuts:status-updated', shortcutRegistrationStatus)
  }
}

function registerGlobalCallShortcut() {
  const callShortcut = toElectronAccelerator(settings?.shortcutCallCat || 'Control+Alt+C')
  try {
    globalShortcut.register(callShortcut, () => {
      triggerCallCat()
    })
  } catch (_err) {
    // Ignore globalShortcut errors on Wayland
  }
}

/**
 * Focus the overlay window so the chat input can receive key events.
 * On Hyprland/Wayland, hyprctl dispatch focuswindow is more reliable than
 * Electron's bubbleWindow.focus() alone.
 */
async function focusChatWindow() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return
  console.log(`[chat] focusChatWindow start (mapped=${bubbleMapped}, visible=${bubbleWindow.isVisible()})`)

  // Wait until bubble window is mapped and positioned
  if (!bubbleMapped) {
    await waitForBubbleMapped()
  }

  // Ensure focusable
  try {
    bubbleWindow.setFocusable(true)
  } catch (err) {
    void err
  }

  const delays = [0, 120, 300]
  let success = false
  let attemptsDone = 0

  for (let i = 0; i < delays.length; i++) {
    attemptsDone++
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]))
    }

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      try {
        await execFileAsync('hyprctl', ['dispatch', 'focuswindow', 'title:^(screen-buddy-bubbles)$'])
      } catch (err) {
        void err
      }
    }

    try {
      if (process.platform === 'win32') {
        if (!bubbleWindow.isVisible()) bubbleWindow.show()
        bubbleWindow.moveTop()
      }
      bubbleWindow.focus()
      bubbleWindow.webContents.focus()
    } catch (err) {
      void err
    }

    try {
      bubbleWindow.webContents.send('chat:focus-input')
    } catch (err) {
      void err
    }

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      try {
        const { stdout } = await execFileAsync('hyprctl', ['activewindow', '-j'])
        const active = JSON.parse(stdout)
        if (active?.title === 'screen-buddy-bubbles') {
          success = true
          break
        }
      } catch (err) {
        void err
      }
    } else {
      // Non-hyprland environments (or test)
      success = true
      break
    }
  }

  if (success) {
    console.log(`[chat] focus ok after ${attemptsDone} attempt(s)`)
  } else {
    console.log('[chat] focus failed')
  }
}

// ─── Gemini API call ─────────────────────────────────────────────────────────

function buildGeminiSystemInstruction(currentSettings) {
  const length = currentSettings?.chatResponseLength || 'medium'
  let lengthInstruction = "Answer correctly and helpfully in 2-3 short sentences."
  if (length === 'short') lengthInstruction = "Answer correctly and helpfully in 1-2 very short sentences."
  else if (length === 'detailed') lengthInstruction = "Provide a thorough, accurate, and detailed answer in 3-5 sentences."

  const tone = currentSettings?.chatTone || 'casual'
  let toneInstruction = "Use a casual and friendly tone."
  if (tone === 'formal') toneInstruction = "Use a polite, formal, and direct tone."
  else if (tone === 'friendly') toneInstruction = "Use a warm, enthusiastic, and cheerful tone."

  const catPersonality = currentSettings?.chatUseCatPersonality !== false
  const useEmojis = currentSettings?.chatUseEmojis !== false

  let catTouch = ""
  if (catPersonality) {
    const emojiPart = useEmojis ? "or a paw emoji 🐾" : "such as *purr* or *meow*"
    catTouch = ` Include a small cat touch in EVERY reply (a meow, a purr, ${emojiPart}, at the start or end) while keeping the answer itself accurate and complete.`
  } else if (!useEmojis) {
    catTouch = " Do not use emojis in your response."
  }

  return (
    "You are a small black cat desktop companion. " +
    lengthInstruction + " " + toneInstruction +
    catTouch +
    " If you don't know something, say so plainly. Always reply in English, even if the user writes in another language."
  )
}

const GEMINI_TIMEOUT_MS = 25_000

/**
 * Call the Gemini generateContent REST endpoint.
 * Session history is maintained in the module-level chatHistory array (never saved to disk).
 *
 * @param {string} userMessage
 * @returns {Promise<{ ok: boolean, text?: string, error?: string }>} Structured result
 */
async function callGemini(userMessage) {
  // Resolve API key in main process only — never logged, never returned to renderer
  const apiKey = settings?.geminiApiKey || process.env.GEMINI_API_KEY || ''
  if (!apiKey) {
    return { ok: false, code: 'NO_API_KEY', error: 'Add your Gemini API key in Settings -> Chat & AI' }
  }

  const model = (settings?.geminiModel && settings.geminiModel.trim())
    ? settings.geminiModel.trim()
    : 'gemini-3.5-flash-lite'

  // Construct request contents including history plus new user turn without mutating chatHistory yet
  const contents = [
    ...chatHistory,
    { role: 'user', parts: [{ text: userMessage }] },
  ]
  const boundedContents = contents.length > 10 ? contents.slice(contents.length - 10) : contents

  const temperature = typeof settings?.geminiTemperature === 'number' ? settings.geminiTemperature : 0.7
  const maxOutputTokens = typeof settings?.geminiMaxTokens === 'number' ? settings.geminiMaxTokens : 1024

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const body = {
    systemInstruction: { parts: [{ text: buildGeminiSystemInstruction(settings) }] },
    contents: boundedContents,
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key is sent only in the x-goog-api-key header, never in the URL
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (fetchErr) {
    clearTimeout(timer)
    const isAbort = fetchErr.name === 'AbortError'
    console.error('[main] Gemini fetch error:', isAbort ? 'timeout' : fetchErr.message)
    if (isAbort) {
      return { ok: false, error: 'Request timed out after 25s. Please try again.' }
    }
    return { ok: false, error: 'Network error: unable to reach Gemini.' }
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let errorMessage = 'unknown error'
    try {
      const errData = await res.json()
      if (errData?.error?.message) errorMessage = errData.error.message
    } catch (_) {
      // Ignore JSON parse errors on error responses
    }
    console.error(`[main] Gemini HTTP ${res.status}: ${errorMessage}`)
    if (res.status === 401) {
      return { ok: false, error: 'HTTP 401: Invalid API key. Please check your key in Settings.' }
    }
    if (res.status === 403) {
      return { ok: false, error: 'HTTP 403: Access forbidden. Please check your API key permissions.' }
    }
    if (res.status === 429) {
      return { ok: false, error: 'HTTP 429: Rate limit exceeded. Please wait a moment and try again.' }
    }
    if (res.status >= 500) {
      return { ok: false, error: `HTTP ${res.status}: Gemini service is temporarily unavailable.` }
    }
    return { ok: false, error: `HTTP ${res.status}: Request failed.` }
  }

  let data
  try {
    data = await res.json()
  } catch (parseErr) {
    console.error('[main] Gemini response parse error:', parseErr.message)
    return { ok: false, error: 'Failed to parse Gemini response.' }
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    console.error('[main] Gemini unexpected response shape:', JSON.stringify(data).slice(0, 200))
    return { ok: false, error: 'Received an empty or unexpected response from Gemini.' }
  }

  // Commit both user turn and model turn to chatHistory only on success
  chatHistory.push({ role: 'user', parts: [{ text: userMessage }] })
  chatHistory.push({ role: 'model', parts: [{ text }] })
  if (chatHistory.length > 10) {
    chatHistory = chatHistory.slice(chatHistory.length - 10)
  }

  return { ok: true, text }
}

let fullscreenReconcileInFlight = false
let fullscreenReconcilePendingReason = null

function scheduleFullscreenReconcile(reason) {
  if (fullscreenReconcileTimer) clearTimeout(fullscreenReconcileTimer)
  fullscreenReconcileTimer = setTimeout(() => {
    fullscreenReconcileTimer = null
    reconcileHyprlandFullscreen(reason)
  }, 100)
}

async function reconcileHyprlandFullscreen(reason) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  if (fullscreenReconcileInFlight) {
    fullscreenReconcilePendingReason = reason
    return
  }
  fullscreenReconcileInFlight = true
  try {
    const { stdout } = await execFileAsync('hyprctl', ['activeworkspace', '-j'])
    const ws = JSON.parse(stdout)
    const hasFullscreen = Boolean(ws?.hasfullscreen)
    const fullscreenMode = Number(ws?.fullscreenmode || 0)
    const fullscreen = hasFullscreen || fullscreenMode > 0
    console.log(`[park] fullscreen check (${reason}): workspace hasfullscreen=${hasFullscreen} mode=${fullscreenMode} autoPause=${fullscreen}`)
    setFullscreenAutoPause(fullscreen, `Hyprland ${reason}`)
  } catch (err) {
    console.warn(`[park] Hyprland fullscreen check failed (${reason}):`, err.message)
  } finally {
    fullscreenReconcileInFlight = false
    if (fullscreenReconcilePendingReason) {
      const nextReason = fullscreenReconcilePendingReason
      fullscreenReconcilePendingReason = null
      scheduleFullscreenReconcile(nextReason)
    }
  }
}

function startHyprlandFullscreenMonitor() {
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (!signature || !runtimeDir) {
    console.log('[main] Hyprland fullscreen monitor disabled (not in a Hyprland session)')
    return
  }

  const socketPath = path.join(runtimeDir, 'hypr', signature, '.socket2.sock')
  const connect = () => {
    hyprlandEventSocket = net.createConnection(socketPath)
    hyprlandEventSocket.setEncoding('utf8')
    hyprlandEventSocket.on('connect', () => {
      console.log(`[main] Connected to Hyprland event socket: ${socketPath}`)
      scheduleFullscreenReconcile('socket connect')
    })
    hyprlandEventSocket.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        const parts = line.split('>>')
        const event = parts[0]
        const data = parts.slice(1).join('>>')
        if (!event) continue

        // Ignore active window events for our own windows to avoid park/unpark loops
        if (event === 'activewindow' || event === 'activewindowv2') {
          const isOwnWindow = data.includes(WINDOW_TITLE) ||
            data.includes('screen-buddy-overlay') ||
            data.includes('screen-buddy-bubbles') ||
            data.includes('screen-buddy-settings')
          if (isOwnWindow) {
            console.log(`[park] ignoring own-window activewindow event (${event}: ${data || ''})`)
            continue
          }
          scheduleFullscreenReconcile(`event:${event}`)
          reRaiseAndPinWindows(`event:${event}`)
          positionBubbleWindow()
          continue
        }

        if (event === 'fullscreen' || event === 'openwindow' || event === 'closewindow' || event === 'movewindow') {
          scheduleFullscreenReconcile(`event:${event}`)
        }

        if (event === 'openwindow') {
          setTimeout(() => {
            reRaiseAndPinWindows('openwindow:150ms')
          }, 150)
          setTimeout(() => {
            reRaiseAndPinWindows('openwindow:700ms')
          }, 700)
        } else if (event === 'workspace' || event === 'workspacev2') {
          scheduleFullscreenReconcile(`event:${event}`)
          if (!isParked && !isShuttingDown) {
            setTimeout(() => {
              if (!isParked && !isShuttingDown) {
                reRaiseAndPinWindows(`event:${event}:100ms`)
              }
            }, 100)
          }
          positionBubbleWindow()
        }
      }
    })
    hyprlandEventSocket.on('error', (err) => {
      console.warn('[main] Hyprland event socket error:', err.message)
    })
    hyprlandEventSocket.on('close', () => {
      hyprlandEventSocket = null
      if (!isShuttingDown && !hyprlandEventReconnectTimer) {
        hyprlandEventReconnectTimer = setTimeout(() => {
          hyprlandEventReconnectTimer = null
          connect()
        }, 5000)
      }
    })
  }

  connect()
  // socket2 is the primary mechanism. The low-frequency check covers the
  // documented case where Hyprland emits duplicate or missing fullscreen events.
  updateFullscreenSafetyPoll()
}

function updateFullscreenSafetyPoll() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  if (fullscreenSafetyPoll) clearInterval(fullscreenSafetyPoll)
  const pollInterval = settings?.limitBackgroundCpu ? 4000 : 2000
  fullscreenSafetyPoll = setInterval(() => reconcileHyprlandFullscreen('safety poll'), pollInterval)
}

function stopHyprlandFullscreenMonitor() {
  if (fullscreenSafetyPoll) clearInterval(fullscreenSafetyPoll)
  if (hyprlandEventReconnectTimer) clearTimeout(hyprlandEventReconnectTimer)
  if (fullscreenReconcileTimer) clearTimeout(fullscreenReconcileTimer)
  fullscreenSafetyPoll = null
  hyprlandEventReconnectTimer = null
  fullscreenReconcileTimer = null
  try {
    hyprlandEventSocket?.destroy()
  } catch (_) {
    /* ignore */
  }
  hyprlandEventSocket = null
}


// ─── Bubble Window ───────────────────────────────────────────────────────────

async function getBubbleWindow() {
  if (bubbleWindow) return bubbleWindow;

  console.log('[bubble] creating window');
  bubbleWindowReady = false;
  const appIcon = getAppWindowIcon()
  bubbleWindow = new BrowserWindow({
    title: 'screen-buddy-bubbles',
    width: 300,
    height: 120,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    ...(appIcon ? { icon: appIcon } : {}),
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      ...(process.platform === 'win32' ? { backgroundThrottling: false } : {}),
    },
  });

  if (process.platform === 'win32') {
    bubbleWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    bubbleWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '/#bubbles');
  } else {
    bubbleWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'), { hash: 'bubbles' });
  }

  bubbleWindow.on('close', () => {
    // Permitted through unconditionally
  });

  bubbleWindow.on('closed', () => {
    if (bubbleFollowTrailingTimer) {
      clearTimeout(bubbleFollowTrailingTimer);
      bubbleFollowTrailingTimer = null;
    }
    bubbleWindow = null;
    bubbleWindowReady = false;
    bubbleMapped = false;
    currentBubbleW = 300;
    currentBubbleH = 120;
    lastBubbleX = null;
    lastBubbleY = null;
  });

  bubbleWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  // Wait for did-finish-load with a 3 s safety timeout
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn('[bubble] did-finish-load timed out after 3 s — continuing anyway');
      bubbleWindowReady = true;
      resolve();
    }, 3000);
    bubbleWindow.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      if (bubbleWindow) bubbleWindow.setTitle('screen-buddy-bubbles');
      bubbleWindowReady = true;
      // Forward the latest card state so the new window has current content
      if (lastCardState && bubbleWindow) bubbleWindow.webContents.send('bubble:card-state', lastCardState);
      console.log('[bubble] window ready');
      resolve();
    });
  });

  return bubbleWindow;
}

let lastBubbleX = null;
let lastBubbleY = null;
let bubblePositionInFlight = false;
let bubblePositionPending = false;
let bubblePositionGeneration = 0;

// Tracks the cat overlay window top-left as known from Electron/hyprctl move commands.
// Updated whenever we successfully dispatch a window move, so positionBubbleWindow()
// never needs to query Hyprland for the cat position and cannot read stale/intermediate coords.
let lastKnownCatWinX = null;
let lastKnownCatWinY = null;

let currentWinW = NORMAL_WIN_W;
let currentWinH = NORMAL_WIN_H;
let currentWindowMode = 'mascot';
let mascotRepositionInProgress = false;

// Tracks the bubble window's measured content dimensions (reported via bubble:size).
// Initialized to the BrowserWindow creation defaults.
let currentBubbleW = 300;
let currentBubbleH = 120;

const BUBBLE_FOLLOW_THROTTLE_MS = 75;
let lastBubbleFollowTime = 0;
let bubbleFollowTrailingTimer = null;

function isBubbleFollowActive() {
  const hasCard = Boolean(lastCardState && lastCardState.hasContent);
  const hasNotif = Boolean(notificationsManager?.activeNotification);
  const isHypr = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
  return Boolean(
    (isHypr ? bubbleMapped : true) &&
    bubbleWindow &&
    !bubbleWindow.isDestroyed() &&
    bubbleWindow.isVisible() &&
    (hasNotif || hasCard) &&
    currentWindowMode === 'mascot' &&
    !mascotRepositionInProgress
  );
}

function onCatWindowMoved() {
  if (!isBubbleFollowActive()) {
    if (bubbleFollowTrailingTimer) {
      clearTimeout(bubbleFollowTrailingTimer);
      bubbleFollowTrailingTimer = null;
    }
    return;
  }

  const now = Date.now();
  const elapsed = now - lastBubbleFollowTime;

  if (elapsed >= BUBBLE_FOLLOW_THROTTLE_MS) {
    lastBubbleFollowTime = now;
    if (bubbleFollowTrailingTimer) {
      clearTimeout(bubbleFollowTrailingTimer);
      bubbleFollowTrailingTimer = null;
    }
    positionBubbleWindow();
  } else if (!bubbleFollowTrailingTimer) {
    const delay = Math.max(10, BUBBLE_FOLLOW_THROTTLE_MS - elapsed);
    bubbleFollowTrailingTimer = setTimeout(() => {
      bubbleFollowTrailingTimer = null;
      if (isBubbleFollowActive()) {
        lastBubbleFollowTime = Date.now();
        positionBubbleWindow();
      }
    }, delay);
  }
}

function onCatMoveQueueDrained() {
  if (!isBubbleFollowActive()) {
    if (bubbleFollowTrailingTimer) {
      clearTimeout(bubbleFollowTrailingTimer);
      bubbleFollowTrailingTimer = null;
    }
    return;
  }

  if (!bubbleFollowTrailingTimer) {
    const elapsed = Date.now() - lastBubbleFollowTime;
    const delay = Math.max(10, BUBBLE_FOLLOW_THROTTLE_MS - elapsed);
    bubbleFollowTrailingTimer = setTimeout(() => {
      bubbleFollowTrailingTimer = null;
      if (isBubbleFollowActive()) {
        lastBubbleFollowTime = Date.now();
        positionBubbleWindow();
      }
    }, delay);
  }
}

async function positionBubbleWindow() {
  if (!bubbleWindow || !bubbleWindowReady) return;

  const isHypr = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
  if (isHypr && !bubbleMapped) {
    if (!bubbleSkipLogged) {
      console.log('[bubble] skipped (not mapped)');
      bubbleSkipLogged = true;
    }
    return;
  }
  
  // NO SPAM: do nothing unless there is active content (notification OR card) AND window is shown.
  const hasCard = !!(lastCardState && lastCardState.hasContent);
  if (!bubbleWindow.isVisible() || (!notificationsManager?.activeNotification && !hasCard)) {
    return;
  }
  
  const myGen = bubblePositionGeneration;

  if (bubblePositionInFlight) {
    bubblePositionPending = true;
    return;
  }
  bubblePositionInFlight = true;
  bubblePositionPending = false;

  try {
    let catX = lastKnownCatWinX;
    let catY = lastKnownCatWinY;
    
    // Fallback if not initialized
    if (catX === null || catY === null) {
      const savedPos = getSavedMascotPosition();
      catX = savedPos.x;
      catY = savedPos.y;
    }

    if (myGen !== bubblePositionGeneration) {
      console.log('[bubble] aborting stale position request (generation mismatch)');
      return;
    }
    if (currentWindowMode === 'drag' || mascotRepositionInProgress) {
      console.log('[bubble] aborting position request (invalid window mode)');
      bubblePositionPending = false; // Do not immediately retry against temporary coordinates
      return;
    }

    const displays = electronScreen.getAllDisplays();
    const catCenterEstimateX = catX + (currentWindowMode === 'treatment' ? TREATMENT_CAT_CX : NORMAL_CAT_CX);
    const catCenterEstimateY = catY + (currentWindowMode === 'treatment' ? TREATMENT_CAT_CY : NORMAL_CAT_CY);
    const catDisplay = getDisplayForPoint(displays, catCenterEstimateX, catCenterEstimateY) || electronScreen.getPrimaryDisplay();

    const bw = currentBubbleW;
    const bh = currentBubbleH;

    const computed = computeBubblePosition(catDisplay, catX, catY, bw, bh, currentWindowMode);
    let targetX = Math.round(computed.x);
    let targetY = Math.round(computed.y);

    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      console.warn(`[display] invalid bubble position coordinates: targetX=${targetX} targetY=${targetY}`);
      return;
    }

    if (lastBubbleX === targetX && lastBubbleY === targetY) {
      return; // Skip if position hasn't changed
    }

    console.log(`[bubble-pos] will move: catWin=(${catX},${catY}) target=(${targetX},${targetY}) lastBubble=(${lastBubbleX},${lastBubbleY}) mode=${currentWindowMode} drag=${mascotRepositionInProgress}`);
    
    if (myGen !== bubblePositionGeneration) {
      console.log('[bubble] aborting before move (generation mismatch)');
      return;
    }
    if (currentWindowMode === 'drag' || mascotRepositionInProgress) {
      bubblePositionPending = false;
      return;
    }

    if (isHypr) {
      const titleMatch = 'title:^(screen-buddy-bubbles)$';
      await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', `exact ${targetX} ${targetY},${titleMatch}`]);
      console.log(`[bubble] positioned at ${targetX},${targetY} (catWin=${lastKnownCatWinX},${lastKnownCatWinY} mode=${currentWindowMode} drag=${mascotRepositionInProgress} gen=${myGen}/${bubblePositionGeneration})`);
      
      if (myGen !== bubblePositionGeneration) {
        console.log('[bubble] aborting before alterzorder (generation mismatch)');
        return;
      }

      await execFileAsync('hyprctl', ['dispatch', 'alterzorder', `top,${titleMatch}`]);
      console.log('[bubble] alterzorder done');
    } else {
      setWindowBoundsSafely(bubbleWindow, { x: targetX, y: targetY, width: bw, height: bh }, 'bubbleWindow');
      if (process.platform === 'win32') {
        bubbleWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      console.log(`[bubble] positioned at ${targetX},${targetY} (catWin=${catX},${catY} platform=${process.platform})`);
    }
    
    if (myGen === bubblePositionGeneration) {
      lastBubbleX = targetX;
      lastBubbleY = targetY;
    }
  } catch (err) {
    console.error('[bubble] position error:', err.message);
  } finally {
    bubblePositionInFlight = false;
    if (bubblePositionPending) {
      bubblePositionPending = false;
      positionBubbleWindow();
    }
  }
}
let bubbleSizeInFlight = false;
let bubbleSizePendingW = null;
let bubbleSizePendingH = null;

async function applyBubbleWindowSize(w, h) {
  if (!bubbleMapped) {
    if (!bubbleSkipLogged) {
      console.log('[bubble] skipped (not mapped)');
      bubbleSkipLogged = true;
    }
    return;
  }

  if (bubbleSizeInFlight) {
    bubbleSizePendingW = w;
    bubbleSizePendingH = h;
    return;
  }
  bubbleSizeInFlight = true;
  bubbleSizePendingW = null;
  bubbleSizePendingH = null;

  try {
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      try { bubbleWindow.setSize(w, h); } catch (e) { void e; }
    }
    
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      const titleMatch = 'title:^(screen-buddy-bubbles)$';
      try {
        await execFileAsync('hyprctl', ['dispatch', 'resizewindowpixel', `exact ${Math.round(w)} ${Math.round(h)},${titleMatch}`]);
        
        const started = Date.now();
        let attempt = 0;
        let confirmed = false;
        let lastCompositorSize = null;
        while (Date.now() - started < BUBBLE_SIZE_POLL_TIMEOUT_MS) {
          attempt++;
          try {
            const { stdout } = await execFileAsync('hyprctl', ['clients', '-j']);
            const clients = JSON.parse(stdout);
            const overlay = clients.find(c => c.title === 'screen-buddy-bubbles');
            lastCompositorSize = overlay?.size;
            if (overlay && Array.isArray(lastCompositorSize) && lastCompositorSize[0] === w && lastCompositorSize[1] === h) {
              console.log(`[bubble-size] hyprland native=${w}x${h} requested=${w}x${h} confirmed=true elapsed=${Date.now() - started}ms attempts=${attempt}`);
              confirmed = true;
              break;
            }
          } catch (err) { void err; }
          await new Promise(r => setTimeout(r, BUBBLE_SIZE_POLL_INTERVAL_MS));
        }
        if (!confirmed) {
          const cs = Array.isArray(lastCompositorSize) ? `${lastCompositorSize[0]}x${lastCompositorSize[1]}` : 'unknown';
          console.warn(`[bubble-size] hyprland native=${cs} requested=${w}x${h} confirmed=false timed_out=true elapsed=${BUBBLE_SIZE_POLL_TIMEOUT_MS}ms`);
        }
      } catch (err) {
        console.error(`[bubble-size] hyprctl resize error:`, err.message);
      }
    }
    
    if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
      positionBubbleWindow();
    }
  } finally {
    bubbleSizeInFlight = false;
    if (bubbleSizePendingW !== null && bubbleSizePendingH !== null) {
      applyBubbleWindowSize(bubbleSizePendingW, bubbleSizePendingH);
    }
  }
}


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

function openSettingsWindow(initialTab = null) {
  if (isParked) {
    unpark('settings-open')
  }
  if (initialTab) {
    pendingSettingsTab = initialTab
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    if (initialTab && !settingsWindow.webContents.isDestroyed()) {
      pendingSettingsTab = null
      settingsWindow.webContents.send('settings:select-tab', initialTab)
    }
    return
  }

  const displays = electronScreen.getAllDisplays()
  const catX = (lastKnownCatWinX !== null && Number.isFinite(lastKnownCatWinX)) ? lastKnownCatWinX : 0
  const catY = (lastKnownCatWinY !== null && Number.isFinite(lastKnownCatWinY)) ? lastKnownCatWinY : 0
  const catDisplay = getDisplayForPoint(displays, catX + NORMAL_CAT_CX, catY + NORMAL_CAT_CY) || electronScreen.getPrimaryDisplay()
  const catWa = catDisplay.workArea || catDisplay.bounds

  const minWidth = Math.max(320, Math.min(720, Math.floor(catWa.width * 0.95)))
  const minHeight = Math.max(240, Math.min(520, Math.floor(catWa.height * 0.95)))

  const clampSettingsBoundsToDisplays = (allDisplays, rawBounds, fallbackDisplay) => {
    const hasPos = Number.isFinite(rawBounds?.x) && Number.isFinite(rawBounds?.y)
    const wRaw = Number.isFinite(rawBounds?.width) ? rawBounds.width : 1100
    const hRaw = Number.isFinite(rawBounds?.height) ? rawBounds.height : 760
    const targetDisplay = hasPos
      ? (getDisplayForPoint(allDisplays, rawBounds.x + wRaw / 2, rawBounds.y + hRaw / 2) || fallbackDisplay)
      : fallbackDisplay
    const targetWa = targetDisplay.workArea || targetDisplay.bounds
    const targetMinW = Math.max(320, Math.min(720, Math.floor(targetWa.width * 0.95)))
    const targetMinH = Math.max(240, Math.min(520, Math.floor(targetWa.height * 0.95)))

    const width = Math.max(targetMinW, Math.min(Math.round(wRaw), targetWa.width))
    const height = Math.max(targetMinH, Math.min(Math.round(hRaw), targetWa.height))

    let x
    let y
    if (hasPos) {
      const maxX = Math.max(targetWa.x, targetWa.x + targetWa.width - width)
      const maxY = Math.max(targetWa.y, targetWa.y + targetWa.height - height)
      x = Math.round(Math.max(targetWa.x, Math.min(rawBounds.x, maxX)))
      y = Math.round(Math.max(targetWa.y, Math.min(rawBounds.y, maxY)))
    } else {
      x = Math.round(targetWa.x + (targetWa.width - width) / 2)
      y = Math.round(targetWa.y + (targetWa.height - height) / 2)
    }
    return { x, y, width, height, minWidth: targetMinW, minHeight: targetMinH }
  }

  let winWidth = Math.max(minWidth, Math.min(1100, Math.floor(catWa.width * 0.9)))
  let winHeight = Math.max(minHeight, Math.min(760, Math.floor(catWa.height * 0.9)))
  let winX = Math.round(catWa.x + (catWa.width - winWidth) / 2)
  let winY = Math.round(catWa.y + (catWa.height - winHeight) / 2)
  let shouldMaximize = false

  const savedBounds = settings?.settingsWindowBounds
  if (savedBounds && Number.isFinite(savedBounds.width) && Number.isFinite(savedBounds.height)) {
    const clamped = clampSettingsBoundsToDisplays(displays, savedBounds, catDisplay)
    winWidth = clamped.width
    winHeight = clamped.height
    winX = clamped.x
    winY = clamped.y
    shouldMaximize = Boolean(savedBounds.maximized)
  }

  let lastValidNormalBounds = { width: winWidth, height: winHeight, x: winX, y: winY }

  const chromeOptions = process.platform === 'win32'
    ? {
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: '#f3ecdf',
          height: 40,
        },
      }
    : process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          titleBarOverlay: true,
        }
      : {
          frame: false,
        }

  const appIcon = getAppWindowIcon()
  settingsWindow = new BrowserWindow({
    title: 'screen-buddy-settings',
    width: winWidth,
    height: winHeight,
    x: winX,
    y: winY,
    minWidth,
    minHeight,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    skipTaskbar: false,
    ...(appIcon ? { icon: appIcon } : {}),
    backgroundColor: '#14111b',
    ...chromeOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (shouldMaximize) {
    settingsWindow.maximize()
  } else {
    settingsWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight })
  }
  settingsWindow.show()
  settingsWindow.focus()

  if (process.env.SCREEN_BUDDY_DEBUG === '1') {
    console.log(
      `[settings-win] opened bounds=${JSON.stringify(settingsWindow.getBounds())} ` +
      `normal=${JSON.stringify(settingsWindow.getNormalBounds())} ` +
      `maximized=${settingsWindow.isMaximized()} ` +
      `min=${JSON.stringify(settingsWindow.getMinimumSize())} ` +
      `isAlwaysOnTop=${settingsWindow.isAlwaysOnTop()} ` +
      `hasParent=${settingsWindow.getParentWindow() !== null} ` +
      `resizable=${settingsWindow.isResizable()} ` +
      `minimizable=${settingsWindow.isMinimizable()} ` +
      `maximizable=${settingsWindow.isMaximizable()} ` +
      `closable=${settingsWindow.isClosable()}`
    )
  }

  const logSettingsWinEvent = (evt) => {
    if (process.env.SCREEN_BUDDY_DEBUG !== '1' || !settingsWindow || settingsWindow.isDestroyed()) return
    const b = settingsWindow.getBounds()
    const n = settingsWindow.getNormalBounds()
    const d = electronScreen.getDisplayMatching(b)
    const wa = d?.workArea || d?.bounds
    console.log(
      `[settings-win] event=${evt} bounds=${JSON.stringify(b)} normal=${JSON.stringify(n)} ` +
      `max=${settingsWindow.isMaximized()} wa=${JSON.stringify(wa)}`
    )
  }

  let isClampingBounds = false
  const ensureSettingsTitleBarVisible = (reason, clampFull = false) => {
    if (isClampingBounds || !settingsWindow || settingsWindow.isDestroyed()) return
    if (settingsWindow.isMaximized() || settingsWindow.isFullScreen()) return
    const cur = settingsWindow.getBounds()
    const allDisplays = electronScreen.getAllDisplays()
    const match = allDisplays.length > 0
      ? (getDisplayForPoint(allDisplays, cur.x + cur.width / 2, cur.y + cur.height / 2) || electronScreen.getDisplayMatching(cur) || electronScreen.getPrimaryDisplay())
      : electronScreen.getPrimaryDisplay()
    const wa = match.workArea || match.bounds
    if (clampFull) {
      const clamped = clampSettingsBoundsToDisplays(allDisplays, cur, match)
      if (cur.x !== clamped.x || cur.y !== clamped.y || cur.width !== clamped.width || cur.height !== clamped.height) {
        isClampingBounds = true
        try {
          settingsWindow.setBounds({ x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height })
        } finally {
          isClampingBounds = false
        }
        if (process.env.SCREEN_BUDDY_DEBUG === '1') {
          console.log(`[settings-win] clamped (${reason}) ${JSON.stringify(cur)} -> ${JSON.stringify(clamped)}`)
        }
      }
      return
    }
    const clampedW = Math.min(cur.width, wa.width)
    const clampedH = Math.min(cur.height, wa.height)
    const maxY = Math.max(wa.y, wa.y + wa.height - clampedH)
    const clampedY = Math.max(wa.y, Math.min(cur.y, maxY))
    const minVisibleX = wa.x - clampedW + 80
    const maxVisibleX = wa.x + wa.width - 80
    const clampedX = Math.max(minVisibleX, Math.min(cur.x, maxVisibleX))
    if (cur.x !== clampedX || cur.y !== clampedY || cur.width !== clampedW || cur.height !== clampedH) {
      isClampingBounds = true
      try {
        settingsWindow.setBounds({ x: Math.round(clampedX), y: Math.round(clampedY), width: Math.round(clampedW), height: Math.round(clampedH) })
      } finally {
        isClampingBounds = false
      }
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        console.log(`[settings-win] clamped (${reason}) ${JSON.stringify(cur)} -> ${JSON.stringify({ x: clampedX, y: clampedY, width: clampedW, height: clampedH })}`)
      }
    }
  }

  let boundsSaveTimer = null
  const persistSettingsWindowBounds = () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return
    const maximized = settingsWindow.isMaximized()
    const raw = maximized ? settingsWindow.getNormalBounds() : settingsWindow.getBounds()
    const allDisplays = electronScreen.getAllDisplays()
    const fallbackDisp = allDisplays.length > 0
      ? (getDisplayForPoint(allDisplays, (raw?.x ?? 0) + (raw?.width ?? 0) / 2, (raw?.y ?? 0) + (raw?.height ?? 0) / 2) || electronScreen.getPrimaryDisplay())
      : electronScreen.getPrimaryDisplay()
    const candidate = (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height) && raw.width > 0 && raw.height > 0)
      ? raw
      : lastValidNormalBounds
    const clamped = clampSettingsBoundsToDisplays(allDisplays, candidate, fallbackDisp)
    if (!maximized) {
      lastValidNormalBounds = { width: clamped.width, height: clamped.height, x: clamped.x, y: clamped.y }
    }
    const nextBounds = {
      width: clamped.width,
      height: clamped.height,
      x: clamped.x,
      y: clamped.y,
      maximized,
    }
    if (JSON.stringify(settings?.settingsWindowBounds) !== JSON.stringify(nextBounds)) {
      settings = { ...settings, settingsWindowBounds: nextBounds }
      saveSettings(settings)
    }
  }
  persistSettingsWindowBoundsRef = persistSettingsWindowBounds
  const scheduleBoundsSave = (evtName) => {
    logSettingsWinEvent(evtName)
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null
      ensureSettingsTitleBarVisible(evtName, false)
      persistSettingsWindowBounds()
    }, 200)
  }

  settingsWindow.on('resize', () => scheduleBoundsSave('resize'))
  settingsWindow.on('move', () => scheduleBoundsSave('move'))
  settingsWindow.on('resized', () => {
    logSettingsWinEvent('resized')
    ensureSettingsTitleBarVisible('resized', false)
    persistSettingsWindowBounds()
  })
  settingsWindow.on('moved', () => {
    logSettingsWinEvent('moved')
    ensureSettingsTitleBarVisible('moved', false)
    persistSettingsWindowBounds()
  })
  settingsWindow.on('maximize', () => {
    if (boundsSaveTimer) {
      clearTimeout(boundsSaveTimer)
      boundsSaveTimer = null
    }
    logSettingsWinEvent('maximize')
    persistSettingsWindowBounds()
  })
  settingsWindow.on('unmaximize', () => {
    if (boundsSaveTimer) {
      clearTimeout(boundsSaveTimer)
      boundsSaveTimer = null
    }
    logSettingsWinEvent('unmaximize')
    ensureSettingsTitleBarVisible('unmaximize', true)
    persistSettingsWindowBounds()
  })
  settingsWindow.on('show', () => {
    ensureSettingsTitleBarVisible('show', false)
  })
  settingsWindow.on('close', () => {
    if (boundsSaveTimer) {
      clearTimeout(boundsSaveTimer)
      boundsSaveTimer = null
    }
    if (isQuitting || isShuttingDown) {
      return
    }
    persistSettingsWindowBounds()
  })

  settingsWindow.on('page-title-updated', (e) => {
    e.preventDefault()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '/#settings')
  } else {
    settingsWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'), { hash: 'settings' })
  }

  settingsWindow.webContents.on('did-finish-load', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.setTitle('screen-buddy-settings')
      if (initialTab && !settingsWindow.webContents.isDestroyed()) {
        settingsWindow.webContents.send('settings:select-tab', initialTab)
      }
    }
  })

  settingsWindow.on('closed', () => {
    if (boundsSaveTimer) {
      clearTimeout(boundsSaveTimer)
      boundsSaveTimer = null
    }
    persistSettingsWindowBoundsRef = null
    settingsWindow = null
    if (!isQuitting && !isShuttingDown) {
      reRaiseAndPinWindows('settings closed')
      if (isParked) {
        unpark('settings-closed')
      }
      setTimeout(() => logAppMetrics('settings-closed-10s'), 10000)
    }
  })

  setTimeout(() => logAppMetrics('settings-opened-10s'), 10000)
}

function createOverlayWindow() {
  const isAutostart = process.argv.includes('--autostart')
  const shouldDelayStartup = isAutostart && Boolean(settings?.delayStartup)
  const savedPosition = getSavedMascotPosition()
  const appIcon = getAppWindowIcon()
  mainWindow = new BrowserWindow({
    title: WINDOW_TITLE,
    width: NORMAL_WIN_W,
    height: NORMAL_WIN_H,
    x: savedPosition.x,
    y: savedPosition.y,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    ...(appIcon ? { icon: appIcon } : {}),
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
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
      ...(process.platform === 'win32' ? { backgroundThrottling: false } : {}),
    },
  })

  if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
  }

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

  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    if (typeof message === 'string' && message.startsWith('[walk]')) {
      console.log(message)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    // Prevent the renderer <title> from changing the Hyprland-visible title.
    mainWindow.setTitle(WINDOW_TITLE)
    console.log(`[main] Overlay window did-finish-load. Electron title="${mainWindow.getTitle()}" (canonical=${WINDOW_TITLE})`)

    if (process.env.SCREEN_BUDDY_DEBUG === '1' && process.env.SCREEN_BUDDY_AUTO_DRAG === '1') {
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

  if (shouldDelayStartup) {
    console.log('[main] Autostart detected with delayStartup enabled: waiting 10s before showing cat')
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.showInactive()
        console.log('[main] 10s startup delay elapsed: overlay window shown')
      }
    }, 10000)
  } else {
    // showInactive() prevents stealing focus from the user's active app on startup
    mainWindow.showInactive()
  }
  // Seed the cat window position tracker from the saved position so that
  // positionBubbleWindow() has a valid anchor before the first cat move.
  lastKnownCatWinX = savedPosition.x
  lastKnownCatWinY = savedPosition.y
  console.log(`[main] Overlay created at saved mascot position (${savedPosition.x}, ${savedPosition.y}); lastKnownCatWin seeded to (${lastKnownCatWinX},${lastKnownCatWinY})`)

  setTimeout(() => {
    restoreMascotPositionOnResume('init:100ms')
    reRaiseAndPinWindows('init:100ms')
  }, 100)
  setTimeout(() => {
    restoreMascotPositionOnResume('init:500ms')
    reRaiseAndPinWindows('init:500ms')
  }, 500)

  // ── Primary-window close → quit the whole application ───────────────────
  // Without this handler:
  //  1. mainWindow reference stays as a destroyed (non-null) BrowserWindow.
  //  2. Optional chaining (mainWindow?.webContents) returns the destroyed
  //     webContents and .send() throws "Object has been destroyed".
  //  3. The bubbleWindow can keep the Electron process alive indefinitely
  //     because window-all-closed only fires when *all* windows are gone.
  //
  // Calling app.quit() here triggers will-quit → cleanup → process.exit.
  // Guard isShuttingDown so we don't recurse if app.quit() was already called.
  mainWindow.on('closed', () => {
    mainWindow = null  // Null immediately so the IPC guard drops any in-flight events
    if (!isShuttingDown && !isQuitting) {
      console.log('[main] Primary overlay window closed — quitting application')
      releaseSingleInstanceLock()
      isQuitting = true
      isShuttingDown = true
      ensureQuitWatchdog()
      destroyAllWindows()
      app.quit()
    }
  })
}

const DRIFT_POS_THRESHOLD_PX = 3
const DRIFT_SIZE_THRESHOLD_PX = 4
const DRIFT_LOG_INTERVAL_MS = 30_000
let lastDriftLogAt = 0
let suppressedDriftCount = 0

function setWindowBoundsSafely(win, bounds, tag = 'window') {
  if (!win || win.isDestroyed()) return
  if (
    !bounds ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    console.warn(`[display] invalid bounds in setWindowBoundsSafely (${tag}):`, bounds)
    return
  }
  const requested = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }
  try {
    win.setBounds(requested)
    const actual = win.getBounds()
    const posDrift = Math.max(Math.abs(actual.x - requested.x), Math.abs(actual.y - requested.y))
    const sizeDrift = Math.max(Math.abs(actual.width - requested.width), Math.abs(actual.height - requested.height))
    if (posDrift > DRIFT_POS_THRESHOLD_PX || sizeDrift > DRIFT_SIZE_THRESHOLD_PX) {
      const now = Date.now()
      if (lastDriftLogAt === 0 || now - lastDriftLogAt >= DRIFT_LOG_INTERVAL_MS) {
        const suppressedNote = suppressedDriftCount > 0 ? ` (suppressed ${suppressedDriftCount} in last 30s)` : ''
        console.log(`[display] ${tag} bounds drift detected (req=${requested.width}x${requested.height}@${requested.x},${requested.y} actual=${actual.width}x${actual.height}@${actual.x},${actual.y})${suppressedNote}, correcting`)
        lastDriftLogAt = now
        suppressedDriftCount = 0
      } else {
        suppressedDriftCount++
      }
      win.setBounds(requested)
    }
  } catch (err) {
    console.warn(`[display] ${tag} setBounds error:`, err.message)
  }
}

function getSavedMascotPosition() {
  const displays = electronScreen.getAllDisplays()
  const primary = electronScreen.getPrimaryDisplay()
  const saved = settings?.mascotPosition

  // If no position saved or invalid, use default (bottom-right standing on floor of primary display)
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    const def = getDefaultMascotPosition(primary)
    logDisplayMetrics('startup-default', def.x, def.y)
    return { x: def.x, y: def.y }
  }

  const rawX = Math.round(saved.x)
  const rawY = Math.round(saved.y)

  // Validate and clamp saved position to nearest/containing connected display
  const clamped = clampWindowPosition(displays, rawX, rawY, NORMAL_WIN_W, NORMAL_WIN_H)
  if (clamped.x !== rawX || clamped.y !== rawY) {
    console.log(`[display] saved mascot position (${rawX}, ${rawY}) outside workArea, corrected to (${clamped.x}, ${clamped.y}) on display ${clamped.display?.id}`)
  }

  logDisplayMetrics('startup-clamped', clamped.x, clamped.y)
  return { x: clamped.x, y: clamped.y }
}

function logDisplayMetrics(reason, currentWinX, currentWinY) {
  const displays = electronScreen.getAllDisplays()
  const currentX = currentWinX != null ? currentWinX : (lastKnownCatWinX || 0)
  const currentY = currentWinY != null ? currentWinY : (lastKnownCatWinY || 0)
  const targetDisplay = getDisplayForPoint(displays, currentX + NORMAL_WIN_W / 2, currentY + NORMAL_WIN_H / 2) || electronScreen.getPrimaryDisplay()

  for (const d of displays) {
    const dGeom = getDisplayCatGeometry(d)
    const isCurrent = d.id === targetDisplay.id
    console.log(`[display] [${reason}] platform=${process.platform} display=${d.id} scaleFactor=${d.scaleFactor} bounds=${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y} workArea=${d.workArea.width}x${d.workArea.height}@${d.workArea.x},${d.workArea.y} floorY=${dGeom.floorY} floorWinY=${dGeom.floorWinY} catHere=${isCurrent}`)
  }
}

function persistMascotPosition(x, y) {
  settings = { ...settings, mascotPosition: { x, y } }
  saveSettings(settings)
  console.log(`[main] Saved mascot position to settings: (${x}, ${y})`)
}

let restorePositionInFlight = false

async function restoreMascotPositionOnResume(reason = 'resume') {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return
  if (restorePositionInFlight) return
  restorePositionInFlight = true
  try {
    const displays = electronScreen.getAllDisplays()
    const targetX = (lastKnownCatWinX !== null && Number.isFinite(lastKnownCatWinX)) ? lastKnownCatWinX : (settings?.mascotPosition?.x || 0)
    const targetY = (lastKnownCatWinY !== null && Number.isFinite(lastKnownCatWinY)) ? lastKnownCatWinY : (settings?.mascotPosition?.y || 0)

    const clamped = clampWindowPosition(displays, targetX, targetY, currentWinW, currentWinH)
    const clampedX = clamped.x
    const clampedY = clamped.y

    lastKnownCatWinX = clampedX
    lastKnownCatWinY = clampedY

    try {
      if (process.platform === 'win32') {
        setWindowBoundsSafely(mainWindow, { x: clampedX, y: clampedY, width: currentWinW, height: currentWinH }, 'mainWindow')
      } else {
        mainWindow.setPosition(clampedX, clampedY)
      }
    } catch {
      // ignore
    }

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      try {
        await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', `exact ${clampedX} ${clampedY},${HYPR_TITLE_MATCH}`])
        if (process.env.SCREEN_BUDDY_DEBUG === '1') {
          console.log(`[main] restoreMascotPositionOnResume (${reason}): moved to (${clampedX}, ${clampedY})`)
        }
      } catch (err) {
        if (process.env.SCREEN_BUDDY_DEBUG === '1') {
          console.warn('[main] restoreMascotPositionOnResume hyprctl move error:', err.message || err)
        }
      }
    }
  } finally {
    restorePositionInFlight = false
  }
}

let reRaiseInFlight = false
let reRaisePendingReason = null

async function reRaiseAndPinWindows(reason) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  if (reRaiseInFlight) {
    reRaisePendingReason = reason
    return
  }
  reRaiseInFlight = true
  try {
    const [{ stdout: clientsOut }, { stdout: wsOut }] = await Promise.all([
      execFileAsync('hyprctl', ['clients', '-j']),
      execFileAsync('hyprctl', ['activeworkspace', '-j']).catch(() => ({ stdout: '{}' }))
    ])
    const clients = JSON.parse(clientsOut)
    const ws = JSON.parse(wsOut)
    const fullscreenWindowOnWs = Boolean(ws?.hasfullscreen) || Number(ws?.fullscreenmode || 0) > 0

    if (Array.isArray(clients)) {
      // 1. Overlay window
      const overlayClient = clients.find((c) => c?.title === WINDOW_TITLE && c?.floating === true)
        || clients.find((c) => c?.title === WINDOW_TITLE)
      if (overlayClient) {
        console.log(`[park] raise:${reason} pinned=${Boolean(overlayClient.pinned)} floating=${Boolean(overlayClient.floating)} ws=${overlayClient.workspace?.id} fullscreenWindowOnWs=${fullscreenWindowOnWs}`)
        if (overlayClient.pinned === false) {
          await execFileAsync('hyprctl', ['dispatch', 'pin', `title:^(${WINDOW_TITLE})$`])
          console.log(`[pin] re-pinned ${WINDOW_TITLE} (${reason})`)
        }
        await execFileAsync('hyprctl', ['dispatch', 'alterzorder', `top,title:^(${WINDOW_TITLE})$`])
      }

      // 2. Bubble window (if mapped or visible)
      if (bubbleMapped || (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible())) {
        const bubbleClient = clients.find((c) => c?.title === 'screen-buddy-bubbles')
        if (bubbleClient) {
          if (bubbleClient.pinned === false) {
            await execFileAsync('hyprctl', ['dispatch', 'pin', 'title:^(screen-buddy-bubbles)$'])
            console.log(`[pin] re-pinned screen-buddy-bubbles (${reason})`)
          }
          await execFileAsync('hyprctl', ['dispatch', 'alterzorder', 'top,title:^(screen-buddy-bubbles)$'])
        }
      }
    }
  } catch (err) {
    if (process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.warn(`[pin] reRaiseAndPinWindows failed (${reason}):`, err.message || err)
    }
  } finally {
    reRaiseInFlight = false
    if (reRaisePendingReason) {
      const nextReason = reRaisePendingReason
      reRaisePendingReason = null
      reRaiseAndPinWindows(nextReason)
    }
  }
}


let isCreatingBubble = false;
let pendingNotification = null;

async function waitForBubbleMapped() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    bubbleMapped = true;
    return;
  }
  const mapStart = Date.now();
  let mapped = false;
  for (let attempt = 0; attempt < 34 && !mapped; attempt++) {
    await new Promise(r => setTimeout(r, 30));
    try {
      const { stdout } = await execFileAsync('hyprctl', ['clients', '-j']);
      const clients = JSON.parse(stdout);
      if (clients.some(c => c.title === 'screen-buddy-bubbles')) {
        mapped = true;
      }
    } catch (_) { /* ignore */ }
  }
  if (mapped) {
    bubbleMapped = true;
    console.log(`[bubble] mapped after ${Date.now() - mapStart} ms`);
  } else {
    bubbleMapped = true;
    console.warn(`[bubble] map-wait timed out after ${Date.now() - mapStart} ms — continuing`);
  }
}

async function showBubbleWindow(notif) {
  pendingNotification = notif;
  mainWindow?.webContents.send('notification:visible', true);

  try {
    if (!bubbleWindow) {
      if (isCreatingBubble) {
        // Window is being created; pendingNotification is set, it will be sent once ready
        return;
      }
      isCreatingBubble = true;
      try {
        await getBubbleWindow();
      } finally {
        isCreatingBubble = false;
      }
    }

    if (!bubbleWindowReady) {
      console.warn('[bubble] window not ready, skipping show');
      return;
    }

    bubbleMapped = false;
    bubbleSkipLogged = false;
    bubbleWindow.showInactive();
    console.log('[bubble] showInactive called');

    // Wait until Hyprland has mapped the window, with a 1 s timeout
    await waitForBubbleMapped();

    // Re-apply the last known size after every show/map so Hyprland doesn't
    // keep its default 300x120 on the 2nd+ notification.  applyBubbleWindowSize
    // calls positionBubbleWindow() at its end, so we skip the direct call below.
    if (currentBubbleW !== 300 || currentBubbleH !== 120) {
      console.log(`[bubble] re-applied size ${currentBubbleW}x${currentBubbleH} after map`);
      await applyBubbleWindowSize(currentBubbleW, currentBubbleH);
    } else {
      await positionBubbleWindow();
    }
    await positionBubbleWindow();

    if (pendingNotification) {
      bubbleWindow.webContents.send('notification:show', pendingNotification);
      console.log('[bubble] notification:show sent');
      pendingNotification = null;
    }
    if (chatInputOpen === 'input') {
      bubbleWindow.setFocusable(true);
    }
  } catch (err) {
    console.error('[bubble] showBubbleWindow error:', err.message, err.stack);
    isCreatingBubble = false; // ensure not stuck
  }
}

function hideBubbleWindow(id) {
  pendingNotification = null;
  if (bubbleWindow) {
    bubbleWindow.webContents.send('notification:close', id);
    // Only physically hide the window if there is no active card content
    const hasCard = !!(lastCardState && lastCardState.hasContent);
    if (!hasCard) {
      if (bubbleFollowTrailingTimer) {
        clearTimeout(bubbleFollowTrailingTimer);
        bubbleFollowTrailingTimer = null;
      }
      bubbleMapped = false;
      bubbleWindow.hide();
      lastBubbleX = null;
      lastBubbleY = null;
      console.log('[bubble] hidden (no card content)');
      mainWindow?.webContents.send('notification:visible', false);
    } else {
      console.log('[bubble] notification closed but card content still active — keeping visible');
    }
  } else {
    mainWindow?.webContents.send('notification:visible', false);
  }
}

// ─── System tray ─────────────────────────────────────────────────────────────
let trayRetryTimeout = null
let trayRetryCount = 0
const MAX_TRAY_RETRIES = 24

let cachedTrayIcon = null
let cachedAppIcon = null

function getAppWindowIcon() {
  if (cachedAppIcon) {
    return cachedAppIcon
  }
  const rel = process.platform === 'win32' ? 'build/icon.ico' : 'build/icon.png'
  const possiblePaths = [
    path.join(app.getAppPath(), rel),
    path.join(process.resourcesPath, rel),
    path.join(__dirname, '..', rel),
  ]
  for (const iconPath of possiblePaths) {
    if (fs.existsSync(iconPath)) {
      if (process.platform === 'win32' && !iconPath.toLowerCase().includes('.asar')) {
        cachedAppIcon = iconPath
        return cachedAppIcon
      }
      const icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) {
        cachedAppIcon = icon
        return cachedAppIcon
      }
    }
  }
  return undefined
}

function getTrayIcon() {
  if (cachedTrayIcon && !cachedTrayIcon.isEmpty()) {
    return cachedTrayIcon
  }
  const possiblePaths = [
    path.join(app.getAppPath(), 'assets/tray-icon.png'),
    path.join(process.resourcesPath, 'assets/tray-icon.png'),
  ]
  for (const iconPath of possiblePaths) {
    if (fs.existsSync(iconPath)) {
      const icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) {
        cachedTrayIcon = icon
        return cachedTrayIcon
      }
      console.warn('[tray] icon file at %s is empty, falling back to placeholder', iconPath)
    }
  }
  console.warn('[tray] icon file missing, falling back to placeholder')
  cachedTrayIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACklEQVQ' +
    'I12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='
  )
  return cachedTrayIcon
}

/**
 * Destroys the system tray icon and resets retry state.
 */
function destroyTray() {
  if (trayRetryTimeout) {
    clearTimeout(trayRetryTimeout)
    trayRetryTimeout = null
  }
  if (tray) {
    try {
      tray.destroy()
    } catch (_) {
      /* ignore */
    }
    tray = null
  }
  trayRetryCount = 0
}

/**
 * Creates the system tray icon and its context menu.
 * Falls back to an empty/placeholder icon if the asset isn't present yet.
 */
function createTray() {
  if (settings && settings.showTrayIcon === false) return
  if (tray) return

  try {
    const icon = getTrayIcon()
    tray = new Tray(icon)
    tray.setToolTip('screen-buddy')
    if (process.platform === 'win32') {
      tray.on('click', () => {
        if (tray && !tray.isDestroyed()) {
          tray.popUpContextMenu()
        }
      })
    }
    buildTrayMenu()

    if (trayRetryTimeout) {
      clearTimeout(trayRetryTimeout)
      trayRetryTimeout = null
    }
    console.log('[main] System tray initialised')
  } catch (err) {
    console.log(`[tray] creation failed: ${err.message}`)
    if (trayRetryCount < MAX_TRAY_RETRIES) {
      trayRetryCount++
      trayRetryTimeout = setTimeout(() => {
        trayRetryTimeout = null
        createTray()
      }, 5000)
    } else {
      console.log('[tray] stopped retrying after 24 attempts')
    }
  }
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
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    {
      label: '💬 Open AI Chat',
      click: () => {
        triggerChatOpen('tray')
      },
    },
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
        openSettingsWindow()
      },
    },
    {
      label: isPaused ? '▶️  Resume' : '⏸️  Pause',
      click: () => {
        toggleManualPause('tray')
      },
    },
    { type: 'separator' },
    {
      label: '✖  Exit',
      click: () => {
        console.log('[main] Tray Quit clicked — quitting application')
        releaseSingleInstanceLock()
        isQuitting = true
        isShuttingDown = true
        ensureQuitWatchdog()
        destroyAllWindows()
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
  if (process.env.SCREEN_BUDDY_DEBUG === '1') {
    global.__sbDebugTrayMenu = menu
  }
}

function getCurrentCatDisplayGeometry() {
  const displays = electronScreen.getAllDisplays()
  const targetX = (lastKnownCatWinX !== null && Number.isFinite(lastKnownCatWinX)) ? lastKnownCatWinX : 0
  const targetY = (lastKnownCatWinY !== null && Number.isFinite(lastKnownCatWinY)) ? lastKnownCatWinY : 0
  const catDisplay = getDisplayForPoint(displays, targetX + NORMAL_CAT_CX, targetY + NORMAL_CAT_CY) || electronScreen.getPrimaryDisplay()
  return getDisplayCatGeometry(catDisplay)
}

function sendDisplayGeometryToRenderer() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('display:changed', getCurrentCatDisplayGeometry())
  }
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

  function applySettingsPipeline(nextSettings) {
    const prevSettings = settings || {}
    const allKeys = new Set([...Object.keys(prevSettings), ...Object.keys(nextSettings)])
    const changedKeys = []
    for (const key of allKeys) {
      const a = prevSettings[key]
      const b = nextSettings[key]
      const isObjA = a !== null && typeof a === 'object'
      const isObjB = b !== null && typeof b === 'object'
      if (isObjA || isObjB) {
        if (JSON.stringify(a) !== JSON.stringify(b)) changedKeys.push(key)
      } else if (a !== b) {
        changedKeys.push(key)
      }
    }

    settings = nextSettings
    saveSettings(settings)
    syncDeveloperMode(Boolean(settings.developerMode))

    // Toggle autostart .desktop file based on the new setting
    if (app.isPackaged) {
      if (settings.autostart) {
        setAutostart()
      } else {
        removeAutostart()
      }
    }
    notifyUpdaterSettingsChanged(settings)

    // Toggle system tray icon based on showTrayIcon setting
    if (settings.showTrayIcon !== false) {
      if (!tray) {
        createTray()
      }
    } else {
      if (tray) {
        destroyTray()
      }
    }

    // Stop or resume eye tracking polling based on eyeTracking setting
    if (!settings.eyeTracking || settings.reduceResourceUsage) {
      stopEyeTrackingPolling?.()
    } else if (isRendererEyeTrackingActive) {
      startEyeTrackingPolling?.()
    }

    // Update typing detector settings
    if (typingDetector) {
      typingDetector.updateSettings(settings)
    }

    // Update fullscreen safety poll interval if limitBackgroundCpu changed
    updateFullscreenSafetyPoll()
    if (process.platform === 'win32') {
      require('./winMediaFullscreenHelper').setLimitBackgroundCpu(Boolean(settings.limitBackgroundCpu))
    }

    // Update idle poll timer based on pauseAnimationIdle and eyeTracking
    updateIdlePollTimer?.()

    // If pauseAnimationIdle was toggled off, wake from idle state
    if (!settings.pauseAnimationIdle) {
      noteUserActivity('pauseAnimationIdle_disabled')
    }

    if (settings.paused !== undefined && Boolean(settings.paused) !== isPaused) {
      setManualPaused(Boolean(settings.paused), 'settings')
    }

    mainWindow?.webContents.send('settings:updated', settings)
    settingsWindow?.webContents.send('settings:updated', settings)

    notificationsManager?.applySettings()

    if (process.platform === 'win32') {
      const shortcutKeys = ['shortcutCallCat', 'shortcutTogglePause', 'shortcutChat']
      if (shortcutKeys.some((k) => changedKeys.includes(k))) {
        registerWindowsHotkeys()
      }
    }

    console.log('[main] Settings applied:', changedKeys.length ? changedKeys.join(', ') : '(none)')
    return settings
  }

  /**
   * Persist updated settings sent from the renderer.
   * Handles autostart side-effect automatically.
   */
  ipcMain.handle('settings:set', (_event, updatedSettings) => {
    const validated = validateSettingsUpdate(updatedSettings)
    const nextSettings = { ...settings, ...validated, ...(validated.reminders ? { reminders: { ...settings.reminders, ...validated.reminders } } : {}) }
    return applySettingsPipeline(nextSettings)
  })

  ipcMain.handle('settings:reset', () => {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      mascotPosition: settings.mascotPosition ?? DEFAULT_SETTINGS.mascotPosition,
    }
    return applySettingsPipeline(nextSettings)
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

    const roundX = Math.round(x)
    const roundY = Math.round(y)
    if (!Number.isFinite(roundX) || !Number.isFinite(roundY)) {
      console.warn(`[display] invalid flushMove coordinates: x=${x} y=${y}`)
      _moveInFlight = false
      return
    }

    const cmdArgs = [
      'dispatch', 'movewindowpixel',
      `exact ${roundX} ${roundY},${HYPR_TITLE_MATCH}`
    ]
    if (process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.log(
        `[main] hyprctl ${cmdArgs.join(' ')} (mode=${currentWindowMode} repositionInProgress=${mascotRepositionInProgress} trackedSize=${currentWinW}x${currentWinH})`
      )
    }

    try {
      const util = require('util')
      const execFile = util.promisify(require('child_process').execFile)
      await execFile('hyprctl', cmdArgs)
      // Update the tracked cat window position so positionBubbleWindow() uses
      // the coordinates we just confirmed to Hyprland, not a stale hyprctl query.
      lastKnownCatWinX = Math.round(x)
      lastKnownCatWinY = Math.round(y)
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        console.log(`[catwin] flushMove updated lastKnownCatWin=(${lastKnownCatWinX},${lastKnownCatWinY})`)
      }
      onCatWindowMoved()
    } catch (err) {
      console.error('[main] hyprctl spawn error:', err)
    } finally {
      _moveInFlight = false
      if (_movePending) {
        flushMove()
      } else {
        onCatMoveQueueDrained()
      }
    }
  }



  async function logHyprlandClientBounds(tag) {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        console.log(`[main] ${tag} hyprctl clients skipped (not on Hyprland)`)
      }
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
        if (process.env.SCREEN_BUDDY_DEBUG === '1') {
          console.log(`[main] ${tag} hyprctl clients: no screen-buddy/electron window found (scanned ${clients.length} clients)`)
        }
        return null
      }
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        for (const buddy of matches) {
          console.log(
            `[main] ${tag} hyprctl client title="${buddy.title}" class="${buddy.class}" initialClass="${buddy.initialClass}" at (${buddy.at?.[0]}, ${buddy.at?.[1]}) size ${buddy.size?.[0]}x${buddy.size?.[1]} floating=${buddy.floating} mapped=${buddy.mapped} hidden=${buddy.hidden} workspace=${buddy.workspace?.name}`
          )
        }
      }
      // Size gating must use the overlay window, not some other Electron client
      // (Cursor, Vite, etc.) that also matches class=electron.
      // Deterministically select the cat overlay client: exact title WINDOW_TITLE ('screen-buddy-overlay'),
      // excluding bubbles and settings windows, preferring floating=true if more than one matches.
      const overlayCandidates = matches.filter((c) => {
        const title = String(c.title || '')
        return title === WINDOW_TITLE &&
          title !== 'screen-buddy-bubbles' &&
          title !== 'screen-buddy-settings' &&
          !title.toLowerCase().includes('settings')
      })
      const overlay = overlayCandidates.find((c) => c.floating === true)
        || overlayCandidates[0]
        || matches.find((c) => {
          const title = String(c.title || '')
          return title.includes('screen-buddy') &&
            title !== 'screen-buddy-bubbles' &&
            title !== 'screen-buddy-settings' &&
            !title.toLowerCase().includes('settings')
        })
        || null
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

  async function applyDragWindowSize(width, height, dragX = 0, dragY = 0) {
    const sizeBefore = mainWindow?.getSize?.()
    const boundsBefore = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode drag calling setSize(${width}, ${height}) + setPosition(${dragX}, ${dragY}); ` +
      `resizable=${mainWindow?.isResizable?.()} ` +
      `electron getSize before=${JSON.stringify(sizeBefore)} ` +
      `getBounds before=${JSON.stringify(boundsBefore)}`
    )

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
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
      _movePending = null
      await resizeHyprlandWindow(width, height, 'window:mode drag-start')
      try {
        await execFile('hyprctl', ['dispatch', 'movewindowpixel', `exact 0 0,${HYPR_TITLE_MATCH}`])
      } catch (err) {
        console.error('[main] hyprctl drag move error:', err)
      }
      return waitForHyprlandSize(width, height, 'window:mode drag-start')
    }

    setWindowBoundsSafely(mainWindow, { x: dragX, y: dragY, width, height }, 'mainWindow-drag')
    return { applied: true, compositorSize: [width, height], attempts: 1, elapsedMs: 0 }
  }

  async function applyMascotWindowSize(tag) {
    const sizeBefore = mainWindow?.getSize?.()
    const boundsBefore = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode mascot calling setSize(${currentWinW}, ${currentWinH}) (${tag}); ` +
      `resizable=${mainWindow?.isResizable?.()} ` +
      `electron getSize before=${JSON.stringify(sizeBefore)} ` +
      `getBounds before=${JSON.stringify(boundsBefore)}`
    )
    mainWindow?.setSize(currentWinW, currentWinH)
    const sizeAfter = mainWindow?.getSize?.()
    const boundsAfter = mainWindow?.getBounds?.()
    console.log(
      `[main] window:mode mascot setSize(${currentWinW}, ${currentWinH}) RETURNED (${tag}); ` +
      `electron getSize after=${JSON.stringify(sizeAfter)} ` +
      `getBounds after=${JSON.stringify(boundsAfter)} ` +
      `(Electron size is not used to gate the renderer)`
    )
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      await resizeHyprlandWindow(currentWinW, currentWinH, `window:mode mascot ${tag}`)
      return waitForHyprlandSize(currentWinW, currentWinH, `window:mode mascot ${tag}`)
    }
    return { applied: true, compositorSize: [currentWinW, currentWinH], attempts: 1, elapsedMs: 0 }
  }

  ipcMain.handle('display:get-geometry', () => {
    return getCurrentCatDisplayGeometry()
  })

  ipcMain.on('window:move', (event, x, y) => {
    lastCatBoundsRefreshTime = 0

    // Ignore all renderer move requests during drag. The renderer positions the cat
    // visually within the fullscreen window, and we reposition the window natively
    // only when 'window:mode -> mascot' is emitted on release.
    if (mascotRepositionInProgress) {
      console.log(
        `[main] window:move DURING mascot reposition (blocked, currentWindowMode='${currentWindowMode}') catCenter=(${x}, ${y}) trackedSize=${currentWinW}x${currentWinH}`
      )
    }
    if (currentWindowMode === 'drag' || mascotRepositionInProgress) return

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.warn(`[display] invalid window:move coordinates: x=${x} y=${y}`)
      return
    }

    try {
      // Incoming x,y = desired cat center on the physical screen.
      // Convert to window top-left and clamp so the logical window stays on-screen.
      const displays = electronScreen.getAllDisplays()
      const isHypr = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)

      let wx
      let wy

      if (isHypr) {
        const { width: screenW, height: screenH } = electronScreen.getPrimaryDisplay().workAreaSize
        wx = Math.round(x - NORMAL_CAT_CX)
        wy = Math.round(y - NORMAL_CAT_CY)
        wx = Math.max(0, Math.min(wx, screenW - currentWinW))
        const limitY = screenH - currentWinH
        wy = Math.max(0, Math.min(wy, limitY))
        if (Number.isFinite(wx) && Number.isFinite(wy)) {
          const finalWx = Math.round(wx)
          const finalWy = Math.round(wy)
          try {
            mainWindow?.setPosition(finalWx, finalWy)
          } catch (posErr) {
            console.warn('[display] mainWindow.setPosition error on Hyprland:', posErr.message)
          }
          _movePending = { x: finalWx, y: finalWy }
          if (!_moveTimer) {
            _moveTimer = setInterval(flushMove, 33) // ~30 fps
            flushMove() // fire immediately for the first move
          }
        } else {
          console.warn(`[display] invalid computed wx/wy on Hyprland: wx=${wx} wy=${wy}`)
        }
      } else {
        const clamped = clampCatCenterPosition(displays, x, y, currentWinW, currentWinH, NORMAL_CAT_CX, NORMAL_CAT_CY)
        wx = clamped.winX
        wy = clamped.winY
        if (Number.isFinite(wx) && Number.isFinite(wy)) {
          if (process.env.SCREEN_BUDDY_DEBUG === '1' && process.env.SCREEN_BUDDY_DEBUG_MOVE === '1') {
            console.log(`[debug:move] t=${Date.now()} cat=(${Math.round(x)},${Math.round(y)}) win=(${wx},${wy})`)
          }
          setWindowBoundsSafely(mainWindow, { x: wx, y: wy, width: currentWinW, height: currentWinH }, 'mainWindow-move')
          lastKnownCatWinX = wx
          lastKnownCatWinY = wy
          onCatWindowMoved()
        } else {
          console.warn(`[display] invalid clamped window position: wx=${wx} wy=${wy}`)
        }
      }
    } catch (err) {
      console.warn(`[display] window:move error: ${err.message}`)
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
      bubblePositionGeneration++;
      if (bubbleFollowTrailingTimer) {
        clearTimeout(bubbleFollowTrailingTimer);
        bubbleFollowTrailingTimer = null;
      }
      const bubbleWasVisible = Boolean(
        bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()
      );
      // Block roam/move immediately while we expand — this is the drag guard.
      currentWindowMode = 'drag'
      if (bubbleWindow) {
        bubbleMapped = false
        bubbleWindow.hide()
        lastBubbleX = null
        lastBubbleY = null
      }
      // Temporarily expand to full work area so pointer events stay inside
      const displays = screen.getAllDisplays()
      const currentX = lastKnownCatWinX !== null ? lastKnownCatWinX : 0
      const currentY = lastKnownCatWinY !== null ? lastKnownCatWinY : 0
      const catDisplay = getDisplayForPoint(displays, currentX + NORMAL_CAT_CX, currentY + NORMAL_CAT_CY) || screen.getPrimaryDisplay()
      const wa = catDisplay.workArea || { x: 0, y: 0, ...catDisplay.workAreaSize }
      const { width, height } = wa
      const dragX = process.env.HYPRLAND_INSTANCE_SIGNATURE ? 0 : wa.x
      const dragY = process.env.HYPRLAND_INSTANCE_SIGNATURE ? 0 : wa.y
      currentWinW = width
      currentWinH = height
      const verify = await applyDragWindowSize(width, height, dragX, dragY)
      console.log(
        `[main] window:mode -> drag (${width}x${height} at ${dragX},${dragY}) title=${WINDOW_TITLE} ` +
        `applied=${verify.applied} compositorSize=${JSON.stringify(verify.compositorSize)} ` +
        `pollAttempts=${verify.attempts} pollElapsed=${verify.elapsedMs}ms ` +
        `handler ${Date.now() - modeEnteredAt}ms`
      )
      if (!verify.applied) {
        console.warn(`[main] window:mode drag-start failed size verification, recovering to mascot mode`)
        currentWindowMode = 'mascot'
        currentWinW = NORMAL_WIN_W
        currentWinH = NORMAL_WIN_H
        if (lastKnownCatWinX !== null && lastKnownCatWinY !== null && Number.isFinite(lastKnownCatWinX) && Number.isFinite(lastKnownCatWinY)) {
          const recX = Math.round(lastKnownCatWinX)
          const recY = Math.round(lastKnownCatWinY)
          try {
            mainWindow?.setPosition(recX, recY)
          } catch (posErr) {
            console.warn('[display] mainWindow.setPosition error in drag recovery:', posErr.message)
          }
          if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
            _movePending = null
            try {
              await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', `exact ${recX} ${recY},${HYPR_TITLE_MATCH}`])
            } catch (err) {
              console.error('[main] hyprctl drag-recovery move error:', err)
            }
          }
        }
        await applyMascotWindowSize('drag-start-recovery')
        if (bubbleWasVisible && bubbleWindow && !bubbleWindow.isDestroyed()) {
          bubbleMapped = false
          bubbleSkipLogged = false
          bubbleWindow.showInactive()
          waitForBubbleMapped().then(async () => {
            if (currentBubbleW !== 300 || currentBubbleH !== 120) {
              await applyBubbleWindowSize(currentBubbleW, currentBubbleH)
            } else if (lastKnownCatWinX !== null && lastKnownCatWinY !== null) {
              await positionBubbleWindow(lastKnownCatWinX, lastKnownCatWinY)
            }
          }).catch((err) => {
            console.warn('[bubble] drag-start recovery remap failed:', err.message)
          })
        }
      }
      return { applied: verify.applied, x: dragX, y: dragY, width, height, compositorSize: verify.compositorSize, elapsedMs: verify.elapsedMs }
    } else {
      bubblePositionGeneration++;
      mascotRepositionInProgress = true
      const isTreatment = mode === 'treatment'
      currentWinW = isTreatment ? TREATMENT_WIN_W : NORMAL_WIN_W
      currentWinH = isTreatment ? TREATMENT_WIN_H : NORMAL_WIN_H
      const cx = isTreatment ? TREATMENT_CAT_CX : NORMAL_CAT_CX
      const cy = isTreatment ? TREATMENT_CAT_CY : NORMAL_CAT_CY

      const [catX, catY] = args
      let verify = { applied: false, compositorSize: null, attempts: 0, elapsedMs: 0 }
      try {
        if (catX !== undefined && catY !== undefined) {
          if (!Number.isFinite(catX) || !Number.isFinite(catY)) {
            console.warn(`[display] invalid cat coordinates in window:mode: catX=${catX} catY=${catY}`)
          } else {
            const displays = screen.getAllDisplays()
            let wx
            let wy
            if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
              const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
              wx = Math.round(catX - cx)
              wy = Math.round(catY - cy)
              wx = Math.max(0, Math.min(wx, screenW - currentWinW))
              wy = Math.max(0, Math.min(wy, screenH - currentWinH + BOTTOM_OVERHANG_PX))
              if (Number.isFinite(wx) && Number.isFinite(wy)) {
                const finalWx = Math.round(wx)
                const finalWy = Math.round(wy)
                try {
                  mainWindow?.setPosition(finalWx, finalWy)
                } catch (posErr) {
                  console.warn('[display] mainWindow.setPosition error in window:mode:', posErr.message)
                }
                _movePending = null
                try {
                  await execFileAsync('hyprctl', ['dispatch', 'movewindowpixel', `exact ${finalWx} ${finalWy},${HYPR_TITLE_MATCH}`])
                  lastKnownCatWinX = finalWx
                  lastKnownCatWinY = finalWy
                } catch (err) {
                  console.error('[main] hyprctl mascot move error:', err)
                }
              }
            } else {
              const clamped = clampCatCenterPosition(displays, catX, catY, currentWinW, currentWinH, cx, cy)
              wx = clamped.winX
              wy = clamped.winY
              if (Number.isFinite(wx) && Number.isFinite(wy)) {
                setWindowBoundsSafely(mainWindow, { x: wx, y: wy, width: currentWinW, height: currentWinH }, 'mainWindow-mode-mascot')
                lastKnownCatWinX = wx
                lastKnownCatWinY = wy
              }
            }

            verify = await applyMascotWindowSize(isTreatment ? 'treatment' : 'drag-end')
            if (!isTreatment && Number.isFinite(wx) && Number.isFinite(wy)) {
              persistMascotPosition(wx, wy)
              if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
                sendDisplayGeometryToRenderer()
              }
            }
            console.log(`[main] window:mode -> ${mode} at window (${wx}, ${wy}) from cat center (${catX}, ${catY}) electronTitle="${mainWindow?.getTitle?.()}" hyprMatch=${HYPR_TITLE_MATCH} applied=${verify.applied} compositorSize=${JSON.stringify(verify.compositorSize)}`)
          }
        } else {
          verify = await applyMascotWindowSize(isTreatment ? 'treatment' : 'no-coords')
        }
      } finally {
        mascotRepositionInProgress = false
        currentWindowMode = mode
        if (bubbleWindow && (notificationsManager?.activeNotification || (lastCardState && lastCardState.hasContent))) {
          bubbleMapped = false;
          bubbleSkipLogged = false;
          bubbleWindow.showInactive();
          waitForBubbleMapped().then(async () => {
            if (currentBubbleW !== 300 || currentBubbleH !== 120) {
              await applyBubbleWindowSize(currentBubbleW, currentBubbleH);
            } else {
              await positionBubbleWindow();
            }
            await positionBubbleWindow();
          });
        }
        console.log(`[main] window:mode ${mode} handler finished in ${Date.now() - modeEnteredAt}ms; currentWindowMode now '${currentWindowMode}' applied=${verify.applied}`)
      }
      return { applied: verify.applied, width: currentWinW, height: currentWinH, compositorSize: verify.compositorSize, elapsedMs: verify.elapsedMs }
    }
  }

  ipcMain.on('window:persist-position', (event, x, y) => {
    if (isParked || effectivePauseState() || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        console.log(`[catwin] persist-position ignored (parked=${isParked} paused=${effectivePauseState()} visible=${mainWindow?.isVisible?.()})`)
      }
      return
    }
    if (currentWindowMode === 'drag' || mascotRepositionInProgress) {
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        console.log(`[catwin] persist-position ignored (mode=${currentWindowMode} drag=${mascotRepositionInProgress})`)
      }
      return
    }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }
    const displays = electronScreen.getAllDisplays()
    let wx
    let wy
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      const { width: screenW, height: screenH } = electronScreen.getPrimaryDisplay().workAreaSize
      wx = Math.round(x - NORMAL_CAT_CX)
      wy = Math.round(y - NORMAL_CAT_CY)
      wx = Math.max(0, Math.min(wx, screenW - currentWinW))
      wy = Math.max(0, Math.min(wy, screenH - currentWinH + BOTTOM_OVERHANG_PX))
    } else {
      const clamped = clampCatCenterPosition(displays, x, y, currentWinW, currentWinH, NORMAL_CAT_CX, NORMAL_CAT_CY)
      wx = clamped.winX
      wy = clamped.winY
    }
    if (Number.isFinite(wx) && Number.isFinite(wy)) {
      console.log(`[catwin] persist-position raw=(${x},${y}) win=(${wx},${wy}) mode=${currentWindowMode}`)
      lastKnownCatWinX = wx
      lastKnownCatWinY = wy
      persistMascotPosition(wx, wy)
      positionBubbleWindow()
    } else {
      console.warn(`[display] invalid coordinates in window:persist-position: wx=${wx} wy=${wy}`)
    }
  })

  // Mouse hit-testing & activity tracking
  ipcMain.on('mouse:enter-interactive', () => {
    // Passive pointer enter does not count as real user activity (avoids false idle wakes)
    void 0
  })
  ipcMain.on('mouse:leave-interactive', () => {
    // Passive pointer leave does not count as real user activity
    void 0
  })
  ipcMain.on('mascot:activity', () => {
    noteUserActivity('mascot_interaction')
  })

  // ── Pause / resume ────────────────────────────────────────────────────────

  /**
   * Renderer can toggle pause (e.g. from the settings modal checkbox).
   * We sync the main-process flag and rebuild the tray so it stays correct.
   */
  
  // ── Bubble card state ───────────────────────────────────────────────────

  // Overlay (App.jsx) pushes the current card-state snapshot whenever it changes.
  // We store it locally (for new bubble windows) and forward to the bubble renderer.
  ipcMain.on('bubble:card-state', async (_event, state) => {
    lastCardState = state;
    const hasContent = state && state.hasContent;

    // If we have content but no window yet, create it lazily
    if (hasContent && (!bubbleWindow || bubbleWindow.isDestroyed())) {
      if (!isCreatingBubble) {
        isCreatingBubble = true;
        try {
          await getBubbleWindow();
        } finally {
          isCreatingBubble = false;
        }
      }
    }

    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      if (hasContent) {
        // Ensure window is visible when there is card content, unless currently parked/paused
        if (effectivePauseState() || isParked) {
          console.log('[bubble] card content active while paused/parked — deferring display until unpark')
        } else if (!bubbleWindow.isVisible() && bubbleWindowReady && !notificationsManager?.activeNotification) {
          if (currentWindowMode !== 'drag' && !mascotRepositionInProgress) {
            bubbleMapped = false;
            bubbleSkipLogged = false;
            bubbleWindow.showInactive();
            await waitForBubbleMapped();
            if (currentBubbleW !== 300 || currentBubbleH !== 120) {
              await applyBubbleWindowSize(currentBubbleW, currentBubbleH);
            } else {
              await positionBubbleWindow();
            }
            await positionBubbleWindow();
          } else {
            console.log('[bubble] skipping show/reposition during drag');
          }
        }
      } else if (!notificationsManager?.activeNotification) {
        // No notification and no card — hide
        if (bubbleWindow.isVisible()) {
          bubbleMapped = false;
          bubbleWindow.hide();
          lastBubbleX = null;
          lastBubbleY = null;
          mainWindow?.webContents.send('notification:visible', false);
        }
      }

      if (bubbleWindowReady) {
        bubbleWindow.webContents.send('bubble:card-state', state);
      }
    }
  })

  // Bubble renderer reports rendered content dimensions; resize and reposition.
  ipcMain.on('bubble:size', (_event, w, h) => {
    if (typeof w !== 'number' || typeof h !== 'number') return;
    w = Math.max(160, Math.min(600, Math.round(w)));
    h = Math.max(40,  Math.min(500, Math.round(h)));
    if (w === currentBubbleW && h === currentBubbleH) return;
    console.log(`[bubble-size] ${currentBubbleW}x${currentBubbleH} -> ${w}x${h}`);
    currentBubbleW = w;
    currentBubbleH = h;
    if (currentWindowMode === 'drag' || mascotRepositionInProgress) {
      console.log('[bubble-size] saving size but skipping setSize during drag/reposition');
      return;
    }
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      applyBubbleWindowSize(w, h);
    }
  })

  // Bubble renderer (BubbleApp.jsx) requests a business-logic action.
  // Forward to the main overlay renderer (App.jsx) to handle state transitions.
  ipcMain.handle('bubble:get-initial-state', () => {
    return {
      cardState: lastCardState,
      notification: notificationsManager?.activeNotification || null,
    }
  })

  ipcMain.handle('shortcuts:get-status', () => {
    return shortcutRegistrationStatus
  })

  ipcMain.handle('platform:capabilities', () => {
    return getPlatformCapabilities()
  })

  ipcMain.handle('settings:consume-initial-tab', () => {
    const tab = pendingSettingsTab
    pendingSettingsTab = null
    return tab
  })

  ipcMain.on('bubble:action', (_event, type, payload) => {
    // chat:ready: BubbleApp has mounted and DOM-focused the input.
    // Apply OS-level window focus now -- this is the correct moment.
    if (type === 'chat:ready') {
      focusChatWindow();
      return;
    }
    if (type === 'chat:open-settings') {
      openSettingsWindow('chat');
      return;
    }
    if (type === 'update:open-settings') {
      openSettingsWindow('about');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bubble:action', 'update:dismiss');
      }
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bubble:action', type, payload);
    }
  })

  ipcMain.on('notification:dismiss', (_event, id, reason) => {
    notificationsManager?.handleNotificationDismiss(id, reason)
  })

  ipcMain.on('notification:action', (_event, id, actionKey) => {
    notificationsManager?.handleActionInvoked(id, actionKey)
  })

  ipcMain.handle('notifications:status', async () => {
    return notificationsManager
      ? await notificationsManager.getStatus()
      : { platform: process.platform, mode: 'system', running: false, nameTaken: false, ownerName: null, systemDaemonPresent: null }
  })

  ipcMain.on('reminder:state', (_event, state) => {
    console.log('[main] reminder state updated to:', state)
    notificationsManager?.setReminderActive(state !== 'IDLE_COUNTING')
  })

  ipcMain.on('pause:set', (_event, paused) => {
    setManualPaused(paused, 'renderer')
  })

  // ── Eye tracking (cursor follower) ──────────────────────────────────────
  let eyeTrackingBusy = false
  let lastCatBoundsRefreshTime = 0
  let cachedCatBounds = null
  let isRendererEyeTrackingActive = false

  stopEyeTrackingPolling = function () {
    if (eyeTrackingTimer) {
      clearTimeout(eyeTrackingTimer)
      eyeTrackingTimer = null
    }
    eyeTrackingBusy = false
  }

  startEyeTrackingPolling = function () {
    if (!settings || !settings.eyeTracking || settings.reduceResourceUsage) return
    if (eyeTrackingTimer) return

    const poll = async () => {
      if (eyeTrackingBusy) return
      eyeTrackingBusy = true

      let nextInterval = 125

      try {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
          stopEyeTrackingPolling()
          return
        }

        const now = Date.now()

        // Check idle timeout if pauseAnimationIdle is enabled
        if (settings?.pauseAnimationIdle) {
          if (!isSystemIdleState && now - lastUserActivityTime >= 120000) {
            isSystemIdleState = true
            console.log(`[power] System idle (no activity for 120s; last activity was ${lastActivityReason}) - pausing animation`)
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send('power:idle', true, lastActivityReason)
            }
          }
        }

        let catX
        let catY
        let catW
        let catH

        if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
          if (!cachedCatBounds || now - lastCatBoundsRefreshTime > 1000) {
            lastCatBoundsRefreshTime = now
            const client = await logHyprlandClientBounds('eye-tracking')
            if (client && client.at && client.size) {
              cachedCatBounds = {
                x: client.at[0],
                y: client.at[1],
                w: client.size[0],
                h: client.size[1],
              }
            }
          }

          if (cachedCatBounds) {
            catX = cachedCatBounds.x
            catY = cachedCatBounds.y
            catW = cachedCatBounds.w
            catH = cachedCatBounds.h
          } else if (lastKnownCatWinX != null && lastKnownCatWinY != null) {
            catX = lastKnownCatWinX
            catY = lastKnownCatWinY
            catW = currentWinW
            catH = currentWinH
          } else {
            const bounds = mainWindow.getBounds()
            catX = bounds.x
            catY = bounds.y
            catW = bounds.width
            catH = bounds.height
          }

          hyprctlSpawnCount++
          const { stdout } = await execFileAsync('hyprctl', ['cursorpos'])
          let cursorX = 0
          let cursorY = 0
          const trimmed = stdout.trim()
          if (trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed)
            cursorX = parsed.x
            cursorY = parsed.y
          } else {
            const parts = trimmed.split(/[\s,]+/).map(Number)
            cursorX = parts[0] || 0
            cursorY = parts[1] || 0
          }

          if (lastKnownCursorX != null && lastKnownCursorY != null) {
            if (Math.hypot(cursorX - lastKnownCursorX, cursorY - lastKnownCursorY) > 3) {
              lastCursorMovedTime = now
              noteUserActivity('cursor_moved')
            }
          }
          lastKnownCursorX = cursorX
          lastKnownCursorY = cursorY
          lastEyeCursorSampleTime = now

          const catCenterX = catX + catW / 2
          const catCenterY = catY + catH / 2
          const relX = Math.round(cursorX - catCenterX)
          const relY = Math.round(cursorY - catCenterY)

          const dist = Math.hypot(relX, relY)
          const timeSinceMove = now - lastCursorMovedTime
          if (isSystemIdleState) {
            nextInterval = 1000
          } else if (timeSinceMove >= 5000) {
            nextInterval = 500
          } else if (settings?.limitBackgroundCpu && dist > 400) {
            nextInterval = 375
          } else if (timeSinceMove < 2000) {
            nextInterval = 125
          } else {
            nextInterval = 250
          }

          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mascot:cursor-offset', { x: relX, y: relY })
          }
        } else {
          const bounds = mainWindow.getBounds()
          catX = bounds.x
          catY = bounds.y
          catW = bounds.width
          catH = bounds.height

          const pt = electronScreen.getCursorScreenPoint()
          if (lastKnownCursorX != null && lastKnownCursorY != null) {
            if (Math.hypot(pt.x - lastKnownCursorX, pt.y - lastKnownCursorY) > 3) {
              lastCursorMovedTime = now
              noteUserActivity('cursor_moved')
            }
          }
          lastKnownCursorX = pt.x
          lastKnownCursorY = pt.y

          const catCenterX = catX + catW / 2
          const catCenterY = catY + catH / 2
          const relX = Math.round(pt.x - catCenterX)
          const relY = Math.round(pt.y - catCenterY)

          const dist = Math.hypot(relX, relY)
          const timeSinceMove = now - lastCursorMovedTime
          if (isSystemIdleState) {
            nextInterval = 1000
          } else if (timeSinceMove >= 5000) {
            nextInterval = 500
          } else if (settings?.limitBackgroundCpu && dist > 400) {
            nextInterval = 375
          } else if (timeSinceMove < 2000) {
            nextInterval = 125
          } else {
            nextInterval = 250
          }

          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mascot:cursor-offset', { x: relX, y: relY })
          }
        }
      } catch (_err) {
        // Silently ignore transient hyprctl / IPC errors
      } finally {
        eyeTrackingBusy = false
        if (eyeTrackingTimer !== null) {
          eyeTrackingTimer = setTimeout(poll, nextInterval)
        }
      }
    }

    eyeTrackingTimer = setTimeout(poll, 125)
  }

  ipcMain.on('mascot:eye-tracking-active', (_event, active) => {
    isRendererEyeTrackingActive = Boolean(active)
    if (active && settings?.eyeTracking) {
      startEyeTrackingPolling()
    } else {
      stopEyeTrackingPolling()
    }
  })

  ipcMain.on('mascot:call-state', (_event, activeCallId) => {
    if (!activeCallId) {
      stopCallCursorWatch()
    } else if (activeCallWatch && activeCallWatch.callId !== activeCallId) {
      stopCallCursorWatch()
    }
  })

  // On-demand cursor offset query for active chase checks when eyeTracking is OFF
  ipcMain.handle('mascot:get-cursor-offset', async () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
        return null
      }
      let catX = 0
      let catY = 0
      let catW = currentWinW
      let catH = currentWinH
      if (lastKnownCatWinX != null && lastKnownCatWinY != null) {
        catX = lastKnownCatWinX
        catY = lastKnownCatWinY
      } else {
        const bounds = mainWindow.getBounds()
        catX = bounds.x
        catY = bounds.y
        catW = bounds.width
        catH = bounds.height
      }

      let cursorX = 0
      let cursorY = 0
      if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
        hyprctlSpawnCount++
        const { stdout } = await execFileAsync('hyprctl', ['cursorpos'])
        const trimmed = stdout.trim()
        if (trimmed.startsWith('{')) {
          const parsed = JSON.parse(trimmed)
          cursorX = parsed.x
          cursorY = parsed.y
        } else {
          const parts = trimmed.split(/[\s,]+/).map(Number)
          cursorX = parts[0] || 0
          cursorY = parts[1] || 0
        }
      } else {
        const pt = electronScreen.getCursorScreenPoint()
        cursorX = pt.x
        cursorY = pt.y
      }

      const catCenterX = catX + catW / 2
      const catCenterY = catY + catH / 2
      return {
        x: Math.round(cursorX - catCenterX),
        y: Math.round(cursorY - catCenterY),
      }
    } catch (_err) {
      return null
    }
  })

  // Perf diagnostics statistics handler
  ipcMain.handle('perf:get-stats', () => {
    return {
      hyprctlSpawns: hyprctlSpawnCount,
      lastActivityReason,
    }
  })

  // ── Chat ──────────────────────────────────────────────────────────────────

  /**
   * Renderer reports its current chat UI state so the hotkey watcher can
   * make informed decisions (e.g. ignore SUPER+C while waiting).
   * Values: 'idle' | 'input' | 'waiting' | 'reply'
   */
  ipcMain.on('chat:state', (_event, state) => {
    noteUserActivity('chat_state')
    notificationsManager?.setChatState(state)
    chatInputOpen = state
    console.log('[main] chat state updated to:', state)
    if (state === 'input') {
      try {
        if (bubbleWindow) {
          bubbleWindow.setFocusable(true);
        }
      } catch (err) { void err }
    } else {
      try {
        if (bubbleWindow) {
          bubbleWindow.setFocusable(false);
        }
      } catch (err) { void err }
    }
  })

  /**
   * Send a message to Gemini and return the reply.
   * The API key is read from main-process settings only — never exposed to renderer.
   */
  ipcMain.handle('chat:send', async (_event, userMessage) => {
    if (typeof userMessage !== 'string' || !userMessage.trim()) {
      return { ok: false, error: 'Message cannot be empty.' }
    }
    return await callGemini(userMessage.trim())
  })

  ipcMain.handle('chat:test-connection', async () => {
    const apiKey = settings?.geminiApiKey || process.env.GEMINI_API_KEY || ''
    if (!apiKey) {
      return { ok: false, error: 'Add your Gemini API key in Settings -> Chat & AI' }
    }

    const model = (settings?.geminiModel && settings.geminiModel.trim())
      ? settings.geminiModel.trim()
      : 'gemini-3.5-flash-lite'

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK' }] }],
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)

    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (fetchErr) {
      clearTimeout(timer)
      const isAbort = fetchErr.name === 'AbortError'
      console.error('[main] Gemini test fetch error:', isAbort ? 'timeout' : fetchErr.message)
      if (isAbort) {
        return { ok: false, error: 'Request timed out after 10s. Please try again.' }
      }
      return { ok: false, error: 'Network error: unable to reach Gemini.' }
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      let errorMessage = 'unknown error'
      try {
        const errData = await res.json()
        if (errData?.error?.message) errorMessage = errData.error.message
      } catch (_) {
        // Ignore JSON parse errors on error responses
      }
      console.error(`[main] Gemini test HTTP ${res.status}: ${errorMessage}`)
      if (res.status === 401) {
        return { ok: false, error: 'HTTP 401: Invalid API key. Please check your key in Settings.' }
      }
      if (res.status === 403) {
        return { ok: false, error: 'HTTP 403: Access forbidden. Please check your API key permissions.' }
      }
      if (res.status === 404) {
        return { ok: false, error: 'HTTP 404: Model not found. Please check your model name.' }
      }
      if (res.status === 429) {
        return { ok: false, error: 'HTTP 429: Rate limit exceeded. Please wait a moment and try again.' }
      }
      if (res.status >= 500) {
        return { ok: false, error: `HTTP ${res.status}: Gemini service is temporarily unavailable.` }
      }
      return { ok: false, error: `HTTP ${res.status}: Request failed.` }
    }

    let data
    try {
      data = await res.json()
    } catch (parseErr) {
      console.error('[main] Gemini test response parse error:', parseErr.message)
      return { ok: false, error: 'Failed to parse Gemini response.' }
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error('[main] Gemini test unexpected response shape:', JSON.stringify(data).slice(0, 200))
      return { ok: false, error: 'Received an empty or unexpected response from Gemini.' }
    }

    return { ok: true }
  })

  ipcMain.on('app:open-external', (_event, rawUrl) => {
    if (typeof rawUrl !== 'string') return
    try {
      const parsed = new URL(rawUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(rawUrl).catch((err) => {
          console.warn('[main] openExternal failed:', err.message)
        })
      }
    } catch (_) {
      // Ignore invalid URLs
    }
  })

  ipcMain.handle('app:copy-text', async (_e, text) => {
    if (typeof text !== 'string' || !text || text.length > 100000) {
      return { ok: false, error: 'Nothing to copy.' }
    }

    if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) {
      const copiedViaWlCopy = await new Promise((resolve) => {
        let settled = false
        let timeoutId = null
        const done = (val) => {
          if (!settled) {
            settled = true
            if (timeoutId) clearTimeout(timeoutId)
            resolve(val)
          }
        }

        timeoutId = setTimeout(() => {
          try {
            if (child) child.kill()
          } catch (err) {
            void err
          }
          done(false)
        }, 2000)

        let child
        try {
          child = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
        } catch (_) {
          done(false)
          return
        }

        child.on('error', () => {
          done(false)
        })

        child.on('exit', (code) => {
          done(code === 0)
        })

        child.stdin.on('error', () => {
          done(false)
        })

        try {
          child.stdin.write(text)
          child.stdin.end()
        } catch (_) {
          done(false)
        }
      })

      if (copiedViaWlCopy) {
        console.log('[clipboard] copied via wl-copy')
        return { ok: true }
      }
    }

    try {
      clipboard.writeText(text)
      console.log('[clipboard] copied via electron')
      return { ok: true }
    } catch (err) {
      console.log(`[clipboard] failed: ${err.message}`)
      return { ok: false, error: err.message }
    }
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

  /** Get current updater state */
  ipcMain.handle('updates:get-state', () => getUpdateState())

  /** Check for app updates via electron-updater or GitHub releases */
  ipcMain.handle('updates:check', async (_event, options) => {
    try {
      return await checkForUpdates(options)
    } catch (err) {
      return { status: 'error', currentVersion: app.getVersion(), error: err.message || 'Unknown update check error', reason: err.message || 'Unknown update check error' }
    }
  })

  /** Download available app update (user-triggered) */
  ipcMain.handle('updates:download', async () => {
    try {
      return await downloadUpdate()
    } catch (err) {
      return { status: 'error', currentVersion: app.getVersion(), error: err.message || 'Download failed', reason: err.message || 'Download failed' }
    }
  })

  /** Quit and apply downloaded app update (user-triggered) */
  ipcMain.handle('updates:install', () => installUpdate())

  /** Get current application version */
  ipcMain.handle('app:get-version', () => app.getVersion())

  /** Get system and application info for the About screen */
  ipcMain.handle('app:get-info', () => {
    let license = null
    try {
      const licensePaths = [
        path.join(app.getAppPath(), 'LICENSE'),
        path.join(process.resourcesPath, 'LICENSE'),
      ]
      for (const licensePath of licensePaths) {
        if (fs.existsSync(licensePath)) {
          const raw = fs.readFileSync(licensePath, 'utf8')
          const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          if (lines.length > 0 && lines[0].length <= 40) {
            license = lines[0]
            break
          }
        }
      }
      if (!license) {
        const pkgPaths = [
          path.join(app.getAppPath(), 'package.json'),
          path.join(process.resourcesPath, 'package.json'),
        ]
        for (const pkgPath of pkgPaths) {
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
            if (pkg.license && typeof pkg.license === 'string') {
              license = /license/i.test(pkg.license) ? pkg.license : `${pkg.license} License`
              break
            }
          }
        }
      }
    } catch (_) {
      license = null
    }

    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      dataDir: path.dirname(getSettingsPath()),
      license,
    }
  })

  /** Open the settings file directory in the OS file manager */
  ipcMain.handle('app:open-settings-folder', async () => {
    try {
      const dir = path.dirname(getSettingsPath())
      await shell.openPath(dir)
    } catch (err) {
      console.warn('[main] open-settings-folder failed:', err.message)
    }
  })

  /** Expose the resolved settings file path to the renderer for display */
  ipcMain.handle('settings:get-path', () => getSettingsPath())

  ipcMain.on('settings:open', (_event, initialTab) => {
    openSettingsWindow(initialTab || null)
  })

  // ── Mood state persistence ────────────────────────────────────────────────
  ipcMain.handle('get-mood-state', () => {
    if (!latestMoodState) {
      latestMoodState = loadAndCatchUpMoodState()
    }
    return latestMoodState
  })

  ipcMain.handle('save-mood-state', (_event, state) => {
    if (state && typeof state === 'object') {
      const affection = Number(state.affection)
      const energy = Number(state.energy)
      const savedAt = Number(state.savedAt) || Date.now()
      if (Number.isFinite(affection) && Number.isFinite(energy)) {
        latestMoodState = {
          affection: Math.min(100, Math.max(0, affection)),
          energy: Math.min(100, Math.max(0, energy)),
          savedAt,
        }
        saveMoodStateToDisk(latestMoodState)
      }
    }
    return { ok: true }
  })
}

// ─── Power monitor ───────────────────────────────────────────────────────────
/**
 * Use Electron's powerMonitor to pause reminders while the system is
 * suspended or the screen is locked, then resume when the user comes back.
 */
function registerPowerMonitor() {
  try {
    const idleTime = powerMonitor.getSystemIdleTime()
    console.log(`[power] powerMonitor.getSystemIdleTime() initial test: ${idleTime}s`)
  } catch (err) {
    console.log(`[power] powerMonitor.getSystemIdleTime() test error: ${err?.message}`)
  }

  let idlePollTimer = null
  stopIdlePollTimer = function () {
    if (idlePollTimer) {
      clearInterval(idlePollTimer)
      idlePollTimer = null
    }
  }
  updateIdlePollTimer = function () {
    stopIdlePollTimer()

    // Poll cursor only when pauseAnimationIdle is ON and eyeTracking is OFF.
    // When eyeTracking is ON, startEyeTrackingPolling already tracks cursor movement & idle state.
    // When both are OFF, zero cursor polling runs.
    if (settings?.pauseAnimationIdle && !settings?.eyeTracking) {
      idlePollTimer = setInterval(async () => {
        const now = Date.now()
        if (!isSystemIdleState && now - lastUserActivityTime >= 120000) {
          isSystemIdleState = true
          console.log(`[power] System idle (no activity for 120s; last activity was ${lastActivityReason}) - pausing animation`)
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('power:idle', true, lastActivityReason)
          }
        }

        if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
          try {
            hyprctlSpawnCount++
            const { stdout } = await execFileAsync('hyprctl', ['cursorpos'])
            const trimmed = stdout.trim()
            let curX = 0
            let curY = 0
            if (trimmed.startsWith('{')) {
              const parsed = JSON.parse(trimmed)
              curX = parsed.x
              curY = parsed.y
            } else {
              const parts = trimmed.split(/[\s,]+/).map(Number)
              curX = parts[0] || 0
              curY = parts[1] || 0
            }
            if (lastKnownCursorX != null && lastKnownCursorY != null) {
              if (Math.hypot(curX - lastKnownCursorX, curY - lastKnownCursorY) > 3) {
                lastCursorMovedTime = Date.now()
                noteUserActivity('cursor_moved')
              }
            }
            lastKnownCursorX = curX
            lastKnownCursorY = curY
          } catch (_err) {
            // ignore transient errors
          }
        } else {
          try {
            const pt = electronScreen.getCursorScreenPoint()
            if (lastKnownCursorX != null && lastKnownCursorY != null) {
              if (Math.hypot(pt.x - lastKnownCursorX, pt.y - lastKnownCursorY) > 3) {
                lastCursorMovedTime = Date.now()
                noteUserActivity('cursor_moved')
              }
            }
            lastKnownCursorX = pt.x
            lastKnownCursorY = pt.y
          } catch (_err) {
            // ignore
          }
        }
      }, 1000)
    }
  }

  updateIdlePollTimer()

  powerMonitor.on('suspend', () => {
    console.log('[main] System suspending — pausing reminders')
    mainWindow?.webContents.send('power:suspend')
  })

  powerMonitor.on('resume', () => {
    console.log('[main] System resumed — resuming reminders')
    mainWindow?.webContents.send('power:resume')
    noteUserActivity('system_resume')
  })

  powerMonitor.on('lock-screen', () => {
    console.log('[main] Screen locked — pausing reminders')
    mainWindow?.webContents.send('power:lock-screen')
  })

  powerMonitor.on('unlock-screen', () => {
    console.log('[main] Screen unlocked — resuming reminders')
    mainWindow?.webContents.send('power:unlock-screen')
    noteUserActivity('screen_unlock')
  })
}
