'use strict'

/**
 * Watch for the presence of the desktop shell's StatusNotifierWatcher on D-Bus.
 * Mitigates race conditions at login (e.g. autostart alongside Quickshell).
 *
 * @param {object} options
 * @param {() => void} options.onReady Callback when watcher is present and settled
 * @param {() => void} [options.onLost] Callback when watcher is removed
 * @param {number} [options.settleMs=800] Settle delay after watcher appears
 * @param {number} [options.timeoutMs=60000] Fallback timeout if watcher never appears
 * @returns {{ stop: () => void }}
 */
function watchTrayHost({ onReady, onLost, settleMs = 800, timeoutMs = 60000 }) {
  let stopped = false
  let settleTimer = null
  let timeoutTimer = null
  let bus = null
  let iface = null
  let nameOwnerChangedHandler = null

  function scheduleReady() {
    if (stopped) return
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    settleTimer = setTimeout(() => {
      settleTimer = null
      if (stopped) return
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      console.log('[tray] watcher present, creating tray')
      if (typeof onReady === 'function') {
        onReady()
      }
    }, settleMs)
  }

  function handleWatcherLost() {
    if (stopped) return
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    console.log('[tray] watcher lost')
    if (typeof onLost === 'function') {
      onLost()
    }
  }

  function stop() {
    if (stopped) return
    stopped = true

    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }

    if (iface && nameOwnerChangedHandler) {
      try {
        iface.removeListener('NameOwnerChanged', nameOwnerChangedHandler)
      } catch (_err) {
        /* ignore */
      }
      nameOwnerChangedHandler = null
    }

    if (bus) {
      try {
        bus.disconnect()
      } catch (_err) {
        /* ignore */
      }
      bus = null
    }
  }

  if (process.platform !== 'linux') {
    process.nextTick(() => {
      if (!stopped && typeof onReady === 'function') {
        onReady()
      }
    })
    return { stop }
  }

  let dbus
  try {
    dbus = require('dbus-next')
  } catch (_err) {
    console.log('[tray] D-Bus unavailable, creating tray immediately')
    process.nextTick(() => {
      if (!stopped && typeof onReady === 'function') {
        onReady()
      }
    })
    return { stop }
  }

  let fallbackTriggered = false
  function triggerFallback() {
    if (stopped || fallbackTriggered) return
    fallbackTriggered = true
    stop()
    console.log('[tray] D-Bus unavailable, creating tray immediately')
    if (typeof onReady === 'function') process.nextTick(onReady)
  }

  try {
    bus = dbus.sessionBus()
    bus.on('error', () => {
      if (!iface) {
        triggerFallback()
      }
    })
  } catch (_err) {
    triggerFallback()
    return { stop }
  }

  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      if (stopped) return
      if (settleTimer) return
      console.log('[tray] watcher timeout, creating tray anyway')
      if (typeof onReady === 'function') {
        onReady()
      }
    }, timeoutMs)
  }

  async function startWatching() {
    try {
      const obj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
      if (stopped) return
      iface = obj.getInterface('org.freedesktop.DBus')

      nameOwnerChangedHandler = (name, _oldOwner, newOwner) => {
        if (name !== 'org.kde.StatusNotifierWatcher') return
        if (newOwner) {
          scheduleReady()
        } else {
          handleWatcherLost()
        }
      }

      iface.on('NameOwnerChanged', nameOwnerChangedHandler)

      const hasOwner = await iface.NameHasOwner('org.kde.StatusNotifierWatcher')
      if (stopped) return

      if (hasOwner) {
        scheduleReady()
      } else {
        console.log('[tray] waiting for StatusNotifierWatcher')
      }
    } catch (_err) {
      triggerFallback()
    }
  }

  startWatching()

  return { stop }
}

module.exports = { watchTrayHost }
