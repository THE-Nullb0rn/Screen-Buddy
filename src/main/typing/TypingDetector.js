'use strict'

const EisProvider = require('./EisProvider')
const DevInputProvider = require('./DevInputProvider')
const SimulationProvider = require('./SimulationProvider')

class TypingDetector {
  constructor(ipcSender) {
    this.ipcSender = ipcSender
    this.providers = [
      new EisProvider(),
      new DevInputProvider(),
      new SimulationProvider()
    ]
    if (process.platform === 'win32') {
      // Loaded lazily on Windows only so uiohook is never required on Linux.
      const UiohookProvider = require('./UiohookProvider')
      this._uiohookProvider = new UiohookProvider()
      this.providers.unshift(this._uiohookProvider)
    } else {
      this._uiohookProvider = null
    }
    this.activeProvider = null
    this.isEnabled = false // from settings
    this._paused = false
    this._lastSettings = null
    this._uiohookFailed = false
  }

  getCapabilityStatus() {
    if (process.platform !== 'win32') {
      return { available: true }
    }
    if (this._uiohookFailed) {
      return { available: false, reason: 'Global keyboard hook failed (using fallback)' }
    }
    return this._uiohookProvider
      ? this._uiohookProvider.checkAvailability()
      : { available: false, reason: 'Keyboard hook provider missing' }
  }

  async getBestSupportedProvider() {
    for (const provider of this.providers) {
      if (await provider.isSupported()) {
        return provider
      }
    }
    return this.providers[this.providers.length - 1] // fallback to simulation
  }

  _computeShouldEnable(settings) {
    if (process.platform === 'win32') {
      return Boolean(settings?.systemTypingDetection) && !this._paused
    }
    return !!(settings?.systemTypingDetection || settings?.pauseAnimationIdle)
  }

  async setPaused(paused) {
    const nextPaused = Boolean(paused)
    if (this._paused === nextPaused) return
    this._paused = nextPaused
    if (this._lastSettings) {
      await this.updateSettings(this._lastSettings)
    }
  }

  async updateSettings(settings) {
    this._lastSettings = settings
    const shouldEnable = this._computeShouldEnable(settings)

    if (this.isEnabled !== shouldEnable) {
      this.isEnabled = shouldEnable

      if (this.isEnabled) {
        await this._startDetection()
      } else {
        await this._stopDetection()
      }
    }
  }

  async checkPermissionStatus() {
    if (process.platform === 'win32') {
      return { supported: true, permitted: true, provider: 'uiohook' }
    }
    const provider = await this.getBestSupportedProvider()

    if (provider.id === 'simulation') {
      // If we're falling back to simulation, we don't have true system typing detection.
      // But we report granted so the UI doesn't show errors, or we can just say granted.
      return { supported: true, permitted: true, provider: provider.id }
    }

    const hasPerm = await provider.hasPermission()
    if (hasPerm) {
      return { supported: true, permitted: true, provider: provider.id }
    }

    const request = await provider.requestPermission()
    return {
      supported: true,
      permitted: false,
      provider: provider.id,
      instructions: request.instructions
    }
  }

  async _startDetection() {
    await this._stopDetection()

    const provider = await this.getBestSupportedProvider()
    if (await provider.hasPermission()) {
      this.activeProvider = provider
    } else {
      // Fallback to simulation if preferred provider lacks permissions
      this.activeProvider = this.providers.find(p => p.id === 'simulation')
    }

    const handleActivity = (event) => {
      if (process.env.SCREEN_BUDDY_DEBUG === '1') {
        console.log('[TypingDetector] Activity event received from provider:', event)
      }
      if (this.ipcSender) {
        this.ipcSender('typing:activity', event)
      }
    }

    try {
      console.log(`[TypingDetector] Starting with provider: ${this.activeProvider.name}`)
      await this.activeProvider.start(handleActivity)
    } catch (err) {
      if (this.activeProvider?.id === 'uiohook') {
        this._uiohookFailed = true
        console.warn(`[TypingDetector] uiohook-napi unavailable (${err.message}); falling back to SimulationProvider`)
        const sim = this.providers.find(p => p.id === 'simulation')
        if (sim) {
          this.activeProvider = sim
          try {
            await sim.start(handleActivity)
          } catch (simErr) {
            console.error(`[TypingDetector] Failed to start fallback SimulationProvider: ${simErr.message}`)
          }
        }
        return
      }
      console.error(`[TypingDetector] Failed to start provider: ${err.message}`)
    }
  }

  async _stopDetection() {
    if (this.activeProvider) {
      await this.activeProvider.stop()
      this.activeProvider = null
    }
  }

  /**
   * Public, idempotent dispose method.
   * Stops the active provider (killing any /dev/input child processes),
   * clears the active provider reference, and nulls the IPC sender so that
   * late-arriving events from the provider thread are silently dropped rather
   * than thrown as "Object has been destroyed" errors.
   */
  async stop() {
    this.ipcSender = null  // Drop sender first — prevents any in-flight callback from sending
    this.isEnabled = false
    await this._stopDetection()
  }
}

module.exports = TypingDetector
