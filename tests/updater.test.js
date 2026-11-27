const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')

const {
  checkForUpdates,
  getUpdateState,
  setUpdateState,
  buildRestartHint,
  cleanupUpdater,
  _setTestOverrides,
  _clearTestOverrides,
} = require('../src/main/updater')

test.afterEach(() => {
  cleanupUpdater()
  _clearTestOverrides()
})

test('TASK 1 & 2: 1. 20s timeout + retry + error', async () => {
  let attemptCount = 0
  const results = []

  const origLog = console.log
  console.log = (...args) => {
    origLog(...args)
    const line = args.join(' ')
    if (line.startsWith('[updates] check')) {
      const match = line.match(/attempt=(\d+).*result=(\w+)/)
      if (match) {
        results.push({ attempt: Number(match[1]), result: match[2] })
      }
    }
  }

  try {
    _setTestOverrides({
      checkTimeoutMs: 40,
      retryDelayMs: 20,
      runCheckAttempt: async () => {
        attemptCount++
        // Simulate hung / timed out attempt
        await new Promise((resolve) => setTimeout(resolve, 100))
        return 'available'
      },
    })

    const finalState = await checkForUpdates({ manual: true, source: 'manual' })

    assert.equal(attemptCount, 2, 'Should have made exactly 2 attempts')
    assert.equal(finalState.status, 'error', 'Final state must be error')
    assert.equal(
      finalState.reason,
      "Couldn't reach GitHub. Check your connection and try again.",
      'Error message must match specification'
    )
    assert.equal(results.length, 2, 'Should log 2 timing entries')
    assert.equal(results[0].result, 'timeout', 'Attempt 1 result must be timeout')
    assert.equal(results[1].result, 'timeout', 'Attempt 2 result must be timeout')
  } finally {
    console.log = origLog
  }
})

test('TASK 1 & 2: 2. timeout then retry success', async () => {
  let attemptCount = 0
  const timingLogs = []

  const origLog = console.log
  console.log = (...args) => {
    origLog(...args)
    const line = args.join(' ')
    if (line.startsWith('[updates] check')) {
      timingLogs.push(line)
    }
  }

  try {
    _setTestOverrides({
      checkTimeoutMs: 40,
      retryDelayMs: 20,
      runCheckAttempt: async (_mode, _attemptId, _gen, attempt) => {
        attemptCount++
        if (attempt === 1) {
          // Attempt 1: slow / times out
          await new Promise((resolve) => setTimeout(resolve, 100))
          return 'available'
        }
        // Attempt 2: succeeds quickly
        setUpdateState({
          status: 'available',
          version: '0.2.0',
          reason: null,
          canSelfUpdate: true,
        })
        return 'available'
      },
    })

    const finalState = await checkForUpdates({ manual: true, source: 'manual' })

    assert.equal(attemptCount, 2, 'Should have retried once (2 attempts total)')
    assert.equal(finalState.status, 'available', 'Final status must be available')
    assert.equal(finalState.version, '0.2.0', 'Final version must be updated')
    assert.equal(timingLogs.length, 2, 'Should have logged 2 timing lines')
    assert.ok(timingLogs[0].includes('attempt=1') && timingLogs[0].includes('result=timeout'))
    assert.ok(timingLogs[1].includes('attempt=2') && timingLogs[1].includes('result=available'))
  } finally {
    console.log = origLog
  }
})

test('TASK 1 & 2: 3. overlapping requests produce 1 check', async () => {
  let executionCount = 0

  _setTestOverrides({
    checkTimeoutMs: 200,
    runCheckAttempt: async () => {
      executionCount++
      await new Promise((resolve) => setTimeout(resolve, 60))
      setUpdateState({
        status: 'up-to-date',
        version: '0.1.1',
      })
      return 'up-to-date'
    },
  })

  // Start two concurrent checks
  const p1 = checkForUpdates({ manual: true })
  const p2 = checkForUpdates({ manual: false, source: 'startup' })

  // Both should be the exact same in-flight promise
  assert.equal(p1, p2, 'Concurrent calls must return the same in-flight check promise')

  const [res1, res2] = await Promise.all([p1, p2])
  assert.equal(executionCount, 1, 'Provider check must be invoked only once for concurrent requests')
  assert.equal(res1.status, 'up-to-date')
  assert.equal(res2.status, 'up-to-date')
})

