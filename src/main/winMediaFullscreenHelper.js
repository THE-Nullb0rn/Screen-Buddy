'use strict'

const { spawn } = require('child_process')

const MAX_FAILURES = 5
const DEFAULT_FS_POLL_MS = 1000
const SLOW_FS_POLL_MS = 2000
const MEDIA_POLL_MS = 2000

// One shared persistent PowerShell 5.1 helper handles both WinRT media (GSMTC)
// and Win32 fullscreen detection so only one hidden host process runs (~30 MB RAM vs 2 processes).
function buildPowerShellScript() {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$ownPid = 0
[int]::TryParse($env:SB_MAIN_PID, [ref]$ownPid) | Out-Null
$pollMs = 1000
if ([int]::TryParse($env:SB_POLL_MS, [ref]$pollMs)) {
  if ($pollMs -lt 500) { $pollMs = 500 }
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SbWinNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }

  [DllImport("shell32.dll")]
  public static extern int SHQueryUserNotificationState(out int pquns);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

  [DllImport("user32.dll")]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@

try { [SbWinNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}

$winRtOk = $false
$mgr = $null
$asTaskOp = $null

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null

  $asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]

  if ($asTaskOp -ne $null) {
    $req = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $m = $asTaskOp.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $nt = $m.Invoke($null, @($req))
    $nt.Wait(5000) | Out-Null
    if ($nt.IsCompleted -and -not $nt.IsFaulted -and $nt.Result -ne $null) {
      $mgr = $nt.Result
      $winRtOk = $true
    }
  }
} catch {
  $winRtOk = $false
}

Write-Output (@{ type = 'cap'; mediaAvailable = $winRtOk; fullscreenAvailable = $true } | ConvertTo-Json -Compress)

function Test-FullscreenState {
  $fg = [SbWinNative]::GetForegroundWindow()
  if ($fg -eq [IntPtr]::Zero) { return @{ fs = $false; reason = 'no-fg' } }
  if (-not [SbWinNative]::IsWindowVisible($fg)) { return @{ fs = $false; reason = 'hidden' } }
  if ([SbWinNative]::IsIconic($fg)) { return @{ fs = $false; reason = 'minimized' } }

  $clsSb = New-Object System.Text.StringBuilder 256
  [SbWinNative]::GetClassName($fg, $clsSb, 256) | Out-Null
  $cls = $clsSb.ToString()
  if ($cls -eq 'Progman' -or $cls -eq 'WorkerW' -or $cls -eq 'Shell_TrayWnd' -or $cls -eq 'Shell_SecondaryTrayWnd') {
    return @{ fs = $false; reason = "shell:$cls" }
  }

  [uint32]$fgPid = 0
  [SbWinNative]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
  if ($ownPid -gt 0 -and $fgPid -eq $ownPid) {
    return @{ fs = $false; reason = 'own-pid' }
  }

  $titleSb = New-Object System.Text.StringBuilder 256
  [SbWinNative]::GetWindowText($fg, $titleSb, 256) | Out-Null
  $winTitle = $titleSb.ToString()
  if ($winTitle -eq 'screen-buddy-overlay' -or $winTitle -eq 'screen-buddy-bubbles' -or $winTitle -eq 'screen-buddy-settings') {
    return @{ fs = $false; reason = 'own-title' }
  }

  $quns = 0
  $hr = [SbWinNative]::SHQueryUserNotificationState([ref]$quns)
  # 3 = QUNS_RUNNING_D3D_FULL_SCREEN, 4 = QUNS_PRESENTATION_MODE
  if ($hr -eq 0 -and ($quns -eq 3 -or $quns -eq 4)) {
    return @{ fs = $true; reason = "quns:$quns" }
  }

  $r = New-Object SbWinNative+RECT
  if (-not [SbWinNative]::GetWindowRect($fg, [ref]$r)) {
    return @{ fs = $false; reason = 'no-rect' }
  }
  if (($r.Right - $r.Left) -le 0 -or ($r.Bottom - $r.Top) -le 0) {
    return @{ fs = $false; reason = 'empty-rect' }
  }

  $mon = [SbWinNative]::MonitorFromWindow($fg, 2)
  if ($mon -eq [IntPtr]::Zero) { return @{ fs = $false; reason = 'no-monitor' } }
  $mi = New-Object SbWinNative+MONITORINFO
  $mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($mi)
  if (-not [SbWinNative]::GetMonitorInfo($mon, [ref]$mi)) {
    return @{ fs = $false; reason = 'no-monitor-info' }
  }

  # 2 = QUNS_BUSY when an interactive window (not desktop/shell) occupies the screen
  $coversMonitor = ($r.Left -le $mi.rcMonitor.Left -and $r.Top -le $mi.rcMonitor.Top -and $r.Right -ge $mi.rcMonitor.Right -and $r.Bottom -ge $mi.rcMonitor.Bottom)
  if (-not $coversMonitor) {
    return @{ fs = $false; reason = 'partial-rect' }
  }

  # Exclude normal maximized windows that have a caption title bar (even when taskbar auto-hides so rcWork == rcMonitor)
  $style = [SbWinNative]::GetWindowLong($fg, -16) # GWL_STYLE
  $hasCaption = (($style -band 0x00C00000) -eq 0x00C00000) # WS_CAPTION
  $isZoomed = [SbWinNative]::IsZoomed($fg)
  if ($isZoomed -and $hasCaption -and ($hr -ne 0 -or $quns -ne 2)) {
    return @{ fs = $false; reason = 'maximized-captioned' }
  }

  if ($hr -eq 0 -and $quns -eq 2) {
    return @{ fs = $true; reason = 'quns:2+rect' }
  }
  return @{ fs = $true; reason = 'monitor-rect' }
}

