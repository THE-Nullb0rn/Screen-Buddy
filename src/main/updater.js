/**
 * screen-buddy — GitHub release updater module
 */

'use strict'

const { app } = require('electron')

const GITHUB_REPO_URL = 'https://api.github.com/repos/THE-Nullb0rn/Screen-Buddy/releases/latest'
const RELEASES_PAGE_FALLBACK = 'https://github.com/THE-Nullb0rn/Screen-Buddy/releases'
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

let cachedResult = null
let cacheTimestamp = 0

/**
 * Compare two semver strings (x.y.z), ignoring anything after '-'.
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
function compareSemver(v1, v2) {
  const parse = (v) =>
    String(v || '')
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0)

  const p1 = parse(v1)
  const p2 = parse(v2)
  const len = Math.max(p1.length, p2.length, 3)

  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0
    const n2 = p2[i] || 0
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}

/**
 * Check for updates against GitHub Releases API.
 *
 * @returns {Promise<{
 *   status: 'up-to-date' | 'available' | 'no-releases' | 'offline' | 'error',
 *   currentVersion: string,
 *   latestVersion?: string,
 *   name?: string,
 *   notes?: string,
 *   htmlUrl?: string,
 *   publishedAt?: string,
 *   error?: string
 * }>}
 */
async function checkForUpdates() {
  const currentVersion = app.getVersion()

  // Dev/test override
  if (process.env.SCREEN_BUDDY_FAKE_LATEST) {
    const fakeVersion = process.env.SCREEN_BUDDY_FAKE_LATEST.replace(/^v/, '')
    return {
      status: 'available',
      currentVersion,
      latestVersion: fakeVersion,
      name: `Screen Buddy v${fakeVersion}`,
      notes: 'Test release notes',
      htmlUrl: RELEASES_PAGE_FALLBACK,
      publishedAt: new Date().toISOString(),
    }
  }

  // In-memory cache check
  const now = Date.now()
  if (cachedResult && now - cacheTimestamp < CACHE_TTL_MS) {
    return { ...cachedResult }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(GITHUB_REPO_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Screen-Buddy',
      },
    })

    if (res.status === 404) {
      const result = { status: 'no-releases', currentVersion }
      cachedResult = result
      cacheTimestamp = now
      return result
    }

    if (res.status === 403 || res.status === 429) {
      return {
        status: 'error',
        currentVersion,
        error: 'GitHub rate limit, try again later',
      }
    }

    if (!res.ok) {
      return {
        status: 'error',
        currentVersion,
        error: `GitHub returned status ${res.status}`,
      }
    }

    const data = await res.json()
    const tagName = data?.tag_name || ''
    const latestVersion = tagName.replace(/^v/, '')

    let htmlUrl = data?.html_url
    if (
      typeof htmlUrl !== 'string' ||
      !htmlUrl.startsWith('https://github.com/THE-Nullb0rn/Screen-Buddy/')
    ) {
      htmlUrl = RELEASES_PAGE_FALLBACK
    }

    let notes = data?.body
    if (typeof notes === 'string') {
      notes = notes.slice(0, 2000)
    } else {
      notes = ''
    }

    const name = data?.name || `Screen Buddy v${latestVersion}`
    const publishedAt = data?.published_at || null

    let status = 'up-to-date'
    if (latestVersion && compareSemver(latestVersion, currentVersion) > 0) {
      status = 'available'
    }

    const result = {
      status,
      currentVersion,
      latestVersion,
      name,
      notes,
      htmlUrl,
      publishedAt,
    }

    cachedResult = result
    cacheTimestamp = now
    return result
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return { status: 'offline', currentVersion, error: err.message }
    }
    // Any other fetch failure/timeout
    return { status: 'offline', currentVersion, error: err.message }
  } finally {
    clearTimeout(timeoutId)
  }
}

module.exports = {
  checkForUpdates,
}
