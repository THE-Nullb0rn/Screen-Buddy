const https = require('https')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const REPO_OWNER = 'THE-Nullb0rn'
const REPO_NAME = 'Screen-Buddy'
const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`
const GITHUB_API_LATEST_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const USER_AGENT = `${REPO_NAME}-Updater`

const INITIAL_CHECK_DELAY_MS = 30 * 1000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000

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
 * Determine how updates should run for the current OS and build type.
 * Exported as a pure helper so packaged Linux/macOS/Windows/dev branches can be tested directly.
 */
function resolveUpdateMode({
  platform = process.platform,
  isPackaged = app.isPackaged,
  appImageEnv = process.env.APPIMAGE,
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
  const currentVersion = normalizeVersion(app.getVersion())
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
    currentVersion: normalizeVersion(app.getVersion()),
  }
  next.error = next.status === 'error' ? (next.reason || next.error || 'Update error') : null
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
 * Fetch JSON via Node HTTPS with User-Agent + timeout (used only on dev builds & Linux .deb/.rpm).
 * @param {string} url
 * @returns {Promise<{ statusCode: number, data: any }>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
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
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('ETIMEDOUT: Request timed out'))
    })
    req.on('error', reject)
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
      const scratchCfg = path.join(app.getPath('temp'), 'screen-buddy-debug-app-update.yml')
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

    autoUpdaterInstance.on('checking-for-update', () => {
      setUpdateState({
        status: 'checking',
        reason: null,
        percent: null,
        bytesPerSecond: null,
      })
    })

    autoUpdaterInstance.on('update-available', (info) => {
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
    })

    autoUpdaterInstance.on('update-not-available', () => {
      consecutiveFailures = 0
      const now = Date.now()
      const currentMode = getCurrentMode()
      setUpdateState({
        status: 'up-to-date',
        version: normalizeVersion(app.getVersion()),
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
    })

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
      if (prev.status === 'ready') return
      consecutiveFailures++
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
        return
      }
      console.warn('[updater] Update error:', reason)
      setUpdateState({
        status: 'error',
        percent: null,
        bytesPerSecond: null,
        reason,
      })
    })
  }

  return autoUpdaterInstance
}

/**
 * Fallback GitHub API check for dev builds and Linux .deb/.rpm packages.
 */
async function checkViaGithubApi(mode) {
  const currentVersion = normalizeVersion(app.getVersion())
  const now = Date.now()

  setUpdateState({
    status: 'checking',
    reason: null,
    percent: null,
    bytesPerSecond: null,
    canSelfUpdate: false,
    devBuild: Boolean(mode.devBuild),
  })

  if (process.env.SCREEN_BUDDY_DEBUG === '1' && process.env.SCREEN_BUDDY_FAKE_LATEST) {
    const fakeLatest = normalizeVersion(process.env.SCREEN_BUDDY_FAKE_LATEST)
    const fakeNotes = formatReleaseNotes(process.env.SCREEN_BUDDY_FAKE_NOTES || '- Test release note\n- Simulated update check')
    if (compareSemver(fakeLatest, currentVersion) > 0) {
      if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
      return setUpdateState({
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
    }
    if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
    return setUpdateState({
      status: mode.devBuild ? 'dev' : 'up-to-date',
      version: currentVersion,
      notes: null,
      reason: mode.devBuild ? `${mode.reason} (up to date with v${fakeLatest})` : null,
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
  }

  if (mode.engine === 'unsupported') {
    return setUpdateState({
      status: 'error',
      version: null,
      notes: null,
      reason: mode.reason,
      canSelfUpdate: false,
      devBuild: false,
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
  }

  try {
    const { statusCode, data } = await fetchJson(GITHUB_API_LATEST_URL)
    if (statusCode === 404) {
      consecutiveFailures = 0
      if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
      if (mode.devBuild) {
        return setUpdateState({
          status: 'dev',
          version: currentVersion,
          notes: null,
          reason: 'Development build — no published releases yet.',
          canSelfUpdate: false,
          devBuild: true,
          htmlUrl: RELEASES_PAGE_URL,
          lastCheckedAt: now,
        })
      }
      return setUpdateState({
        status: 'no-releases',
        version: null,
        notes: null,
        reason: 'No releases published yet.',
        canSelfUpdate: false,
        devBuild: false,
        htmlUrl: RELEASES_PAGE_URL,
        lastCheckedAt: now,
      })
    }

    if (statusCode === 403) {
      consecutiveFailures++
      return setUpdateState({
        status: 'error',
        reason: 'GitHub rate limit reached. Try again later.',
        canSelfUpdate: false,
        devBuild: Boolean(mode.devBuild),
      })
    }

    if (statusCode < 200 || statusCode >= 300) {
      consecutiveFailures++
      return setUpdateState({
        status: 'error',
        reason: `GitHub returned HTTP ${statusCode}`,
        canSelfUpdate: false,
        devBuild: Boolean(mode.devBuild),
      })
    }

    const latestVersion = normalizeVersion(data.tag_name || data.name || '')
    const notes = formatReleaseNotes(data.body)
    const htmlUrl = data.html_url || buildReleaseUrl(latestVersion)
    consecutiveFailures = 0
    if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)

    if (!latestVersion) {
      return setUpdateState({
        status: mode.devBuild ? 'dev' : 'no-releases',
        version: mode.devBuild ? currentVersion : null,
        notes: null,
        reason: mode.devBuild ? 'Development build — no valid release version found.' : 'No releases published yet.',
        canSelfUpdate: false,
        devBuild: Boolean(mode.devBuild),
        htmlUrl: RELEASES_PAGE_URL,
        lastCheckedAt: now,
      })
    }

    if (compareSemver(latestVersion, currentVersion) > 0) {
      return setUpdateState({
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
    }

    return setUpdateState({
      status: mode.devBuild ? 'dev' : 'up-to-date',
      version: currentVersion,
      notes: null,
      reason: mode.devBuild ? mode.reason : null,
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
      htmlUrl: RELEASES_PAGE_URL,
      lastCheckedAt: now,
    })
  } catch (err) {
    consecutiveFailures++
    const { reason } = classifyUpdaterError(err)
    return setUpdateState({
      status: 'error',
      reason,
      canSelfUpdate: false,
      devBuild: Boolean(mode.devBuild),
    })
  }
}

/**
 * Check for updates (supports electron-updater on Windows/AppImage/debug feed, GitHub API on dev/.deb/.rpm).
 * Never auto-downloads updates.
 * @param {{ manual?: boolean }} [options]
 */
async function checkForUpdates(options = {}) {
  if (isQuittingUpdater || process.env.SCREEN_BUDDY_DISABLE_UPDATER === '1') {
    return getUpdateState()
  }
  const manual = Boolean(options?.manual)
  const current = ensureInitializedState()

  // Do not discard an active download or a ready-to-install update
  if (current.status === 'downloading' || current.status === 'ready') {
    return getUpdateState()
  }

  if (inFlightCheckPromise) {
    return inFlightCheckPromise
  }

  const mode = getCurrentMode()
  if (mode.engine !== 'electron-updater') {
    // Allow user to inspect dev status or GitHub releases safely
    if (!manual && current.status === 'dev' && !process.env.SCREEN_BUDDY_FAKE_LATEST) {
      // On automatic startup/open in dev mode, still run GitHub API check quietly if desired,
      // ending cleanly in 'dev' (or 'available' if a real release or FAKE_LATEST exists).
    }
    inFlightCheckPromise = checkViaGithubApi(mode).finally(() => {
      inFlightCheckPromise = null
    })
    return inFlightCheckPromise
  }

  const updater = ensureAutoUpdater()
  if (!updater) {
    return getUpdateState()
  }

  inFlightCheckPromise = (async () => {
    try {
      setUpdateState({
        status: 'checking',
        reason: null,
        percent: null,
        bytesPerSecond: null,
        canSelfUpdate: true,
        devBuild: mode.devBuild,
      })
      await updater.checkForUpdates()
    } catch (err) {
      const prev = ensureInitializedState()
      if (prev.status !== 'error' && prev.status !== 'no-releases') {
        const { status, reason } = classifyUpdaterError(err)
        if (status === 'no-releases') {
          consecutiveFailures = 0
          const now = Date.now()
          if (typeof onCheckPersistedFn === 'function') onCheckPersistedFn(now)
          setUpdateState({ status: 'no-releases', reason, lastCheckedAt: now })
        } else {
          consecutiveFailures++
          setUpdateState({ status: 'error', reason })
        }
      }
    } finally {
      inFlightCheckPromise = null
    }
    return getUpdateState()
  })()

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
        await checkForUpdates({ manual: false })
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
          await checkForUpdates({ manual: false })
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
  clearSchedulerTimers()
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
  initUpdater,
  notifyUpdaterSettingsChanged,
  cleanupUpdater,
  compareSemver,
  normalizeVersion,
  formatReleaseNotes,
  resolveUpdateMode,
  classifyUpdaterError,
}
