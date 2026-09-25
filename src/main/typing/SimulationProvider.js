'use strict'

const TypingProvider = require('./TypingProvider')

function randBetween(min, max) {
  return min + Math.random() * (max - min)
}

class SimulationProvider extends TypingProvider {
  constructor() {
    super()
    this._burstTimeout = null
    this._typingTimeout = null
    this._onActivity = null
  }

  get id() { return 'simulation' }
  get name() { return 'Simulation (Random Idle)' }

  async isSupported() { return true }
  async hasPermission() { return true }
  async requestPermission() { return { status: 'granted' } }

  async start(onActivity) {
    this._onActivity = onActivity
    this._scheduleNextBurst()
  }

  async stop() {
    clearTimeout(this._burstTimeout)
    clearTimeout(this._typingTimeout)
    this._onActivity = null
  }

  _scheduleNextBurst() {
    // Wait between 10 and 30 seconds before a typing burst
    const delay = randBetween(10000, 30000)
    this._burstTimeout = setTimeout(() => {
      this._simulateTypingBurst()
    }, delay)
  }

  _simulateTypingBurst() {
    // Burst lasts between 2 and 6 seconds
    const duration = randBetween(2000, 6000)
    const endTime = Date.now() + duration
    
    // Keystroke frequency inside burst
    const emitKey = () => {
      if (Date.now() > endTime) {
        this._scheduleNextBurst()
        return
      }
      
      if (this._onActivity) {
        this._onActivity({ isActive: true })
      }
      // Delay between 50ms and 300ms to simulate typing speed variation
      this._typingTimeout = setTimeout(emitKey, randBetween(50, 300))
    }
    
    emitKey()
  }
}

module.exports = SimulationProvider