test('TASK 1 & 2: 4. late result from timed-out attempt ignored', async () => {
  const fakeAutoUpdater = new EventEmitter()
  let checkCount = 0

  fakeAutoUpdater.checkForUpdates = () => {
    checkCount++
    if (checkCount === 1) {
      // Attempt 1: slow, does not emit in time
      return new Promise((resolve) => setTimeout(resolve, 100))
    }
    // Attempt 2: fast error
    return Promise.reject(new Error('ENOTFOUND: server down'))
  }

  _setTestOverrides({
    platform: 'win32',
    isPackaged: true,
    checkTimeoutMs: 30,
    retryDelayMs: 20,
    autoUpdater: fakeAutoUpdater,
  })

  const finalState = await checkForUpdates({ manual: true })
  assert.equal(finalState.status, 'error', 'Check should have failed with error')

  // Emit late update event from attempt 1
  fakeAutoUpdater.emit('update-available', {
    version: '99.0.0-late',
  })

  // Allow microtasks to process
  await new Promise((resolve) => setTimeout(resolve, 20))

  const currentState = getUpdateState()
  assert.equal(currentState.status, 'error', 'Late result from timed-out attempt must NOT overwrite state')
  assert.notEqual(currentState.version, '99.0.0-late', 'Late version must be ignored')
})

test('TASK 1 & 2: 5. restartHint generation across platforms and clearing outside ready', () => {
  // Subtest 5a: Linux AppImage
  const linuxAppImageInfo = {
    path: 'Screen-Buddy-x86_64.AppImage',
  }
  const hintLinux = buildRestartHint(linuxAppImageInfo, {
    platform: 'linux',
    appImageEnv: '/home/user/Applications/Screen-Buddy-0.1.0-x86_64.AppImage',
  })
  assert.deepEqual(hintLinux, {
    kind: 'appimage',
    path: '/home/user/Applications/Screen-Buddy-x86_64.AppImage',
  })

  // Subtest 5b: Linux AppImage with files array
  const hintLinuxFiles = buildRestartHint(
    { files: [{ url: 'https://github.com/org/repo/releases/Screen-Buddy-x86_64.AppImage' }] },
    {
      platform: 'linux',
      appImageEnv: '/opt/apps/Screen-Buddy-old.AppImage',
    }
  )
  assert.deepEqual(hintLinuxFiles, {
    kind: 'appimage',
    path: '/opt/apps/Screen-Buddy-x86_64.AppImage',
  })

  // Subtest 5c: Linux AppImage fallback to APPIMAGE env
  const hintLinuxFallback = buildRestartHint(null, {
    platform: 'linux',
    appImageEnv: '/usr/local/bin/Screen-Buddy-x86_64.AppImage',
  })
  assert.deepEqual(hintLinuxFallback, {
    kind: 'appimage',
    path: '/usr/local/bin/Screen-Buddy-x86_64.AppImage',
  })

  // Subtest 5d: Windows Start menu hint
  const hintWin = buildRestartHint(null, { platform: 'win32' })
  assert.deepEqual(hintWin, { kind: 'start-menu' })

  // Subtest 5e: Other platforms (macOS / deb / rpm) -> no hint
  const hintMac = buildRestartHint(null, { platform: 'darwin' })
  assert.equal(hintMac, null)

  const hintDeb = buildRestartHint(null, { platform: 'linux', appImageEnv: '' })
  assert.equal(hintDeb, null)

  // Subtest 5f: restartHint presence only in 'ready' state and cleared in other states
  _setTestOverrides({
    platform: 'linux',
    appImageEnv: '/home/user/Applications/Screen-Buddy-0.1.0-x86_64.AppImage',
  })

  setUpdateState({
    status: 'ready',
    version: '0.2.0',
    restartHint: {
      kind: 'appimage',
      path: '/home/user/Applications/Screen-Buddy-x86_64.AppImage',
    },
  })

  let readyState = getUpdateState()
  assert.equal(readyState.status, 'ready')
  assert.deepEqual(readyState.restartHint, {
    kind: 'appimage',
    path: '/home/user/Applications/Screen-Buddy-x86_64.AppImage',
  })

  // Transition away from 'ready' to 'checking'
  setUpdateState({ status: 'checking' })
  let checkingState = getUpdateState()
  assert.equal(checkingState.status, 'checking')
  assert.equal(checkingState.restartHint, undefined, 'restartHint must be removed outside ready state')

  // Transition to 'idle'
  setUpdateState({ status: 'idle' })
  assert.equal(getUpdateState().restartHint, undefined)

  // Transition to 'available'
  setUpdateState({ status: 'available', version: '0.2.0' })
  assert.equal(getUpdateState().restartHint, undefined)

  // Transition to 'error'
  setUpdateState({ status: 'error', reason: 'Failed' })
  assert.equal(getUpdateState().restartHint, undefined)
})

