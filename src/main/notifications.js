'use strict'

const { getEffectiveNotificationMode } = require('./settings')

// DO_NOT_QUEUE (1) means we do not queue if the name is already owned,
// and we never replace the existing owner.
const DBUS_NAME_FLAG_DO_NOT_QUEUE = 1

let dbusModule = null
let NotificationsDaemonClass = null

function loadDbus() {
  if (dbusModule) {
    return { dbusModule, NotificationsDaemonClass }
  }
  if (process.platform !== 'linux') {
    return null
  }
  try {
    dbusModule = require('dbus-next')
    const { Interface } = dbusModule.interface

    class NotificationsDaemon extends Interface {
      constructor(delegate) {
        super('org.freedesktop.Notifications')
        this.delegate = delegate // main.js methods for sending to renderer
      }

      Notify(app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout) {
        return this.delegate.onNotify({
          app_name,
          replaces_id,
          app_icon,
          summary,
          body,
          actions,
          hints,
          expire_timeout,
        })
      }

      CloseNotification(id) {
        this.delegate.onCloseNotification(id)
      }

      GetCapabilities() {
        return ['body', 'actions']
      }

      GetServerInformation() {
        return ['screen-buddy', 'THE-Nullb0rn', '0.1.0', '1.2']
      }

      // Signals
      NotificationClosed(id, reason) {
        return [id, reason]
      }

      ActionInvoked(id, action_key) {
        return [id, action_key]
      }
    }

    // Configure the D-Bus interface without decorators
    NotificationsDaemon.configureMembers({
      methods: {
        Notify: { inSignature: 'susssasa{sv}i', outSignature: 'u' },
        CloseNotification: { inSignature: 'u', outSignature: '' },
        GetCapabilities: { inSignature: '', outSignature: 'as' },
        GetServerInformation: { inSignature: '', outSignature: 'ssss' },
      },
      signals: {
        NotificationClosed: { signature: 'uu' },
        ActionInvoked: { signature: 'us' },
      },
    })

    NotificationsDaemonClass = NotificationsDaemon
    return { dbusModule, NotificationsDaemonClass }
  } catch (err) {
    console.error('[notifications] Failed to load dbus-next:', err)
    return null
  }
}

function stripTags(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/<[^>]*>?/gm, '')
}

class NotificationsManager {
  constructor(...args) {
    let mainWindow
    let settingsArg
    let callbacks
    if (typeof args[0] === 'function') {
      settingsArg = args[0]
      mainWindow = args[1]
      callbacks = args[2] || {}
    } else if (typeof args[1] === 'function') {
      mainWindow = args[0]
      settingsArg = args[1]
      callbacks = args[2] || {}
    } else if (args[0] && (args[0].webContents || typeof args[0].isDestroyed === 'function')) {
      mainWindow = args[0]
      settingsArg = args[1]
      callbacks = args[2] || {}
    } else {
      settingsArg = args[0]
      mainWindow = args[1]
      callbacks = args[2] || {}
    }

    this.callbacks = callbacks
    this.mainWindow = mainWindow
    this.getSettings = typeof settingsArg === 'function' ? settingsArg : () => settingsArg

    this.bus = null
    this.iface = null
    this.nextId = 1
    this.retryTimer = null
    this.daemonRunning = false
    this.nameTaken = false
    this.starting = false
    this.queue = []

    // States from main.js
    this.isPaused = false
    this.chatState = 'idle'
    this.reminderActive = false

    this.activeNotification = null
  }

  get settings() {
    return this.getSettings()
  }

  start() {
    if (process.platform !== 'linux') return
    if (this.daemonRunning || this.starting || this.retryTimer) return

    const settings = this.getSettings() || {}
    if (settings.notificationsEnabled === false) return

    this.starting = true

    const dbusInfo = loadDbus()
    if (!dbusInfo) {
      this.starting = false
      return
    }

    const { dbusModule: dbus, NotificationsDaemonClass: DaemonClass } = dbusInfo
    try {
      this.bus = dbus.sessionBus()
      this.iface = new DaemonClass(this)
      this.bus.export('/org/freedesktop/Notifications', this.iface)
      this.requestName()
    } catch (err) {
      console.error('[notifications] Failed to start D-Bus session:', err)
      this.starting = false
    }
  }

