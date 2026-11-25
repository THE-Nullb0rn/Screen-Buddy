/**
 * screen-buddy — Electron preload script
 *
 * Runs in the renderer context with Node access, before the page loads.
 * Exposes a safe, typed API to the renderer via contextBridge so the
 * renderer never touches Node.js or Electron internals directly.
 *
 * All calls go through IPC channels defined in src/main/main.js.
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const ipcReceiveCounts = {}
const ipcSendCounts = {}

function recordSend(channel) {
  ipcSendCounts[channel] = (ipcSendCounts[channel] || 0) + 1
}

function recordReceive(channel) {
  ipcReceiveCounts[channel] = (ipcReceiveCounts[channel] || 0) + 1
}

const safeSend = (channel, ...args) => {
  recordSend(channel)
  return ipcRenderer.send(channel, ...args)
}

const safeInvoke = (channel, ...args) => {
  recordSend(channel)
  return ipcRenderer.invoke(channel, ...args)
}

/**
 * window.api — the only surface the React renderer touches.
 *
 * Naming convention:
 *   api.settings.*   — settings CRUD
 *   api.mouse.*      — hit-region notifications
 *   api.pause.*      — pause/resume control
 *   api.on.*         — subscribe to main-process push events
 *   api.off.*        — unsubscribe (cleanup in useEffect)
 */
contextBridge.exposeInMainWorld('api', {
  // ── Settings ──────────────────────────────────────────────────────────────

  /** Fetch the full settings object from the main process */
  getSettings: () => safeInvoke('settings:get'),

  /**
   * Persist updated settings. Pass a partial object; main process merges it.
   * Returns the new full settings object.
   * @param {object} updates
   */
  setSettings: (updates) => safeInvoke('settings:set', updates),

  /** Get the absolute path of the settings file (for display in the UI) */
  getSettingsPath: () => safeInvoke('settings:get-path'),

  /** Open the Settings window */
  openSettings: (tab) => safeSend('settings:open', tab),
  consumeInitialSettingsTab: () => safeInvoke('settings:consume-initial-tab'),
  getShortcutStatus: () => safeInvoke('shortcuts:get-status'),

  // ── Mouse hit-region ──────────────────────────────────────────────────────

  /**
   * Call when the pointer enters the interactive mascot/UI area.
   * Main process disables click-through so clicks are captured.
   */
  mouseEnterInteractive: () => safeSend('mouse:enter-interactive'),

  /**
   * Call when the pointer leaves the interactive area.
   * Main process re-enables click-through.
   */
  mouseLeaveInteractive: () => safeSend('mouse:leave-interactive'),
  setEyeTrackingActive: (active) => safeSend('mascot:eye-tracking-active', active),

  moveWindow: (x, y) => safeSend('window:move', x, y),
  persistPosition: (x, y) => safeSend('window:persist-position', x, y),
  setWindowMode: (mode, ...args) => safeInvoke('window:mode', mode, ...args),
  openExternal: (url) => safeSend('app:open-external', url),
  copyText: (text) => safeInvoke('app:copy-text', text),
  getVersion: () => safeInvoke('app:get-version'),
  getAppInfo: () => safeInvoke('app:get-info'),
  openSettingsFolder: () => safeInvoke('app:open-settings-folder'),
  resetSettings: () => safeInvoke('settings:reset'),
  testChatConnection: () => safeInvoke('chat:test-connection'),
  getMoodState: () => safeInvoke('get-mood-state'),
  saveMoodState: (state) => safeInvoke('save-mood-state', state),
  platform: process.platform,
  updates: { check: () => safeInvoke('updates:check') },
  getMainPerfStats: () => safeInvoke('perf:get-stats'),
  getCursorOffset: () => safeInvoke('mascot:get-cursor-offset'),
  getDisplayGeometry: () => safeInvoke('display:get-geometry'),
  getIpcStats: () => ({
    received: { ...ipcReceiveCounts },
    sent: { ...ipcSendCounts },
  }),

  // ── Pause / resume ────────────────────────────────────────────────────────

  /**
   * Notify the main process of the current pause state.
   * Updates the tray menu label to match.
   * @param {boolean} paused
   */
  setPaused: (paused) => safeSend('pause:set', paused),

  // ── Timer status ──────────────────────────────────────────────────────────

  /**
   * Update the tray tooltip with current Pomodoro / Stopwatch status.
   * The menu object stays in place so open submenus are not collapsed.
   * @param {{ mode: string, formattedTime: string, running: boolean }} status
   */
  updateTimerStatus: (status) => safeSend('timer:update-status', status),

  // ── Typing ────────────────────────────────────────────────────────────────
  
  /** Ask the main process for the status of the typing detection permissions */
  checkTypingPermission: () => safeInvoke('typing:check-permission'),

  // ── Chat ──────────────────────────────────────────────────────────────────
  notifications: {
    dismiss: (id, reason) => safeSend('notification:dismiss', id, reason),
    action: (id, actionKey) => safeSend('notification:action', id, actionKey),
    getStatus: () => safeInvoke('notifications:status'),
  },
  reportActivity: () => safeSend('mascot:activity'),
  sendReminderState: (state) => safeSend('reminder:state', state),

  chat: {
    send: (message) => safeInvoke('chat:send', message),
    setState: (state) => safeSend('chat:state', state),
  },

  // ── Push events from main → renderer ─────────────────────────────────────

  /**
   * Subscribe to a named channel.
   * Returns a cleanup function — call it inside useEffect's return.
   *
   * @param {string} channel
   * @param {Function} handler  called with (...args) when event fires
   * @returns {Function} unsubscribe
   */
  on: (channel, handler) => {
    const ALLOWED = [
      'tray:test-reminder',
      'reminder:trigger',
      'settings:updated',
      'tray:pause-state',
      'timer:start-pomodoro',
      'timer:start-stopwatch',
      'timer:stop',
      'timer:test-pomodoro-work-end',
      'power:suspend',
      'power:resume',
      'power:lock-screen',
      'power:unlock-screen',
      'power:idle',
      'media:status',
      'typing:activity',
      'chat:open',
      'notification:visible',
      'notification:show',
      'notification:close',
      'chat:dismiss',
      'bubble:card-state',
      'bubble:action',
      'chat:focus-input',
      'mascot:cursor-offset',
      'mascot:call',
      'display:changed',
      'shortcuts:status-updated',
      'settings:select-tab',
    ]
    if (!ALLOWED.includes(channel)) {
      console.warn('[preload] Blocked subscription to unknown channel:', channel)
      return () => {}
    }
    const wrapped = (_event, ...args) => {
      recordReceive(channel)
      handler(...args)
    }
    ipcRenderer.on(channel, wrapped)
    // Return an unsubscribe function for use in useEffect cleanup
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  // ── Bubble card state (overlay → bubble window) ──────────────────
  bubble: {
    sendCardState: (state) => safeSend('bubble:card-state', state),
    getInitialState: () => safeInvoke('bubble:get-initial-state'),
    action: (type, payload) => safeSend('bubble:action', type, payload),
    reportSize: (w, h) => safeSend('bubble:size', w, h),
  },
})
