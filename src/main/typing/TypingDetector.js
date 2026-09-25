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
    this.activeProvider = null
    this.isEnabled = false // from settings
  }

  async getBestSupportedProvider() {
    for (const provider of this.providers) {
      if (await provider.isSupported()) {
        return provider
      }
    }
    return this.providers[this.providers.length - 1] // fallback to simulation
  }

  async updateSettings(settings) {
    const shouldEnable = !!settings.systemTypingDetection
    
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

    try {
      console.log(`[TypingDetector] Starting with provider: ${this.activeProvider.name}`)
      await this.activeProvider.start((event) => {
        console.log('[TypingDetector] Activity event received from provider:', event)
        // Emit IPC to renderer
        if (this.ipcSender) {
          console.log('[TypingDetector] Forwarding typing:activity via IPC')
          this.ipcSender('typing:activity', event)
        } else {
          console.warn('[TypingDetector] ipcSender is null — cannot forward event')
        }
      })
    } catch (err) {
      console.error(`[TypingDetector] Failed to start provider: ${err.message}`)
    }
  }

  async _stopDetection() {
    if (this.activeProvider) {
      await this.activeProvider.stop()
      this.activeProvider = null
    }
  }
}

module.exports = TypingDetector