  async requestName() {
    if (!this.bus) {
      this.starting = false
      return
    }
    try {
      const reply = await this.bus.requestName('org.freedesktop.Notifications', DBUS_NAME_FLAG_DO_NOT_QUEUE)
      if (!this.bus) {
        this.starting = false
        return
      }
      this.starting = false
      // 1 = PRIMARY_OWNER, 2 = IN_QUEUE, 3 = EXISTS, 4 = ALREADY_OWNER
      if (reply === 1 || reply === 4) {
        this.daemonRunning = true
        this.nameTaken = false
        console.log('[notifications] Claimed org.freedesktop.Notifications successfully.')
        if (this.retryTimer) {
          clearInterval(this.retryTimer)
          this.retryTimer = null
        }
      } else {
        // Taken
        this.daemonRunning = false
        this.nameTaken = true
        if (!this.retryTimer) {
          console.log(`[notifications] Name org.freedesktop.Notifications is already taken (reply=${reply}). Retrying every 15s.`)
          this.retryTimer = setInterval(() => this.requestName(), 15000)
        }
      }
    } catch (err) {
      if (!this.bus) {
        this.starting = false
        return
      }
      this.starting = false
      this.nameTaken = true
      if (!this.retryTimer) {
        console.log('[notifications] Failed to request D-Bus name:', err.message, 'Retrying every 15s.')
        this.retryTimer = setInterval(() => this.requestName(), 15000)
      }
    }
  }

  stop() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
    this.starting = false
    this.nameTaken = false

    // Drop all queued notifications
    while (this.queue.length > 0) {
      const dropped = this.queue.shift()
      this.emitClosed(dropped.id, 4)
    }

    // Dismiss active notification through the existing dismiss/close callback path
    if (this.activeNotification) {
      this.handleNotificationDismiss(this.activeNotification.id, 2)
    }