test('TASK B: SCREEN_BUDDY_FAKE_LATEST honoured in unpackaged dev and ignored in packaged', async () => {
  const origFakeLatest = process.env.SCREEN_BUDDY_FAKE_LATEST
  const origDebug = process.env.SCREEN_BUDDY_DEBUG
  const origLog = console.log
  const timingLogs = []

  console.log = (...args) => {
    origLog(...args)
    const line = args.join(' ')
    if (line.startsWith('[updates] check')) {
      timingLogs.push(line)
    }
  }

  try {
    delete process.env.SCREEN_BUDDY_DEBUG
    process.env.SCREEN_BUDDY_FAKE_LATEST = '0.9.9'

    // Case 1: Unpackaged dev run must honour SCREEN_BUDDY_FAKE_LATEST
    _setTestOverrides({
      isPackaged: false,
      appVersion: '0.1.2',
    })

    const devState = await checkForUpdates({ manual: true, source: 'manual' })
    assert.equal(devState.status, 'available', 'Unpackaged run must report status as available')
    assert.equal(devState.version, '0.9.9', 'Unpackaged run must report fake version 0.9.9')
    assert.ok(devState.htmlUrl.includes('/releases/tag/v0.9.9'), 'HTML url must point to release tag')
    assert.ok(
      timingLogs.some((l) => l.includes('source=manual') && l.includes('result=available')),
      'Must log result=available for fake latest check'
    )

    // Case 2: Packaged run must completely ignore SCREEN_BUDDY_FAKE_LATEST
    timingLogs.length = 0
    let fetchCalled = false
    _setTestOverrides({
      isPackaged: true,
      appVersion: '0.1.2',
      platform: 'linux',
      appImage: '',
      fetchJson: async () => {
        fetchCalled = true
        return {
          statusCode: 200,
          data: {
            tag_name: 'v0.1.2',
            body: 'Latest real release notes',
          },
        }
      },
    })

    const packagedState = await checkForUpdates({ manual: true, source: 'manual' })
    assert.equal(fetchCalled, true, 'Packaged run must make real network check and ignore fake latest')
    assert.equal(packagedState.status, 'up-to-date', 'Packaged run must be up-to-date against real 0.1.2')
    assert.notEqual(packagedState.version, '0.9.9', 'Packaged run must not report fake version')
  } finally {
    console.log = origLog
    if (origFakeLatest !== undefined) {
      process.env.SCREEN_BUDDY_FAKE_LATEST = origFakeLatest
    } else {
      delete process.env.SCREEN_BUDDY_FAKE_LATEST
    }
    if (origDebug !== undefined) {
      process.env.SCREEN_BUDDY_DEBUG = origDebug
    } else {
      delete process.env.SCREEN_BUDDY_DEBUG
    }
  }
})
