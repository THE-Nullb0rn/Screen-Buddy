const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const {
  setAutostart,
  removeAutostart,
  getAutostartStatus,
  repairAutostartExecIfNeeded,
  _setTestOverrides,
  _clearTestOverrides,
} = require('../src/main/autostart')

let tempDir
let originalPlatform

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-autostart-test-'))
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
})

afterEach(() => {
  _clearTestOverrides()
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('TASK A: dev run leaves existing .desktop file untouched and byte-identical', () => {
  const desktopPath = path.join(tempDir, 'screen-buddy.desktop')
  const initialContent = '[Desktop Entry]\nType=Application\nName=UserCustom\nExec=/custom/path --autostart\n'
  fs.writeFileSync(desktopPath, initialContent, 'utf-8')

  _setTestOverrides({
    isPackaged: false,
    autostartDir: tempDir,
  })

  const status = getAutostartStatus()
  assert.deepStrictEqual(status, {
    available: false,
    devBuild: true,
    enabled: false,
    reason: 'Available in the installed app',
  })

  const setResult = setAutostart()
  assert.strictEqual(setResult.success, false)
  assert.strictEqual(setResult.devBuild, true)

  const removeResult = removeAutostart()
  assert.strictEqual(removeResult.success, false)
  assert.strictEqual(removeResult.devBuild, true)

  const finalContent = fs.readFileSync(desktopPath, 'utf-8')
  assert.strictEqual(finalContent, initialContent)
})

test('TASK A: dev run creates no file when none exists', () => {
  const desktopPath = path.join(tempDir, 'screen-buddy.desktop')
  assert.strictEqual(fs.existsSync(desktopPath), false)

  _setTestOverrides({
    isPackaged: false,
    autostartDir: tempDir,
  })

  const setResult = setAutostart()
  assert.strictEqual(setResult.success, false)
  assert.strictEqual(setResult.devBuild, true)

  assert.strictEqual(fs.existsSync(desktopPath), false)
})

test('TASK A: AppImage repair fixes a dev-electron Exec path', () => {
  const desktopPath = path.join(tempDir, 'screen-buddy.desktop')
  const devElectronContent = `[Desktop Entry]
Type=Application
Name=screen-buddy
Comment=Desktop companion for self-care reminders
Exec="/home/user/Screen-Buddy/node_modules/electron/dist/electron" "/home/user/Screen-Buddy" --autostart
Icon=screen-buddy
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
`
  fs.writeFileSync(desktopPath, devElectronContent, 'utf-8')

  const targetAppImage = '/home/user/bin/Screen-Buddy-x86_64.AppImage'
  _setTestOverrides({
    isPackaged: true,
    autostartDir: tempDir,
    appImage: targetAppImage,
  })

  const repaired = repairAutostartExecIfNeeded(undefined, true)
  assert.strictEqual(repaired, true)

  const updatedContent = fs.readFileSync(desktopPath, 'utf-8')
  assert.ok(updatedContent.includes(`Exec="${targetAppImage}" --autostart`))
  assert.ok(!updatedContent.includes('node_modules/electron/dist/electron'))
})

test('TASK A: AppImage repair does nothing when autostart is off', () => {
  const desktopPath = path.join(tempDir, 'screen-buddy.desktop')
  const oldContent = `[Desktop Entry]
Type=Application
Name=screen-buddy
Exec="/old/path/Screen-Buddy-0.1.0-x86_64.AppImage" --autostart
`
  fs.writeFileSync(desktopPath, oldContent, 'utf-8')

  _setTestOverrides({
    isPackaged: true,
    autostartDir: tempDir,
    appImage: '/new/path/Screen-Buddy-x86_64.AppImage',
  })

  // When autostart is false, repair must do nothing
  const repaired = repairAutostartExecIfNeeded(undefined, false)
  assert.strictEqual(repaired, false)

  const contentAfter = fs.readFileSync(desktopPath, 'utf-8')
  assert.strictEqual(contentAfter, oldContent)

  // Also when autostart is false and file does not exist, it creates no file
  fs.unlinkSync(desktopPath)
  const repairedNoFile = repairAutostartExecIfNeeded(undefined, false)
  assert.strictEqual(repairedNoFile, false)
  assert.strictEqual(fs.existsSync(desktopPath), false)
})
