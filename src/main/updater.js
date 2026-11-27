const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { app } = require('electron')

const REPO_OWNER = 'THE-Nullb0rn'
const REPO_NAME = 'Screen-Buddy'
const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`
const GITHUB_API_LATEST_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const USER_AGENT = `${REPO_NAME}-Updater`

const INITIAL_CHECK_DELAY_MS = 30 * 1000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000
const CHECK_ATTEMPT_TIMEOUT_MS = 20 * 1000
const RETRY_DELAY_MS = 2 * 1000
const MAX_CHECK_ATTEMPTS = 2

const _testOverrides = {}

function _setTestOverrides(overrides) {
  Object.assign(_testOverrides, overrides)
}

function _clearTestOverrides() {
  for (const k of Object.keys(_testOverrides)) {
    delete _testOverrides[k]
  }
  isQuittingUpdater = false
  updateState = null
  inFlightCheckPromise = null
  checkGeneration = 0
  activeAttemptId = 0
  attemptIdCounter = 0
}

function getAppVersion() {
  if (_testOverrides.appVersion) return _testOverrides.appVersion
  try {
    return (app && typeof app.getVersion === 'function') ? app.getVersion() : '0.1.1'
  } catch (_) {
    return '0.1.1'
  }
}

function isAppPackaged() {
  if (_testOverrides.isPackaged !== undefined) return _testOverrides.isPackaged
  return Boolean(app && app.isPackaged)
}

/**
 * Strip leading 'v' and trim whitespace from a version string.
 * @param {string} v
 * @returns {string}
 */
function normalizeVersion(v) {
  return String(v || '').trim().replace(/^v/i, '')
}

/**
 * Compare two SemVer strings (ignoring pre-release/build suffix after stripping v).
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  const partsA = normalizeVersion(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const partsB = normalizeVersion(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(partsA.length, partsB.length, 3)
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA > numB) return 1
    if (numA < numB) return -1
  }
  return 0
}

/**
 * Convert HTML or structured release notes into safe plain text.
 * @param {string|Array<{version?: string, note?: string}>|null|undefined} raw
 * @returns {string|null}
 */
function formatReleaseNotes(raw) {
  if (!raw) return null
  let text = ''
  if (Array.isArray(raw)) {
    text = raw
      .map((entry) => {
        if (!entry) return ''
        const note = typeof entry === 'string' ? entry : (entry.note || '')
        const heading = entry.version ? `v${normalizeVersion(entry.version)}\n` : ''
        return heading + note
      })
      .filter(Boolean)
      .join('\n\n')
  } else {
    text = String(raw)
  }

  // Decode basic entities and turn block tags into line breaks, stripping all HTML tags
  text = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text || null
}

/**
 * Build a GitHub release URL for a version tag (or fallback to releases page).
 * @param {string|null|undefined} version
 * @returns {string}
 */
function buildReleaseUrl(version) {
  const clean = normalizeVersion(version)
  if (!clean) return RELEASES_PAGE_URL
  return `${RELEASES_PAGE_URL}/tag/v${clean}`
}

/**
 * Extract update target filename from info (path, files[0].url, downloadedFile).
 * @param {any} info
 * @returns {string|null}
 */
function getUpdateFileName(info) {
  if (!info) return null
  if (info.downloadedFile) return path.basename(info.downloadedFile)
  if (info.path) return path.basename(info.path)
  if (Array.isArray(info.files) && info.files[0]) {
    const rawUrl = info.files[0].url || info.files[0].path
    if (rawUrl) {
      try {
        const u = new URL(rawUrl, 'https://github.com')
        return path.basename(u.pathname)
      } catch (_) {
        return path.basename(rawUrl)
      }
    }
  }
  return null
}

/**
 * Build restart hint object for ready update state.
 * @param {any} info
 * @param {{ platform?: string, appImageEnv?: string }} [opts]
 * @returns {{ kind: 'appimage', path: string } | { kind: 'start-menu' } | null}
 */
function buildRestartHint(
  info,
  {
    platform = _testOverrides.platform || process.platform,
    appImageEnv = _testOverrides.appImage !== undefined ? _testOverrides.appImage : process.env.APPIMAGE,
  } = {}
) {
  if (platform === 'linux' && appImageEnv && String(appImageEnv).trim()) {
    const dir = path.dirname(appImageEnv)
    const fileName = getUpdateFileName(info)
    const fullPath = fileName ? path.join(dir, fileName) : appImageEnv
    return {
      kind: 'appimage',
      path: fullPath,
    }
  }
  if (platform === 'win32') {
    return {
      kind: 'start-menu',
    }
  }
  return null
}

/**
 * Determine how updates should run for the current OS and build type.
 * Exported as a pure helper so packaged Linux/macOS/Windows/dev branches can be tested directly.
 */
function resolveUpdateMode({
  platform = _testOverrides.platform || process.platform,
  isPackaged = isAppPackaged(),
  appImageEnv = _testOverrides.appImage !== undefined ? _testOverrides.appImage : process.env.APPIMAGE,
  debugEnabled = process.env.SCREEN_BUDDY_DEBUG === '1',
  debugFeedUrl = process.env.SCREEN_BUDDY_UPDATE_FEED_URL,
} = {}) {
  const feedUrl = debugEnabled && debugFeedUrl ? String(debugFeedUrl).trim() : ''
  if (feedUrl) {
    return {
      engine: 'electron-updater',
      canSelfUpdate: true,
      devBuild: !isPackaged,
      feedUrl,
      reason: null,
    }
  }

  if (!isPackaged) {
    return {
      engine: 'dev-github',
      canSelfUpdate: false,
      devBuild: true,
      feedUrl: null,
      reason: 'Development build — in-app updates require a packaged release.',
    }
  }

  if (platform === 'win32') {
    return {
      engine: 'electron-updater',
      canSelfUpdate: true,
      devBuild: false,
      feedUrl: null,
      reason: null,
    }
  }

  if (platform === 'linux') {
    if (appImageEnv && String(appImageEnv).trim()) {
      return {
        engine: 'electron-updater',
        canSelfUpdate: true,
        devBuild: false,
        feedUrl: null,
        reason: null,
      }
    }
    return {
      engine: 'github-api',
      canSelfUpdate: false,
      devBuild: false,
      feedUrl: null,
      reason: 'Package install (.deb/.rpm) cannot self-update automatically.',
    }
  }

  return {
    engine: 'unsupported',
    canSelfUpdate: false,
    devBuild: false,
    feedUrl: null,
    reason: `Automatic in-app updates are not supported on ${platform}.`,
  }
}

/**
 * Normalize an update error into a short user-facing reason and status ('no-releases' vs 'error').
 * @param {Error|string|unknown} err
 * @returns {{ status: 'no-releases'|'error', reason: string }}
 */
function classifyUpdaterError(err) {
  const rawMsg = (err && typeof err === 'object' && 'message' in err)
    ? String(err.message || '')
    : String(err || '')
  const lower = rawMsg.toLowerCase()

  if (
    lower.includes('no published versions') ||
    lower.includes('status 404') ||
    lower.includes('http 404') ||
    lower.includes(' 404 ') ||
    lower.includes('err_http_response_code_failure') && lower.includes('404')
  ) {
    return {
      status: 'no-releases',
      reason: 'No releases published yet.',
    }
  }

  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('err_internet_disconnected') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_connection_refused') ||
    lower.includes('network')
  ) {
    return {
      status: 'error',
      reason: 'Unable to reach update server. Check your internet connection.',
    }
  }

  if (lower.includes('403') || lower.includes('rate limit')) {
    return {
      status: 'error',
      reason: 'Update server rate limit reached. Try again later.',
    }
  }

  // Keep error text single-line and concise
  const cleanLine = rawMsg.split(/\r?\n/)[0].trim()
  if (cleanLine && cleanLine.length <= 140) {
    return { status: 'error', reason: cleanLine }
  }
  if (cleanLine) {
    return { status: 'error', reason: `${cleanLine.slice(0, 137)}...` }
  }
  return { status: 'error', reason: 'Update check failed.' }
}

function createInitialState(mode) {
  const currentVersion = normalizeVersion(getAppVersion())
  if (mode.engine === 'dev-github') {
    return {
      status: 'dev',
      currentVersion,
      version: currentVersion,
      notes: null,
      percent: null,
      bytesPerSecond: null,
      reason: mode.reason,
      error: null,
      canSelfUpdate: false,
      devBuild: true,
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: null,
    }
  }
  return {
    status: 'idle',
    currentVersion,
    version: null,
    notes: null,
    percent: null,
    bytesPerSecond: null,
    reason: mode.reason || null,
    error: null,
    canSelfUpdate: mode.canSelfUpdate,
    devBuild: Boolean(mode.devBuild),
    htmlUrl: RELEASES_PAGE_URL,
    lastCheckedAt: null,
  }
}

let updateState = null
let lastDownloadedInfo = null
let stateBroadcastFn = null
let settingsGetter = null
let onCheckPersistedFn = null
let autoUpdaterInstance = null
let autoUpdaterHooksInstalled = false
let inFlightCheckPromise = null
let inFlightDownloadPromise = null
let activeDownloadCancellationToken = null
let isQuittingUpdater = false
let initialCheckTimer = null
let periodicCheckTimer = null
let consecutiveFailures = 0
let lastProgressBroadcastAt = 0
let checkGeneration = 0
let activeAttemptId = 0
let attemptIdCounter = 0
let activeCheckTimer = null
let activeRetryTimer = null
let activeCheckAbortController = null

function getCurrentMode() {
  return resolveUpdateMode()
}

function ensureInitializedState() {
  if (!updateState) {
    updateState = createInitialState(getCurrentMode())
  }
  return updateState
}

function getUpdateState() {
  return { ...ensureInitializedState() }
}

function setUpdateState(patch) {
  const prev = ensureInitializedState()
  const next = {
    ...prev,
    ...patch,
    currentVersion: normalizeVersion(getAppVersion()),
  }
  next.error = next.status === 'error' ? (next.reason || next.error || 'Update error') : null

  if (next.status === 'ready') {
    next.restartHint = patch.restartHint !== undefined
      ? patch.restartHint
      : (next.restartHint || buildRestartHint(lastDownloadedInfo))
  } else {
    delete next.restartHint
    if (next.status !== 'downloading') {
      lastDownloadedInfo = null
    }
  }

  updateState = next

  if (typeof stateBroadcastFn === 'function') {
    try {
      stateBroadcastFn({ ...next })
    } catch (_) {
      /* ignore broadcast errors during shutdown */
    }
  }
  return { ...next }
}

/**
 * Fetch JSON via Node HTTPS with User-Agent + signal (used only on dev builds & Linux .deb/.rpm).
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ statusCode: number, data: any }>}
 */
function fetchJson(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Request aborted')
      err.name = 'AbortError'
      return reject(err)
    }

    const req = https.get(
      url,
      {
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body || '{}') })
          } catch (err) {
            reject(new Error(`Invalid response: ${err.message}`))
          }
        })
      }
    )
    req.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * Lazy-load electron-updater only when supported packaged runtime (Windows, Linux AppImage, or debug feed override).
 */
function ensureAutoUpdater() {
  const mode = getCurrentMode()
  if (mode.engine !== 'electron-updater') return null

  if (!autoUpdaterInstance) {
    // Lazy require avoids loading electron-updater on dev or .deb/.rpm builds
    const { autoUpdater } = require('electron-updater')
    autoUpdaterInstance = autoUpdater
    autoUpdaterInstance.autoDownload = false
    autoUpdaterInstance.allowPrerelease = false
    // Keep autoInstallOnAppQuit false until the user explicitly chooses to download
    autoUpdaterInstance.autoInstallOnAppQuit = false
    autoUpdaterInstance.logger = {
      info: (...args) => console.log('[updater]', ...args),
      warn: (...args) => console.warn('[updater]', ...args),
      error: (...args) => console.error('[updater]', ...args),
      debug: () => {},
    }
  }

  if (mode.feedUrl) {
    const defaultCfgPath = path.join(process.resourcesPath || '', 'app-update.yml')
    if (!fs.existsSync(defaultCfgPath)) {
      const tempDir = (app && typeof app.getPath === 'function') ? app.getPath('temp') : os.tmpdir()
      const scratchCfg = path.join(tempDir, 'screen-buddy-debug-app-update.yml')
      fs.writeFileSync(
        scratchCfg,
        `provider: generic\nurl: ${mode.feedUrl}\nupdaterCacheDirName: screen-buddy-updater\n`,
        'utf8'
      )
      autoUpdaterInstance.updateConfigPath = scratchCfg
    }
    autoUpdaterInstance.setFeedURL({
      provider: 'generic',
      url: mode.feedUrl,
    })
  }

  if (!autoUpdaterHooksInstalled) {
    autoUpdaterHooksInstalled = true

    if (process.platform === 'linux' && process.env.APPIMAGE) {
      autoUpdaterInstance.on('appimage-filename-updated', (destination) => {
        try {
          const settings = typeof settingsGetter === 'function' ? settingsGetter() : null
          if (settings?.autostart) {
            const { repairAutostartExecIfNeeded } = require('./autostart')
            repairAutostartExecIfNeeded(destination)
          }
        } catch (err) {
          console.warn('[updater] Failed to repair autostart on appimage-filename-updated:', err.message)
        }
      })
    }

    autoUpdaterInstance.on('download-progress', (progress) => {
      const now = Date.now()
      const pct = Number.isFinite(progress?.percent) ? Math.min(100, Math.max(0, Math.round(progress.percent * 10) / 10)) : 0
      const bps = Number.isFinite(progress?.bytesPerSecond) ? Math.max(0, Math.round(progress.bytesPerSecond)) : 0
      if (now - lastProgressBroadcastAt < 80 && pct < 100) return
      lastProgressBroadcastAt = now
      setUpdateState({
        status: 'downloading',
        percent: pct,
        bytesPerSecond: bps,
        reason: null,
      })
    })

    autoUpdaterInstance.on('update-downloaded', (info) => {
      lastDownloadedInfo = info
      const prev = ensureInitializedState()
      const latest = normalizeVersion(info?.version) || prev.version
      const notes = formatReleaseNotes(info?.releaseNotes) || prev.notes
      setUpdateState({
        status: 'ready',
        version: latest,
        notes,
        percent: 100,
        bytesPerSecond: 0,
        reason: null,
        canSelfUpdate: true,
        htmlUrl: buildReleaseUrl(latest),
      })
    })

    autoUpdaterInstance.on('error', (err) => {
      const prev = ensureInitializedState()
      if (prev.status === 'downloading') {
        const { reason } = classifyUpdaterError(err)
        console.warn('[updater] Download error:', reason)
        setUpdateState({
          status: 'error',
          percent: null,
          bytesPerSecond: null,
          reason,
        })
      }
    })
  }

  return autoUpdaterInstance
}

/**
 * Log check timing to stdout.
 * Format: [updates] check source=<startup|schedule|manual> attempt=<n> ms=<elapsed> result=<available|up-to-date|no-releases|timeout|error>
 */
function logCheckTiming(source, attempt, elapsedMs, result) {
  console.log(`[updates] check source=${source} attempt=${attempt} ms=${elapsedMs} result=${result}`)
}

/**
 * Determine if an error / result is eligible for retry (timeout or network error).
 */
function isNetworkOrTimeout(err, result) {
  if (result === 'timeout') return true
  if (!err) return true
  if (err.isTimeout || err.name === 'TimeoutError' || err.name === 'AbortError') return true
  const msg = String(err.message || err || '').toLowerCase()
  if (msg.includes('rate limit') || msg.includes('403')) return false
  return (
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('eai_again') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_connection_refused') ||
    msg.includes('err_connection_reset') ||
    msg.includes('err_connection_timed_out') ||
    msg.includes('err_timed_out') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('eai_')
  )
}

/**
 * Run a single check attempt using electron-updater with 20s time limit.
 */
function runElectronUpdaterAttempt(mode, thisAttemptId, thisGen) {
  return new Promise((resolve, reject) => {
    const updater = _testOverrides.autoUpdater || ensureAutoUpdater()
    if (!updater) {
      return reject(new Error('electron-updater not available'))
    }

    let settled = false
    const timeoutMs = _testOverrides.checkTimeoutMs || CHECK_ATTEMPT_TIMEOUT_MS

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      try {
        updater.checkForUpdatesPromise = null
      } catch (_) {
        /* ignore */
      }
      const err = new Error('Update check timed out')
      err.isTimeout = true
      reject(err)
    }, timeoutMs)
    activeCheckTimer = timer

    function cleanup() {
      if (timer) {
        clearTimeout(timer)
        if (activeCheckTimer === timer) activeCheckTimer = null
      }
      try {
        updater.removeListener('update-available', onAvailable)
        updater.removeListener('update-not-available', onNotAvailable)
        updater.removeListener('error', onError)
      } catch (_) {
        /* ignore */
      }
    }

    function onAvailable(info) {
      if (settled) return
      if (thisGen !== checkGeneration || activeAttemptId !== thisAttemptId) return
      settled = true
      cleanup()
      consecutiveFailures = 0
      const latest = normalizeVersion(info?.version)
      const now = Date.now()
      const notes = formatReleaseNotes(info?.releaseNotes)
      const htmlUrl = buildReleaseUrl(latest)
      const currentMode = getCurrentMode()
      setUpdateState({
        status: 'available',
        version: latest,
        notes,
        percent: null,
        bytesPerSecond: null,
        reason: currentMode.canSelfUpdate ? null : currentMode.reason,
        canSelfUpdate: currentMode.canSelfUpdate,
        devBuild: currentMode.devBuild,
        htmlUrl,
        lastCheckedAt: now,
      })
      if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
      resolve('available')
    }

    function onNotAvailable() {
      if (settled) return
      if (thisGen !== checkGeneration || activeAttemptId !== thisAttemptId) return
      settled = true
      cleanup()
      consecutiveFailures = 0
      const now = Date.now()
      const currentMode = getCurrentMode()
      setUpdateState({
        status: 'up-to-date',
        version: normalizeVersion(getAppVersion()),
        notes: null,
        percent: null,
        bytesPerSecond: null,
        reason: null,
        canSelfUpdate: currentMode.canSelfUpdate,
        devBuild: currentMode.devBuild,
        htmlUrl: RELEASES_PAGE_URL,
        lastCheckedAt: now,
      })
      if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
      resolve('up-to-date')
    }

    function onError(err) {
      if (settled) return
      if (thisGen !== checkGeneration || activeAttemptId !== thisAttemptId) return
      settled = true
      cleanup()
      const { status, reason } = classifyUpdaterError(err)
      if (status === 'no-releases') {
        consecutiveFailures = 0
        const now = Date.now()
        if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
        setUpdateState({
          status: 'no-releases',
          version: null,
          notes: null,
          percent: null,
          bytesPerSecond: null,
          reason,
          lastCheckedAt: now,
        })
        return resolve('no-releases')
      }
      reject(err)
    }

    updater.on('update-available', onAvailable)
    updater.on('update-not-available', onNotAvailable)
    updater.on('error', onError)

    try {
      updater.checkForUpdatesPromise = null
      const p = updater.checkForUpdates()
      if (p && typeof p.then === 'function') {
        p.then((checkResult) => {
          if (settled) return
          if (checkResult && typeof checkResult.isUpdateAvailable === 'boolean') {
            if (checkResult.isUpdateAvailable) {
              onAvailable(checkResult.updateInfo)
            } else {
              onNotAvailable()
            }
          }
        }).catch((err) => {
          if (!settled) {
            onError(err)
          }
        })
      }
    } catch (err) {
      onError(err)
    }
  })
}

/**
 * Perform GitHub releases API fetch and update state.
 */
async function doGithubApiCheck(mode, signal, thisAttemptId, thisGen) {
  const currentVersion = normalizeVersion(getAppVersion())
  const now = Date.now()

  if (!isAppPackaged() && process.env.SCREEN_BUDDY_FAKE_LATEST) {
    const fakeLatest = normalizeVersion(process.env.SCREEN_BUDDY_FAKE_LATEST)
    const fakeNotes = formatReleaseNotes(process.env.SCREEN_BUDDY_FAKE_NOTES || '- Test release note\n- Simulated update check')
    if (thisGen !== checkGeneration || activeAttemptId !== thisAttemptId) {
      return 'ignored'
    }
    if (compareSemver(fakeLatest, currentVersion) > 0) {
      if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
      setUpdateState({
        status: 'available',
        version: fakeLatest,
        notes: fakeNotes,
        percent: null,
        bytesPerSecond: null,
        reason: mode.reason,
        canSelfUpdate: false,
        devBuild: Boolean(mode.devBuild),
        htmlUrl: buildReleaseUrl(fakeLatest),
        lastCheckedAt: now,
      })
      return 'available'
    }
    if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
    setUpdateState({
      status: mode.devBuild ? 'dev' : 'up-to-date',
      version: currentVersion,
      notes: null,
      reason: mode.devBuild ? `${mode.reason} (up to date with v${fakeLatest})` : null,
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
    return 'up-to-date'
  }

  if (mode.engine === 'unsupported') {
    if (thisGen !== checkGeneration || activeAttemptId !== thisAttemptId) return 'ignored'
    setUpdateState({
      status: 'error',
      version: null,
      notes: null,
      reason: mode.reason,
      canSelfUpdate: false,
      devBuild: false,
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
    return 'error'
  }

  const fetcher = _testOverrides.fetchJson || fetchJson
  const { statusCode, data } = await fetcher(GITHUB_API_LATEST_URL, { signal })

  if (thisGen !== checkGeneration || activeAttemptId !== thisAttemptId) {
    return 'ignored'
  }

  if (statusCode === 404) {
    consecutiveFailures = 0
    if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
    setUpdateState({
      status: mode.devBuild ? 'dev' : 'no-releases',
      version: mode.devBuild ? currentVersion : null,
      notes: null,
      reason: mode.devBuild ? 'Development build — no published releases yet.' : 'No releases published yet.',
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
    return 'no-releases'
  }

  if (statusCode === 403) {
    const err = new Error('GitHub rate limit reached. Try again later.')
    err.statusCode = 403
    throw err
  }

  if (statusCode < 200 || statusCode >= 300) {
    const err = new Error(`GitHub returned HTTP ${statusCode}`)
    err.statusCode = statusCode
    throw err
  }

  const latestVersion = normalizeVersion(data.tag_name || data.name || '')
  const notes = formatReleaseNotes(data.body)
  const htmlUrl = data.html_url || buildReleaseUrl(latestVersion)
  consecutiveFailures = 0
  if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)

  if (!latestVersion) {
    setUpdateState({
      status: mode.devBuild ? 'dev' : 'no-releases',
      version: mode.devBuild ? currentVersion : null,
      notes: null,
      reason: mode.devBuild ? 'Development build — no valid release version found.' : 'No releases published yet.',
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
    return 'no-releases'
  }

  if (compareSemver(latestVersion, currentVersion) > 0) {
    setUpdateState({
      status: 'available',
      version: latestVersion,
      notes,
      percent: null,
      bytesPerSecond: null,
      reason: mode.reason,
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
      htmlUrl,
      lastCheckedAt: now,
    })
    return 'available'
  }

  setUpdateState({
    status: mode.devBuild ? 'dev' : 'up-to-date',
    version: currentVersion,
    notes: null,
    reason: mode.devBuild ? mode.reason : null,
    canSelfUpdate: false,
    devBuild: Boolean(mode.devBuild),
    htmlUrl: RELEASES_PAGE_URL,
    lastCheckedAt: now,
  })
  return 'up-to-date'
}

/**
 * Run a single check attempt using GitHub API with 20s time limit and AbortController.
 */
function runGithubApiAttempt(mode, thisAttemptId, thisGen) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    activeCheckAbortController = controller

    let settled = false
    const timeoutMs = _testOverrides.checkTimeoutMs || CHECK_ATTEMPT_TIMEOUT_MS

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      const err = new Error('Update check timed out')
      err.name = 'TimeoutError'
      err.isTimeout = true
      try {
        controller.abort(err)
      } catch (_) {
        /* ignore */
      }
      reject(err)
    }, timeoutMs)
    activeCheckTimer = timer

    function cleanup() {
      if (timer) {
        clearTimeout(timer)
        if (activeCheckTimer === timer) activeCheckTimer = null
      }
      if (activeCheckAbortController === controller) {
        activeCheckAbortController = null
      }
    }

    doGithubApiCheck(mode, controller.signal, thisAttemptId, thisGen)
      .then((res) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(res)
      })
      .catch((err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      })
  })
}

/**
 * Execute the multi-attempt check flow with timeout, retry, and timing logging.
 */
async function runCheckFlow(source) {
  checkGeneration++
  const thisGen = checkGeneration

  setUpdateState({
    status: 'checking',
    reason: null,
    percent: null,
    bytesPerSecond: null,
  })

  const mode = getCurrentMode()
  let lastError = null

  for (let attempt = 1; attempt <= MAX_CHECK_ATTEMPTS; attempt++) {
    if (isQuittingUpdater || thisGen !== checkGeneration) {
      break
    }

    attemptIdCounter++
    const thisAttemptId = attemptIdCounter
    activeAttemptId = thisAttemptId

    const startTime = Date.now()
    let attemptResult = 'error'
    lastError = null

    let timer = null
    const timeoutMs = _testOverrides.checkTimeoutMs || CHECK_ATTEMPT_TIMEOUT_MS

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Update check timed out')
        err.name = 'TimeoutError'
        err.isTimeout = true
        reject(err)
      }, timeoutMs)
    })
    activeCheckTimer = timer

    try {
      let attemptPromise
      if (typeof _testOverrides.runCheckAttempt === 'function') {
        attemptPromise = _testOverrides.runCheckAttempt(mode, thisAttemptId, thisGen, attempt)
      } else if (mode.engine === 'electron-updater') {
        attemptPromise = runElectronUpdaterAttempt(mode, thisAttemptId, thisGen)
      } else {
        attemptPromise = runGithubApiAttempt(mode, thisAttemptId, thisGen)
      }
      attemptResult = await Promise.race([attemptPromise, timeoutPromise])
    } catch (err) {
      lastError = err
      if (err?.isTimeout || err?.name === 'TimeoutError') {
        attemptResult = 'timeout'
      } else {
        const classified = classifyUpdaterError(err)
        if (classified.status === 'no-releases') {
          attemptResult = 'no-releases'
        } else {
          attemptResult = 'error'
        }
      }
    } finally {
      if (timer) {
        clearTimeout(timer)
        if (activeCheckTimer === timer) activeCheckTimer = null
      }
      if (activeAttemptId === thisAttemptId) {
        activeAttemptId = 0
      }
    }

    const elapsed = Date.now() - startTime

    if (thisGen !== checkGeneration) {
      break
    }

    logCheckTiming(source, attempt, elapsed, attemptResult)

    if (attemptResult === 'available' || attemptResult === 'up-to-date' || attemptResult === 'no-releases') {
      return getUpdateState()
    }

    if (attempt < MAX_CHECK_ATTEMPTS && isNetworkOrTimeout(lastError, attemptResult)) {
      const delayMs = _testOverrides.retryDelayMs !== undefined ? _testOverrides.retryDelayMs : RETRY_DELAY_MS
      await new Promise((resolve) => {
        activeRetryTimer = setTimeout(() => {
          activeRetryTimer = null
          resolve()
        }, delayMs)
      })
      if (isQuittingUpdater || thisGen !== checkGeneration) {
        break
      }
      continue
    } else {
      break
    }
  }

  if (thisGen !== checkGeneration || isQuittingUpdater) {
    return getUpdateState()
  }

  consecutiveFailures++
  let reason = "Couldn't reach GitHub. Check your connection and try again."
  if (lastError) {
    const rawMsg = String(lastError.message || lastError || '').toLowerCase()
    if (rawMsg.includes('rate limit') || rawMsg.includes('403')) {
      reason = 'Update server rate limit reached. Try again later.'
    }
  }

  setUpdateState({
    status: 'error',
    reason,
    percent: null,
    bytesPerSecond: null,
  })

  return getUpdateState()
}

/**
 * Check for updates (supports electron-updater on Windows/AppImage/debug feed, GitHub API on dev/.deb/.rpm).
 * Never auto-downloads updates.
 * @param {{ manual?: boolean, source?: 'startup'|'schedule'|'manual' }} [options]
 */
function checkForUpdates(options = {}) {
  if (isQuittingUpdater || process.env.SCREEN_BUDDY_DISABLE_UPDATER === '1') {
    return Promise.resolve(getUpdateState())
  }
  const current = ensureInitializedState()

  // Do not discard an active download or a ready-to-install update
  if (current.status === 'downloading' || current.status === 'ready') {
    return Promise.resolve(getUpdateState())
  }

  if (inFlightCheckPromise) {
    return inFlightCheckPromise
  }

  let source = options?.source
  if (source !== 'startup' && source !== 'schedule' && source !== 'manual') {
    source = options?.manual ? 'manual' : (options?.manual === false ? 'startup' : 'manual')
  }

  inFlightCheckPromise = runCheckFlow(source).finally(() => {
    inFlightCheckPromise = null
  })

  return inFlightCheckPromise
}

/**
 * Explicitly download the available update after user click.
 * Sets autoInstallOnAppQuit = true only once download begins.
 */
async function downloadUpdate() {
  if (isQuittingUpdater || process.env.SCREEN_BUDDY_DISABLE_UPDATER === '1') {
    return getUpdateState()
  }
  const mode = getCurrentMode()
  const current = ensureInitializedState()

  if (!mode.canSelfUpdate || mode.engine !== 'electron-updater') {
    return setUpdateState({
      status: current.status === 'available' ? 'available' : 'error',
      reason: mode.reason || 'Automatic download is not available for this build.',
      canSelfUpdate: false,
    })
  }

  if (current.status === 'ready') {
    return getUpdateState()
  }

  if (inFlightDownloadPromise) {
    return inFlightDownloadPromise
  }

  const updater = ensureAutoUpdater()
  if (!updater) {
    return getUpdateState()
  }

  // Only opt in to auto-install on quit once the user has explicitly asked to download
  updater.autoInstallOnAppQuit = true
  lastProgressBroadcastAt = 0

  setUpdateState({
    status: 'downloading',
    percent: 0,
    bytesPerSecond: 0,
    reason: null,
  })

  inFlightDownloadPromise = (async () => {
    try {
      if (mode.engine === 'electron-updater') {
        try {
          const { CancellationToken } = require('builder-util-runtime')
          activeDownloadCancellationToken = new CancellationToken()
        } catch (_) {
          /* ignore */
        }
      }
      // Ensure updater has metadata if download was invoked right after state check
      if (ensureInitializedState().status !== 'ready') {
        await updater.downloadUpdate(activeDownloadCancellationToken || undefined)
      }
    } catch (err) {
      updater.autoInstallOnAppQuit = false
      const prev = ensureInitializedState()
      if (prev.status !== 'ready' && prev.status !== 'error') {
        const { reason } = classifyUpdaterError(err)
        setUpdateState({
          status: 'error',
          percent: null,
          bytesPerSecond: null,
          reason,
        })
      }
    } finally {
      activeDownloadCancellationToken = null
      inFlightDownloadPromise = null
    }
    return getUpdateState()
  })()

  return inFlightDownloadPromise
}

/**
 * Quit and run the downloaded installer. Only valid in 'ready' state on self-updatable builds.
 */
function installUpdate() {
  const mode = getCurrentMode()
  const current = ensureInitializedState()
  if (!mode.canSelfUpdate || current.status !== 'ready' || !autoUpdaterInstance) {
    return { ok: false, reason: 'No downloaded update is ready to install.' }
  }
  console.log(`[updater] Calling quitAndInstall() for v${current.version || 'unknown'}`)
  setImmediate(() => {
    autoUpdaterInstance.quitAndInstall(false, true)
  })
  return { ok: true }
}

function clearSchedulerTimers() {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer)
    initialCheckTimer = null
  }
  if (periodicCheckTimer) {
    clearTimeout(periodicCheckTimer)
    periodicCheckTimer = null
  }
}

function scheduleNextPeriodicCheck() {
  if (periodicCheckTimer) {
    clearTimeout(periodicCheckTimer)
    periodicCheckTimer = null
  }
  const settings = typeof settingsGetter === 'function' ? settingsGetter() : null
  if (settings?.autoCheckUpdates === false) return

  const backoffMultiplier = consecutiveFailures > 0 ? Math.pow(2, Math.min(consecutiveFailures - 1, 2)) : 1
  const delayMs = Math.min(CHECK_INTERVAL_MS * backoffMultiplier, MAX_BACKOFF_MS)

  periodicCheckTimer = setTimeout(async () => {
    periodicCheckTimer = null
    const latestSettings = typeof settingsGetter === 'function' ? settingsGetter() : null
    if (latestSettings?.autoCheckUpdates !== false) {
      const cur = ensureInitializedState()
      if (cur.status !== 'downloading' && cur.status !== 'ready' && cur.status !== 'checking') {
        await checkForUpdates({ manual: false, source: 'schedule' })
      }
    }
    scheduleNextPeriodicCheck()
  }, delayMs)
  if (periodicCheckTimer.unref) periodicCheckTimer.unref()
}

/**
 * Initialize background update scheduler (30s startup check, then every 6h).
 * @param {{ getSettings: () => any, broadcast: (state: any) => void, onCheckPersisted?: (ts: number) => void }} opts
 */
function initUpdater({ getSettings, broadcast, onCheckPersisted }) {
  settingsGetter = getSettings
  stateBroadcastFn = broadcast
  onCheckPersistedFn = onCheckPersisted
  ensureInitializedState()
  clearSchedulerTimers()

  const settings = typeof settingsGetter === 'function' ? settingsGetter() : null
  if (settings?.autoCheckUpdates !== false) {
    initialCheckTimer = setTimeout(async () => {
      initialCheckTimer = null
      const latestSettings = typeof settingsGetter === 'function' ? settingsGetter() : null
      if (latestSettings?.autoCheckUpdates !== false) {
        const cur = ensureInitializedState()
        if (cur.status !== 'downloading' && cur.status !== 'ready' && cur.status !== 'checking') {
          await checkForUpdates({ manual: false, source: 'startup' })
        }
      }
      scheduleNextPeriodicCheck()
    }, INITIAL_CHECK_DELAY_MS)
    if (initialCheckTimer.unref) initialCheckTimer.unref()
  }
}

function notifyUpdaterSettingsChanged(settings) {
  if (!settings || settings.autoCheckUpdates === false) {
    clearSchedulerTimers()
    return
  }
  if (!initialCheckTimer && !periodicCheckTimer) {
    scheduleNextPeriodicCheck()
  }
}

function cleanupUpdater() {
  isQuittingUpdater = true
  checkGeneration++
  activeAttemptId = 0
  clearSchedulerTimers()
  if (activeCheckTimer) {
    clearTimeout(activeCheckTimer)
    activeCheckTimer = null
  }
  if (activeRetryTimer) {
    clearTimeout(activeRetryTimer)
    activeRetryTimer = null
  }
  if (activeCheckAbortController) {
    try {
      activeCheckAbortController.abort()
    } catch (_) {
      /* ignore */
    }
    activeCheckAbortController = null
  }
  if (activeDownloadCancellationToken) {
    try {
      activeDownloadCancellationToken.cancel()
    } catch (_) {
      /* ignore */
    }
    activeDownloadCancellationToken = null
  }
  if (autoUpdaterInstance) {
    try {
      autoUpdaterInstance.checkForUpdatesPromise = null
      autoUpdaterInstance.removeAllListeners()
    } catch (_) {
      /* ignore */
    }
  }
  stateBroadcastFn = null
}

module.exports = {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateState,
  setUpdateState,
  initUpdater,
  notifyUpdaterSettingsChanged,
  cleanupUpdater,
  compareSemver,
  normalizeVersion,
  formatReleaseNotes,
  resolveUpdateMode,
  classifyUpdaterError,
  buildRestartHint,
  _setTestOverrides,
  _clearTestOverrides,
}
