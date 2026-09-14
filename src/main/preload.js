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
  getSettings: () => ipcRenderer.invoke('settings:get'),

  /**
   * Persist updated settings. Pass a partial object; main process merges it.
   * Returns the new full settings object.
   * @param {object} updates
   */
  setSettings: (updates) => ipcRenderer.invoke('settings:set', updates),

  /** Get the absolute path of the settings file (for display in the UI) */
  getSettingsPath: () => ipcRenderer.invoke('settings:get-path'),

  // ── Mouse hit-region ──────────────────────────────────────────────────────

  /**
   * Call when the pointer enters the interactive mascot/UI area.
   * Main process disables click-through so clicks are captured.
   */
  mouseEnterInteractive: () => ipcRenderer.send('mouse:enter-interactive'),

  /**
   * Call when the pointer leaves the interactive area.
   * Main process re-enables click-through.
   */
  mouseLeaveInteractive: () => ipcRenderer.send('mouse:leave-interactive'),

  // ── Pause / resume ────────────────────────────────────────────────────────

  /**
   * Notify the main process of the current pause state.
   * Updates the tray menu label to match.
   * @param {boolean} paused
   */
  setPaused: (paused) => ipcRenderer.send('pause:set', paused),

  // ── Timer status ──────────────────────────────────────────────────────────

  /**
   * Update the tray tooltip with current Pomodoro / Stopwatch status.
   * The menu object stays in place so open submenus are not collapsed.
   * @param {{ mode: string, formattedTime: string, running: boolean }} status
   */
  updateTimerStatus: (status) => ipcRenderer.send('timer:update-status', status),

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
      'tray:open-settings',
      'tray:pause-state',
      'timer:start-pomodoro',
      'timer:start-stopwatch',
      'timer:stop',
      'timer:test-pomodoro-work-end',
      'power:suspend',
      'power:resume',
      'power:lock-screen',
      'power:unlock-screen',
    ]
    if (!ALLOWED.includes(channel)) {
      console.warn('[preload] Blocked subscription to unknown channel:', channel)
      return () => {}
    }
    const wrapped = (_event, ...args) => handler(...args)
    ipcRenderer.on(channel, wrapped)
    // Return an unsubscribe function for use in useEffect cleanup
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
})
