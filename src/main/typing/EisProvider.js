'use strict'

const TypingProvider = require('./TypingProvider')

class EisProvider extends TypingProvider {
  get id() { return 'libei' }
  get name() { return 'XDG Portal (EIS)' }

  async isSupported() {
    // Stub implementation: wait for Node bindings
    return false
  }

  async hasPermission() { return false }
  
  async requestPermission() {
    return { status: 'denied', instructions: 'Not implemented.' }
  }

  async start(onActivity) { throw new Error('Not implemented') }
  async stop() {}
}

module.exports = EisProvider
