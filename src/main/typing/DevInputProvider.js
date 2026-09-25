'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const TypingProvider = require('./TypingProvider')

class DevInputProvider extends TypingProvider {
  constructor() {
    super()
    this._streams = []
    
    // State tracking across all devices
    this._ctrlHeld = false
    this._altHeld = false
    this._metaHeld = false
    this._numLockOn = false
  }

  get id() { return 'dev-input' }
  get name() { return '/dev/input' }

  async isSupported() {
    return os.platform() === 'linux' && fs.existsSync('/dev/input')
  }

  async hasPermission() {
    // Check if the current user is in the 'input' group.
    try {
      const groups = process.getgroups()
      // find group id of 'input'
      const groupData = fs.readFileSync('/etc/group', 'utf-8')
      const inputLine = groupData.split('\n').find(line => line.startsWith('input:'))
      if (!inputLine) return false
      const inputGid = parseInt(inputLine.split(':')[2], 10)
      return groups.includes(inputGid)
    } catch (err) {
      console.warn('[DevInputProvider] Error checking permissions:', err)
      return false
    }
  }

  async requestPermission() {
    return {
      status: 'pending',
      instructions: `Please open your terminal and run: sudo usermod -aG input $USER\nYou must log out and log back in for this to take effect.`
    }
  }

  async start(onActivity) {
    if (!(await this.hasPermission())) {
      throw new Error('Permission denied for /dev/input')
    }

    try {
      // 1. Check initial Num Lock state from sysfs (if available)
      this._numLockOn = false
      try {
        const ledsDir = '/sys/class/leds'
        if (fs.existsSync(ledsDir)) {
          const ledDirs = fs.readdirSync(ledsDir)
          for (const dir of ledDirs) {
            if (dir.includes('numlock')) {
              const brightness = fs.readFileSync(path.join(ledsDir, dir, 'brightness'), 'utf-8').trim()
              if (brightness === '1') {
                this._numLockOn = true
                break
              }
            }
          }
        }
      } catch (err) {
        console.warn('[DevInputProvider] Failed to read initial numlock state:', err.message)
      }

      // 2. Scan devices
      const devices = fs.readFileSync('/proc/bus/input/devices', 'utf-8')
      const blocks = devices.split('\n\n')
      
      const kbdEvents = []
      for (const block of blocks) {
        // Look for keyboard handler
        if (block.includes('Handlers=') && block.includes('kbd') && block.includes('event')) {
          const match = block.match(/event(\d+)/)
          if (match) {
            kbdEvents.push(`/dev/input/event${match[1]}`)
          }
        }
      }

      if (kbdEvents.length === 0) {
        console.warn('[DevInputProvider] No keyboard event devices found.')
        return
      }

      console.log('[DevInputProvider] Selected keyboard devices:', kbdEvents)

      for (const devicePath of kbdEvents) {
        try {
          // BUG FIX: Do NOT use fs.createReadStream on character devices!
          // Node's fs streams use the libuv thread pool (default size 4).
          // Reading 4+ blocking devices will permanently starve the thread pool
          // and freeze all other filesystem/IPC operations (including page loading).
          // Spawning 'cat' uses non-blocking pipes instead of the thread pool.
          const catProc = require('child_process').spawn('cat', [devicePath])
          
          let leftover = Buffer.alloc(0)
          
          // Allowed evdev keycodes that are independent of numlock
          const ALLOWED_KEYCODES = new Set([
            2,3,4,5,6,7,8,9,10,11, // 1-0
            12, 13, 14, // - = Backspace
            16,17,18,19,20,21,22,23,24,25, // q-p
            26, 27, 28, // [ ] Enter
            30,31,32,33,34,35,36,37,38, // a-l
            39, 40, 41, // ; ' `
            43, // \
            44,45,46,47,48,49,50, // z-m
            51, 52, 53, // , . /
            57, // Space
            96, 98, 55, 74, 78 // Numpad Enter, /, *, -, +
          ])

          // Keycodes that only act as typing when Num Lock is ON
          const NUMPAD_CODES = new Set([
            71,72,73,75,76,77,79,80,81,82,83 // 7-9, 4-6, 1-3, 0, .
          ])

          catProc.stdout.on('data', (chunk) => {
            leftover = Buffer.concat([leftover, chunk])
            
            // struct input_event on 64-bit Linux is 24 bytes:
            // struct timeval (16 bytes), __u16 type (2 bytes), __u16 code (2 bytes), __s32 value (4 bytes)
            while (leftover.length >= 24) {
              const eventBuf = leftover.subarray(0, 24)
              leftover = leftover.subarray(24)
              
              const type = eventBuf.readUInt16LE(16)
              const code = eventBuf.readUInt16LE(18)
              const value = eventBuf.readInt32LE(20)
              
              if (type === 17 && code === 0) {
                // EV_LED (17), LED_NUML (0)
                this._numLockOn = (value === 1)
              } else if (type === 1) {
                // EV_KEY (1)
                let status = 'PENDING'
                let reason = ''
                
                if (code === 29 || code === 97) {
                  this._ctrlHeld = (value !== 0)
                  status = 'REJECTED'
                  reason = 'modifier key update'
                } else if (code === 56 || code === 100) {
                  this._altHeld = (value !== 0)
                  status = 'REJECTED'
                  reason = 'modifier key update'
                } else if (code === 125 || code === 126) {
                  this._metaHeld = (value !== 0)
                  status = 'REJECTED'
                  reason = 'modifier key update'
                } else if (value !== 1) {
                  status = 'REJECTED'
                  reason = `not a KEY_DOWN (value=${value})`
                } else if (this._ctrlHeld || this._altHeld || this._metaHeld) {
                  status = 'REJECTED'
                  reason = `modifier held (ctrl=${this._ctrlHeld}, alt=${this._altHeld}, meta=${this._metaHeld})`
                } else if (ALLOWED_KEYCODES.has(code) || (this._numLockOn && NUMPAD_CODES.has(code))) {
                  status = 'ALLOWED'
                  reason = 'valid typing key'
                  onActivity({ isActive: true })
                } else {
                  status = 'REJECTED'
                  reason = 'not in ALLOWED_KEYCODES or NUMPAD_CODES'
                }

                console.log(`[DevInputProvider] EV_KEY: code=${code}, value=${value} | Modifiers: C=${this._ctrlHeld} A=${this._altHeld} M=${this._metaHeld} Num=${this._numLockOn} | ${status}: ${reason}`)
              }
            }
          })

          catProc.stderr.on('data', (err) => {
            console.warn(`[DevInputProvider] Stream error on ${devicePath}:`, err.toString())
          })

          catProc.on('error', (err) => {
             console.warn(`[DevInputProvider] Failed to spawn cat for ${devicePath}:`, err.message)
          })

          // Save process reference to kill it later
          this._streams.push(catProc)
          console.log(`[DevInputProvider] Successfully spawned reader for ${devicePath}`)
        } catch (err) {
          console.warn(`[DevInputProvider] Failed to open ${devicePath}:`, err.message)
        }
      }
    } catch (err) {
      console.warn('[DevInputProvider] Error reading devices:', err)
    }
  }

  async stop() {
    for (const proc of this._streams) {
      try {
        proc.kill('SIGKILL')
      } catch (e) {}
    }
    this._streams = []
  }
}

module.exports = DevInputProvider