    if (this.bus) {
      if (this.daemonRunning) {
        this.bus.releaseName('org.freedesktop.Notifications').catch(() => {
          /* ignore release errors */
        })
      }
      try {
        this.bus.disconnect()
      } catch (_err) {
        /* ignore disconnect errors */
      }
      this.bus = null
    }
    this.iface = null
    this.daemonRunning = false
  }

  applySettings() {
    const settings = this.getSettings() || {}
    const mode = getEffectiveNotificationMode(settings)
    const shouldRun = settings.notificationsEnabled !== false && mode === 'cat'
    const isRunning = this.daemonRunning
    const isRetrying = !!this.retryTimer || this.starting

    if (shouldRun && !isRunning && !isRetrying) {
      this.start()
    } else if (!shouldRun && (isRunning || isRetrying)) {
      this.stop()
    }

    console.log(`[notifications] applySettings: mode=${mode} shouldRun=${shouldRun} running=${this.daemonRunning}`)
  }

  getStatus() {
    const settings = this.getSettings() || {}
    return {
      platform: process.platform,
      mode: getEffectiveNotificationMode(settings),
      running: this.daemonRunning,
      nameTaken: this.nameTaken,
    }
  }

  // State updates from main.js
  setPaused(paused) {
    this.isPaused = paused
    this.flushQueueIfNeeded()
  }

  setChatState(state) {
    this.chatState = state
    this.flushQueueIfNeeded()
  }

  setReminderActive(active) {
    this.reminderActive = active
    this.flushQueueIfNeeded()
  }

  isBusy() {
    return this.chatState !== 'idle' || this.reminderActive || this.activeNotification !== null
  }

  flushQueueIfNeeded(closedId = null) {
    if (this.isPaused) {
      // Drop all queued when paused
      while (this.queue.length > 0) {
        const dropped = this.queue.shift()
        this.emitClosed(dropped.id, 4)
      }
      if (closedId && this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.callbacks.onHide) this.callbacks.onHide(closedId)
        else this.mainWindow.webContents.send('notification:close', closedId)
      }
      return
    }

    if (!this.isBusy() && this.queue.length > 0) {
      const next = this.queue.shift()
      this.showNotification(next)
    } else if (closedId && this.activeNotification === null) {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.callbacks.onHide) this.callbacks.onHide(closedId)
        else this.mainWindow.webContents.send('notification:close', closedId)
      }
    }
  }

  onNotify(data) {
    const id = data.replaces_id !== 0 ? data.replaces_id : this.nextId++

    const appNameStr = data.app_name || ''
    const summaryStr = data.summary || ''
    const bodyStr = data.body || ''

    const settings = this.getSettings() || {}
    const blocklist = (settings.notificationAppBlocklist || []).map((a) => String(a).toLowerCase())
    const isBlocked = blocklist.includes(appNameStr.toLowerCase())

    console.log(`[notifications] Notify from '${appNameStr}' id=${id} (blocked=${isBlocked})`)

    if (appNameStr.toLowerCase() === 'screen-buddy' || isBlocked) {
      return id // Ignore but return id
    }

    const strippedSummary = stripTags(summaryStr).trim()
    const strippedBody = stripTags(bodyStr).trim()

    if (!strippedSummary && !strippedBody) {
      return id // Ignore empty notifications
    }

    let rev = 1

    // Check if replacing current active
    if (this.activeNotification && this.activeNotification.id === id) {
      rev = (this.activeNotification.rev || 0) + 1
    } else {
      // Check if replacing in queue
      const qIndex = this.queue.findIndex((n) => n.id === id)
      if (qIndex >= 0) {
        rev = (this.queue[qIndex].rev || 0) + 1
      }
    }

    const notif = {
      id,
      rev,
      appName: appNameStr,
      summary: strippedSummary,
      body: strippedBody,
      actions: data.actions || [],
      urgency: data.hints?.urgency?.value ?? 1, // default normal
      expireTimeout: data.expire_timeout,
    }

    if (this.isPaused) {
      // Drop immediately
      return id
    }

    if (this.activeNotification && this.activeNotification.id === id) {
      this.showNotification(notif)
      return id
    }

    const qIndex = this.queue.findIndex((n) => n.id === id)
    if (qIndex >= 0) {
      this.queue[qIndex] = notif
      return id
    }

    this.queue.push(notif)

    if (this.queue.length > 5) {
      const dropped = this.queue.shift() // drop oldest
      this.emitClosed(dropped.id, 4) // 4 = undefined/other
    }

    this.flushQueueIfNeeded()

    return id
  }

  onCloseNotification(id) {
    if (this.activeNotification && this.activeNotification.id === id) {
      this.activeNotification = null
      this.emitClosed(id, 3) // 3 = closed via CloseNotification
      this.flushQueueIfNeeded(id)
    } else {
      // Remove from queue if present
      const index = this.queue.findIndex((n) => n.id === id)
      if (index >= 0) {
        this.queue.splice(index, 1)
        this.emitClosed(id, 3)
      }
    }
  }

  showNotification(notif) {
    this.activeNotification = notif
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.callbacks.onShow) this.callbacks.onShow(notif)
      else this.mainWindow.webContents.send('notification:show', notif)
    }
  }

  // Called from renderer IPC
  handleNotificationDismiss(id, reason) {
    if (this.activeNotification && this.activeNotification.id === id) {
      this.activeNotification = null
      this.emitClosed(id, reason)
      this.flushQueueIfNeeded(id)
    }
  }

  handleActionInvoked(id, actionKey) {
    if (this.iface) {
      this.iface.ActionInvoked(id, actionKey)
    }
  }

  emitClosed(id, reason) {
    if (this.iface) {
      this.iface.NotificationClosed(id, reason)
    }
  }
}

module.exports = { NotificationsManager }