function Get-MediaSnapshot {
  if (-not $winRtOk -or $mgr -eq $null) { return $null }
  try {
    $sessions = $mgr.GetSessions()
    $target = $null
    if ($sessions -ne $null) {
      foreach ($s in $sessions) {
        if ($s -ne $null) {
          $pi = $s.GetPlaybackInfo()
          if ($pi -ne $null -and $pi.PlaybackStatus.ToString() -eq 'Playing') {
            $target = $s
            break
          }
        }
      }
    }
    if ($target -eq $null) {
      $target = $mgr.GetCurrentSession()
    }
    if ($target -eq $null) {
      return @{ playing = $false; status = 'Stopped'; title = ''; artist = ''; app = '' }
    }

    $info = $target.GetPlaybackInfo()
    $status = if ($info -ne $null) { $info.PlaybackStatus.ToString() } else { 'Stopped' }
    $isPlaying = ($status -eq 'Playing')
    $appId = if ($target.SourceAppUserModelId) { [string]$target.SourceAppUserModelId } else { '' }
    $title = ''
    $artist = ''

    try {
      $op = $target.TryGetMediaPropertiesAsync()
      $m = $asTaskOp.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $nt = $m.Invoke($null, @($op))
      $nt.Wait(1500) | Out-Null
      if ($nt.IsCompleted -and -not $nt.IsFaulted -and $nt.Result -ne $null) {
        if ($nt.Result.Title) { $title = [string]$nt.Result.Title }
        if ($nt.Result.Artist) { $artist = [string]$nt.Result.Artist }
      }
    } catch {}

    return @{ playing = $isPlaying; status = $status; title = $title; artist = $artist; app = $appId }
  } catch {
    return @{ playing = $false; status = 'Stopped'; title = ''; artist = ''; app = '' }
  }
}

$lastFs = $null
$lastMediaKey = ''
$lastMediaAt = [DateTime]::MinValue

