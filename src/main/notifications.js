const { sessionBus, interface: dbusInterface } = require('dbus-next')
const { Interface } = dbusInterface

// DO_NOT_QUEUE (1) means we do not queue if the name is already owned,
// and we never replace the existing owner.
const DBUS_NAME_FLAG_DO_NOT_QUEUE = 1

class NotificationsDaemon extends Interface {
  constructor(delegate) {
    super('org.freedesktop.Notifications')
    this.delegate = delegate // main.js methods for sending to renderer
  }

  Notify(app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout) {
    return this.delegate.onNotify({
      app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout
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
    GetServerInformation: { inSignature: '', outSignature: 'ssss' }
  },
  signals: {
    NotificationClosed: { signature: 'uu' },
    ActionInvoked: { signature: 'us' }
  }
})

function stripTags(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/<[^>]*>?/gm, '')
}

class NotificationsManager {
  constructor(mainWindow, settings, callbacks = {}) {
    this.callbacks = callbacks
    this.mainWindow = mainWindow
    this.settings = settings
    
    this.bus = null
    this.iface = null
    this.nextId = 1
    this.retryTimer = null
    this.daemonRunning = false
    this.queue = []
    
    // States from main.js
    this.isPaused = false
    this.chatState = 'idle'
    this.reminderActive = false
    
    this.activeNotification = null
  }

  start() {
    if (!this.settings.notificationsEnabled) return
    this.bus = sessionBus()
    this.iface = new NotificationsDaemon(this)
    this.bus.export('/org/freedesktop/Notifications', this.iface)
    this.requestName()
  }

  async requestName() {
    try {
      const reply = await this.bus.requestName('org.freedesktop.Notifications', DBUS_NAME_FLAG_DO_NOT_QUEUE)
      // 1 = PRIMARY_OWNER, 2 = IN_QUEUE, 3 = EXISTS, 4 = ALREADY_OWNER
      if (reply === 1 || reply === 4) {
        this.daemonRunning = true
        console.log('[notifications] Claimed org.freedesktop.Notifications successfully.')
        if (this.retryTimer) {
          clearInterval(this.retryTimer)
          this.retryTimer = null
        }
      } else {
        // Taken
        if (!this.retryTimer) {
          console.log(`[notifications] Name org.freedesktop.Notifications is already taken (reply=${reply}). Retrying every 15s.`)
          this.retryTimer = setInterval(() => this.requestName(), 15000)
        }
      }
    } catch (err) {
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
    if (this.bus && this.daemonRunning) {
      this.bus.releaseName('org.freedesktop.Notifications').catch(() => {})
      this.bus.disconnect()
      this.daemonRunning = false
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
    
    const blocklist = (this.settings.notificationAppBlocklist || []).map(a => String(a).toLowerCase())
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
      const qIndex = this.queue.findIndex(n => n.id === id)
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
      urgency: data.hints && data.hints.urgency ? data.hints.urgency.value : 1, // default normal
      expireTimeout: data.expire_timeout
    }

    if (this.isPaused) {
      // Drop immediately
      return id
    }

    if (this.activeNotification && this.activeNotification.id === id) {
      this.showNotification(notif)
      return id
    }
    
    const qIndex = this.queue.findIndex(n => n.id === id)
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
      const index = this.queue.findIndex(n => n.id === id)
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
