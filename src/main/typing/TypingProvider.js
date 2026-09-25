'use strict'

class TypingProvider {
  /** Uniquely identifies the backend */
  get id() { throw new Error('Not implemented') }
  
  /** User-friendly name */
  get name() { throw new Error('Not implemented') }
  
  /** Checks if the backend is physically supported on the current OS/Environment */
  async isSupported() { throw new Error('Not implemented') }
  
  /** Checks if the backend currently has the required permissions */
  async hasPermission() { throw new Error('Not implemented') }
  
  /** Triggers the UI/System flow to request permissions, if applicable */
  async requestPermission() { throw new Error('Not implemented') }
  
  /** Starts detection. Should throw or return false if permissions are missing. */
  async start(onActivity) { throw new Error('Not implemented') }
  
  /** Stops detection and cleans up handles/listeners */
  async stop() { throw new Error('Not implemented') }
}

module.exports = TypingProvider
