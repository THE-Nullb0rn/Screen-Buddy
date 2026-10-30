/**
 * Sound Manager for Screen Buddy companion.
 *
 * Loads sound files from assets/sounds/ via import.meta.glob.
 * If a sound file is missing or audio playback fails, execution fails silently
 * without errors, console warnings, or retries.
 */

const soundModules = import.meta.glob('./assets/sounds/*.{ogg,mp3,wav}', {
  eager: true,
  import: 'default',
})

const CAT_VOICE_CLIPS = new Set(['meow_happy', 'meow_hungry', 'purr'])

let currentVoiceAudio = null
let lastVoiceTime = 0

function resolveSoundUrl(clipName) {
  for (const [path, url] of Object.entries(soundModules)) {
    const filename = path.split('/').pop().replace(/\.[^/.]+$/, '')
    if (filename === clipName) {
      return url
    }
  }
  return null
}

export function playSound(clipName, { settings, paused, isAsleep }) {
  if (paused) return

  // Master switch: Sound Effects must be ON
  if (!settings?.soundEffects) return

  // Per-sound gating
  if (clipName === 'reminder') {
    if (settings.reminderSound === false) return
  } else if (clipName === 'chat_reply') {
    if (!settings.notificationSounds) return
  } else if (CAT_VOICE_CLIPS.has(clipName)) {
    if (!settings.catVoiceSounds) return
    // No cat voice while asleep
    if (isAsleep) return

    const now = Date.now()
    // At least 1.5s between cat voice clips
    if (now - lastVoiceTime < 1500) return
    lastVoiceTime = now

    // At most one cat voice clip at a time
    if (currentVoiceAudio) {
      try {
        currentVoiceAudio.pause()
        currentVoiceAudio.currentTime = 0
      } catch (_err) {
        // ignore error stopping previous audio
      }
      currentVoiceAudio = null
    }
  }

  const url = resolveSoundUrl(clipName)
  if (!url) {
    // Missing file is silent
    return
  }

  try {
    const audio = new Audio(url)
    const vol = typeof settings?.soundVolume === 'number' ? settings.soundVolume : 70
    audio.volume = Math.max(0, Math.min(1, vol / 100))

    if (CAT_VOICE_CLIPS.has(clipName)) {
      currentVoiceAudio = audio
      audio.onended = () => {
        if (currentVoiceAudio === audio) {
          currentVoiceAudio = null
        }
      }
    }

    const playPromise = audio.play()
    if (playPromise !== undefined && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {})
    }
  } catch (_err) {
    // Never block, never throw, never retry
  }
}