while ($true) {
  $fsRes = Test-FullscreenState
  if ($lastFs -eq $null -or $fsRes.fs -ne $lastFs) {
    $lastFs = $fsRes.fs
    Write-Output (@{ type = 'fullscreen'; fullscreen = $fsRes.fs; reason = $fsRes.reason } | ConvertTo-Json -Compress)
  }

  $now = [DateTime]::UtcNow
  if ($winRtOk -and ($now - $lastMediaAt).TotalMilliseconds -ge ${MEDIA_POLL_MS}) {
    $lastMediaAt = $now
    $snap = Get-MediaSnapshot
    if ($snap -ne $null) {
      $key = "$($snap.status)|$($snap.title)|$($snap.artist)|$($snap.app)"
      if ($key -ne $lastMediaKey) {
        $lastMediaKey = $key
        Write-Output (@{
          type = 'media'
          playing = $snap.playing
          status = $snap.status
          title = $snap.title
          artist = $snap.artist
          app = $snap.app
        } | ConvertTo-Json -Compress)
      }
    }
  }

  [System.Threading.Thread]::Sleep($pollMs)
}
`
}

let childProc = null
let restartTimer = null
let stopped = false
let consecutiveFailures = 0
let startedAt = 0
let currentPollMs = DEFAULT_FS_POLL_MS

let mediaCallback = null
let fullscreenCallback = null
let capCallback = null

let lastMediaState = { playing: false, status: 'Stopped', artist: '', title: '', app: '' }
let lastFullscreen = false

let capabilities = {
  media: { available: true },
  fullscreen: { available: true },
}

function updateCapabilities(next) {
  capabilities = {
    media: { ...next.media },
    fullscreen: { ...next.fullscreen },
  }
  if (typeof capCallback === 'function') {
    capCallback(getCapabilities())
  }
}

function getCapabilities() {
  return {
    media: { ...capabilities.media },
    fullscreen: { ...capabilities.fullscreen },
  }
}

function getMediaStatus() {
  return { ...lastMediaState }
}

function handleHelperLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== '{') return

  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch (_) {
    return
  }

  if (msg.type === 'cap') {
    const mediaAvailable = msg.mediaAvailable !== false
    const fullscreenAvailable = msg.fullscreenAvailable !== false
    updateCapabilities({
      media: mediaAvailable
        ? { available: true }
        : { available: false, reason: 'Windows WinRT media control unavailable' },
      fullscreen: fullscreenAvailable
        ? { available: true }
        : { available: false, reason: 'Windows fullscreen detector unavailable' },
    })
    return
  }

  if (msg.type === 'media') {
    lastMediaState = {
      playing: Boolean(msg.playing),
      status: msg.status || (msg.playing ? 'Playing' : 'Stopped'),
      artist: msg.artist || '',
      title: msg.title || '',
      app: msg.app || '',
    }
    if (typeof mediaCallback === 'function') {
      mediaCallback({ ...lastMediaState })
    }
    return
  }

  if (msg.type === 'fullscreen') {
    const fs = Boolean(msg.fullscreen)
    if (fs !== lastFullscreen) {
      lastFullscreen = fs
      if (typeof fullscreenCallback === 'function') {
        fullscreenCallback(fs, msg.reason || 'poll')
      }
    }
  }
}

function spawnHelper() {
  if (process.platform !== 'win32' || stopped) return
  if (childProc) return

  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  const encoded = Buffer.from(buildPowerShellScript(), 'utf16le').toString('base64')
  startedAt = Date.now()

  try {
    childProc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SB_MAIN_PID: String(process.pid),
          SB_POLL_MS: String(currentPollMs),
        },
      }
    )
  } catch (err) {
    childProc = null
    scheduleRestart(err.message)
    return
  }

  let stdoutBuf = ''
  childProc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8')
    const lines = stdoutBuf.split(/\r?\n/)
    stdoutBuf = lines.pop() || ''
    if (stdoutBuf.length > 16384) stdoutBuf = ''
    for (const line of lines) {
      handleHelperLine(line)
    }
  })

  childProc.stderr.on('data', (chunk) => {
    const msg = chunk.toString('utf8').trim()
    if (msg && process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.warn('[winHelper] stderr:', msg)
    }
  })

  childProc.on('error', (err) => {
    if (process.env.SCREEN_BUDDY_DEBUG === '1') {
      console.warn('[winHelper] process error:', err.message)
    }
    childProc = null
    scheduleRestart(err.message)
  })

  childProc.on('close', (code) => {
    const wasManual = stopped
    childProc = null
    if (wasManual) return

    const aliveMs = Date.now() - startedAt
    if (aliveMs > 10000) {
      consecutiveFailures = 0
    }
    scheduleRestart(`exit code ${code}`)
  })

  if (process.env.SCREEN_BUDDY_DEBUG === '1') {
    console.log(`[winHelper] PowerShell helper started (pid=${childProc.pid}, poll=${currentPollMs}ms)`)
  }
}

function scheduleRestart(reason) {
  if (stopped) return
  consecutiveFailures += 1
  if (consecutiveFailures >= MAX_FAILURES) {
    console.error(`[winHelper] Helper failed ${MAX_FAILURES} times (${reason}); disabling Windows media & fullscreen detection for this session`)
    updateCapabilities({
      media: { available: false, reason: 'Windows media helper unavailable' },
      fullscreen: { available: false, reason: 'Windows fullscreen helper unavailable' },
    })
    return
  }
  const delayMs = Math.min(16000, 1000 * Math.pow(2, consecutiveFailures - 1))
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    spawnHelper()
  }, delayMs)
}

function start({ onMedia, onFullscreen, onCapabilitiesChanged, limitBackgroundCpu = false } = {}) {
  if (process.platform !== 'win32') return
  if (onMedia !== undefined) mediaCallback = onMedia
  if (onFullscreen !== undefined) fullscreenCallback = onFullscreen
  if (onCapabilitiesChanged !== undefined) capCallback = onCapabilitiesChanged

  stopped = false
  currentPollMs = limitBackgroundCpu ? SLOW_FS_POLL_MS : DEFAULT_FS_POLL_MS
  if (!childProc && consecutiveFailures < MAX_FAILURES) {
    spawnHelper()
  }
}

function setLimitBackgroundCpu(limitBackgroundCpu) {
  if (process.platform !== 'win32') return
  const nextPoll = limitBackgroundCpu ? SLOW_FS_POLL_MS : DEFAULT_FS_POLL_MS
  if (nextPoll === currentPollMs) return
  currentPollMs = nextPoll
  if (stopped || consecutiveFailures >= MAX_FAILURES) return

  if (childProc) {
    const prev = childProc
    childProc = null
    try {
      prev.removeAllListeners('close')
      prev.removeAllListeners('error')
      prev.kill()
    } catch (_) {
      /* ignore kill errors */
    }
    spawnHelper()
  }
}

function stop() {
  stopped = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (childProc) {
    try {
      childProc.removeAllListeners('close')
      childProc.removeAllListeners('error')
      childProc.kill()
    } catch (_) {
      /* ignore kill errors */
    }
    childProc = null
  }
  mediaCallback = null
  fullscreenCallback = null
  capCallback = null
}

function getHelperPid() {
  return childProc ? childProc.pid : null
}

module.exports = {
  start,
  stop,
  setLimitBackgroundCpu,
  getMediaStatus,
  getCapabilities,
  getHelperPid,
}
