/**
 * screen-buddy — Media monitor (playerctl integration)
 *
 * Spawns `playerctl --follow metadata` to detect media playback changes
 * in real time. Emits callbacks when playback starts, pauses, stops, or
 * the track changes.
 *
 * Handles the case where no media player is running gracefully — retries
 * automatically after a short delay.
 *
 * Usage:
 *   const mediaMonitor = require('./mediaMonitor')
 *   mediaMonitor.start(({ playing, artist, title }) => { ... })
 *   // later:
 *   mediaMonitor.stop()
 */

'use strict'

const { spawn } = require('child_process')

// How long to wait before retrying when playerctl exits (no player found)
const RETRY_DELAY_MS = 5000

let childProcess = null
let retryTimer = null
let callback = null
let stopped = false

// Last emitted state — used for deduplication
let lastState = { playing: false, artist: '', title: '' }

/**
 * Parse a single line of playerctl output.
 * Expected format: "status||artist||title"
 * where status is "Playing", "Paused", or "Stopped".
 */
function parseLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  const parts = trimmed.split('||')
  if (parts.length < 3) return null

  const status = parts[0].trim()
  const artist = parts[1].trim()
  const title = parts.slice(2).join('||').trim()

  return {
    playing: status === 'Playing',
    artist: artist || '',
    title: title || '',
  }
}

/**
 * Emit a state update if it differs from the last emitted state.
 */
function emitIfChanged(state) {
  if (!callback) return

  if (
    state.playing === lastState.playing &&
    state.artist === lastState.artist &&
    state.title === lastState.title
  ) {
    return // No change — skip
  }

  lastState = { ...state }
  console.log(
    `[media] Status: playing=${state.playing}, artist="${state.artist}", title="${state.title}"`
  )
  callback(state)
}

/**
 * Spawn the playerctl child process and wire up event handlers.
 */
function spawnPlayerctl() {
  if (stopped) return

  // Clear any pending retry
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }

  try {
    childProcess = spawn('playerctl', [
      '--follow',
      'metadata',
      '--format',
      '{{status}}||{{artist}}||{{title}}',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn('[media] Failed to spawn playerctl:', err.message)
    scheduleRetry()
    return
  }

  let buffer = ''

  childProcess.stdout.on('data', (data) => {
    buffer += data.toString()

    // Process complete lines
    const lines = buffer.split('\n')
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || ''

    for (const line of lines) {
      const state = parseLine(line)
      if (state) {
        emitIfChanged(state)
      }
    }
  })

  childProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg) {
      if (msg.includes('No player') || msg.includes('unable to list player names')) {
        emitIfChanged({ playing: false, artist: '', title: '' })
      } else {
        console.warn('[media] playerctl stderr:', msg)
      }
    }
  })

  childProcess.on('error', (err) => {
    console.warn('[media] playerctl process error:', err.message)
    childProcess = null
    // Emit stopped state
    emitIfChanged({ playing: false, artist: '', title: '' })
    scheduleRetry()
  })

  childProcess.on('close', (code) => {
    childProcess = null
    if (stopped) return

    if (code !== 0) {
      console.log(`[media] playerctl exited with code ${code} — will retry in ${RETRY_DELAY_MS / 1000}s`)
    }
    // Emit stopped state when playerctl exits
    emitIfChanged({ playing: false, artist: '', title: '' })
    scheduleRetry()
  })

  console.log('[media] playerctl monitor started (pid:', childProcess.pid, ')')
}

/**
 * Schedule a retry to re-spawn playerctl after a delay.
 */
function scheduleRetry() {
  if (stopped) return
  if (retryTimer) return // Already scheduled

  retryTimer = setTimeout(() => {
    retryTimer = null
    spawnPlayerctl()
  }, RETRY_DELAY_MS)
}

/**
 * Start monitoring media playback.
 * @param {Function} cb — called with { playing: boolean, artist: string, title: string }
 */
function start(cb) {
  callback = cb
  stopped = false
  lastState = { playing: false, artist: '', title: '' }
  spawnPlayerctl()
}

/**
 * Get current media playback state.
 * @returns {{ playing: boolean, artist: string, title: string }}
 */
function getStatus() {
  return { ...lastState }
}

/**
 * Stop monitoring and clean up the child process.
 */
function stop() {
  stopped = true

  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }

  if (childProcess) {
    console.log('[media] Stopping playerctl monitor (pid:', childProcess.pid, ')')
    childProcess.kill('SIGTERM')
    childProcess = null
  }

  callback = null
}

module.exports = { start, stop, getStatus }
