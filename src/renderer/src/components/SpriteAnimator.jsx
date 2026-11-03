import React, { useEffect, useRef, useState } from 'react'
import defaultManifest from '../assets/cat-sprite/manifest.json'
import defaultSheetSrc from '../assets/cat-sprite/spritesheet.png'
import listeningSheetSrc from '../assets/cat-sprite/cat_listening_spritesheet.png'
import listeningManifest from '../assets/cat-sprite/listening-manifest.json'
import animsManifest from '../assets/cat-sprite/anims/anims.json'
import './SpriteAnimator.css'

// ── Lazy strip loaders via import.meta.glob ───────────────────────────────────
const stripModules = import.meta.glob('../assets/cat-sprite/anims/*.png', { query: '?url', import: 'default' })
const stripLoaders = {}
for (const [path, loader] of Object.entries(stripModules)) {
  const name = path.split('/').pop().replace(/\.png$/, '')
  stripLoaders[name] = loader
}

// ── LRU strip image cache (pinned core anims never evicted, inactive unpinned evicted) ──
const stripCache = new Map() // url -> Image
const stripUrlCache = new Map() // animName -> Promise<string>
const pinnedUrls = new Set()
const activeUrls = new Set()

export const CORE_ANIMATIONS = ['idle', 'walk', 'purr', 'drag', 'fall', 'sleep', 'wakeup', 'standidle', 'standup', 'sitdown']

let preloadedOnce = false
export function preloadCommonAnimations() {
  if (preloadedOnce) return
  preloadedOnce = true
  CORE_ANIMATIONS.forEach((name) => {
    try {
      loadStripUrl(name)
        .then((url) => {
          if (url) {
            pinnedUrls.add(url)
            loadStripImage(url).catch(() => {})
          }
        })
        .catch(() => {})
    } catch (_) {
      // ignore
    }
  })
  try {
    getOldSheetImage(defaultSheetSrc, () => {})
  } catch (_) {
    // ignore
  }
}

export function loadStripUrl(animName) {
  if (stripUrlCache.has(animName)) return stripUrlCache.get(animName)
  const loader = stripLoaders[animName]
  if (!loader) return Promise.resolve(null)
  const p = loader().then((mod) => (typeof mod === 'string' ? mod : mod?.default || mod))
  stripUrlCache.set(animName, p)
  return p
}

export function loadStripImage(url) {
  if (!url) return Promise.resolve(null)
  if (stripCache.has(url)) {
    const img = stripCache.get(url)
    stripCache.delete(url)
    stripCache.set(url, img)
    if (img.complete && img.naturalWidth > 0) return Promise.resolve(img)
  }
  return new Promise((resolve) => {
    let img = stripCache.get(url)
    if (!img) {
      img = new Image()
      stripCache.set(url, img)
      // Evict oldest unpinned, inactive if cache exceeds limit
      const MAX_CACHE_SIZE = 16
      if (stripCache.size > MAX_CACHE_SIZE) {
        for (const [key, cachedImg] of stripCache.entries()) {
          if (stripCache.size <= MAX_CACHE_SIZE) break
          if (key === url || pinnedUrls.has(key) || activeUrls.has(key)) continue
          if (cachedImg && cachedImg !== img) {
            cachedImg.src = ''
          }
          stripCache.delete(key)
        }
      }
      img.src = url
    }
    if (img.complete && img.naturalWidth > 0) {
      if (img.decode) {
        img.decode().then(() => resolve(img)).catch(() => resolve(img))
      } else {
        resolve(img)
      }
    } else {
      img.onload = () => {
        if (img.decode) {
          img.decode().then(() => resolve(img)).catch(() => resolve(img))
        } else {
          resolve(img)
        }
      }
      img.onerror = () => resolve(null)
    }
  })
}

// Shared image cache for old sheets
const sheetCache = new Map()
function getOldSheetImage(src, onLoaded) {
  let img = sheetCache.get(src)
  if (img && img.complete && img.naturalWidth > 0) {
    onLoaded(img)
    return () => {}
  }
  if (!img) {
    img = new Image()
    sheetCache.set(src, img)
    img.src = src
  }
  const listener = () => onLoaded(img)
  if (img.complete && img.naturalWidth > 0) {
    listener()
    return () => {}
  }
  img.addEventListener('load', listener, { once: true })
  return () => {
    img.removeEventListener('load', listener)
  }
}

export const SPEED_FACTORS = {
  slow: 0.5,
  normal: 1,
  fast: 2,
}

// Fallbacks for LISTENING mode where new art is not yet provided
export const LISTENING_FALLBACKS = {
  curious: 'idle',
  purr: 'pet',
  sad: 'idle',
  annoyed: 'idle',
  toyplay: 'play',
  drink: 'eat',
  crouchpounce: 'pounce',
}

// Draw-time / display vertical offsets for animations that need headroom adjustment
export const DISPLAY_OFFSET_Y = {
  fall: 34,
}

// Draw-time / display horizontal offsets for animations that need edge alignment (px at cell scale)
export const DISPLAY_OFFSET_X = {
  knockoff: 42,
}

// 40-entry ring buffer tracer for sprite draw calls
export const drawTracer = []
const MAX_TRACER_SIZE = 40

export function resolveAnimation(name, isListening = false) {
  if (!name) return { type: 'strip', name: 'idle', config: animsManifest.animations?.idle }

  let animName = name
  if (animName === 'crouch' || animName === 'pounce') {
    animName = 'crouchpounce'
  }

  if (animName === 'idle-old' && !isListening) {
    return { type: 'sheet', name: 'idle-old' }
  }

  if (isListening) {
    if (listeningManifest.animations[animName]) {
      return { type: 'sheet', name: animName }
    }
    const fallback = LISTENING_FALLBACKS[animName] || LISTENING_FALLBACKS[name]
    if (fallback && listeningManifest.animations[fallback]) {
      return { type: 'sheet', name: fallback }
    }
    return { type: 'sheet', name: 'idle' }
  }

  // Non-listening cat: check per-animation strip
  const strip = animsManifest.animations?.[animName]
  if (strip) {
    return { type: 'strip', name: animName, config: strip }
  }

  // Fall back to old sheet
  if (defaultManifest.animations[name]) {
    return { type: 'sheet', name }
  }
  if (defaultManifest.animations[animName]) {
    return { type: 'sheet', name: animName }
  }

  return { type: 'strip', name: 'idle', config: animsManifest.animations?.idle }
}

export function getAssetKey(resolved, isListening = false, customSheet = null) {
  if (!resolved) return 'strip:idle'
  if (resolved.type === 'strip') {
    return `strip:${resolved.name}`
  }
  const sheetName = isListening ? 'listening' : (customSheet ? 'custom' : (resolved.name || 'default'))
  return `sheet:${sheetName}`
}

/**
 * Custom hook to drive frame stepping based on manifest or strip config
 */
export function useSpriteAnimation({
  animation = 'idle',
  assetKey,
  manifest = defaultManifest,
  stripConfig = null,
  loop: propLoop,
  onAnimationEnd,
  speed = 'normal',
  fpsCap = 60,
}) {
  const isStrip = Boolean(stripConfig)
  let totalFrames = 1
  let fps = 1
  let loop = true
  let frameDurations = null

  if (isStrip) {
    totalFrames = stripConfig.frames || 1
    fps = stripConfig.fps || 1
    loop = propLoop !== undefined ? propLoop : (stripConfig.mode === 'loop')
  } else {
    const sheetAnimName = animation === 'idle-old' ? 'idle' : animation
    const baseConfig = manifest.animations[sheetAnimName] || manifest.animations.idle || { frames: [0], fps: 1, loop: true }
    totalFrames = baseConfig.frames.length
    fps = baseConfig.fps || 1
    loop = propLoop !== undefined ? propLoop : baseConfig.loop
    frameDurations = baseConfig.frameDurations || null
  }

  const [frameIndex, setFrameIndex] = useState(0)

  const animRef = useRef({ totalFrames, fps, loop, frameDurations, isStrip })
  animRef.current = { totalFrames, fps, loop, frameDurations, isStrip }

  const switchKey = assetKey || animation
  const currentKeyRef = useRef(switchKey)
  const currentAnimationRef = useRef(animation)
  currentAnimationRef.current = animation
  const isAnimSwitch = currentKeyRef.current !== switchKey
  const activeFrameIndex = isAnimSwitch ? 0 : frameIndex
  const onEndRef = useRef(onAnimationEnd)
  const frameIndexRef = useRef(0)
  const speedFactorRef = useRef(1)
  const fpsCapRef = useRef(fpsCap)
  const idleBlinkStateRef = useRef({
    openDuration: 3000 + Math.random() * 3000,
    blinkDuration: 120 + Math.random() * 60,
    doubleBlinkPending: false,
    isSecondBlinkOpen: false,
  })

  onEndRef.current = onAnimationEnd
  speedFactorRef.current = typeof speed === 'number' ? speed : (SPEED_FACTORS[speed] || 1)
  fpsCapRef.current = fpsCap

  useEffect(() => {
    if (currentKeyRef.current !== switchKey) {
      currentKeyRef.current = switchKey
      frameIndexRef.current = 0
      setFrameIndex(0)
      if (animation === 'idle' || animation === 'idle-old') {
        idleBlinkStateRef.current = {
          openDuration: 3000 + Math.random() * 3000,
          blinkDuration: 120 + Math.random() * 60,
          doubleBlinkPending: false,
          isSecondBlinkOpen: false,
        }
      }
    }
  }, [switchKey, animation])

  useEffect(() => {
    let animFrameId
    let lastTime = performance.now()
    let lastStepTime = 0
    let accumulated = 0

    const tick = (now) => {
      const cap = fpsCapRef.current || 60
      const minInterval = 1000 / cap
      if (now - lastStepTime < minInterval - 1) {
        animFrameId = requestAnimationFrame(tick)
        return
      }
      lastStepTime = now
      accumulated += now - lastTime
      lastTime = now

      const { totalFrames: tf, fps: fRate, loop: isLoop, frameDurations: fDurs, isStrip: sMode } = animRef.current
      let idx = frameIndexRef.current
      const speedFactor = speedFactorRef.current || 1

      let safety = 0
      while (safety++ < tf + 1) {
        let rawDuration
        const isTwoFrameIdle = !sMode && (currentAnimationRef.current === 'idle' || currentAnimationRef.current === 'idle-old') && tf === 2
        if (isTwoFrameIdle) {
          if (idx === 0) {
            rawDuration = idleBlinkStateRef.current.isSecondBlinkOpen
              ? 120 + Math.random() * 50
              : idleBlinkStateRef.current.openDuration
          } else {
            rawDuration = idleBlinkStateRef.current.blinkDuration
          }
        } else {
          rawDuration = fDurs
            ? (fDurs[idx] ?? (1000 / (fRate || 1)))
            : (1000 / (fRate || 1))
        }
        const duration = rawDuration / speedFactor

        if (accumulated < duration) break

        accumulated -= duration

        const next = idx + 1
        if (next >= tf) {
          if (isLoop) {
            idx = 0
            if (isTwoFrameIdle) {
              if (idleBlinkStateRef.current.doubleBlinkPending) {
                idleBlinkStateRef.current.isSecondBlinkOpen = true
                idleBlinkStateRef.current.doubleBlinkPending = false
                idleBlinkStateRef.current.blinkDuration = 120 + Math.random() * 60
              } else {
                idleBlinkStateRef.current.isSecondBlinkOpen = false
                idleBlinkStateRef.current.openDuration = 3000 + Math.random() * 3000
                idleBlinkStateRef.current.blinkDuration = 120 + Math.random() * 60
                idleBlinkStateRef.current.doubleBlinkPending = Math.random() < 0.2
              }
            }
          } else {
            // Mode "once": hold the last frame and notify end
            idx = tf - 1
            if (idx !== frameIndexRef.current) {
              frameIndexRef.current = idx
              setFrameIndex(idx)
            }
            onEndRef.current?.(currentAnimationRef.current)
            return
          }
        } else {
          idx = next
        }
      }

      if (idx !== frameIndexRef.current) {
        frameIndexRef.current = idx
        setFrameIndex(idx)
      }

      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameId)
  }, [switchKey])

  let currentFrame = activeFrameIndex
  if (!isStrip) {
    const sheetAnimName = animation === 'idle-old' ? 'idle' : animation
    const baseConfig = manifest.animations[sheetAnimName] || manifest.animations.idle || { frames: [0] }
    const safeIdx = Math.min(activeFrameIndex, baseConfig.frames.length - 1)
    currentFrame = baseConfig.frames[Math.max(0, safeIdx)] ?? baseConfig.frames[0] ?? 0
  } else {
    const safeIdx = Math.min(activeFrameIndex, totalFrames - 1)
    currentFrame = Math.max(0, safeIdx)
  }

  return {
    currentFrame,
    frameIndex,
    cellWidth: isStrip ? (stripConfig?.cellWidth || 210) : manifest.cellWidth,
    cellHeight: isStrip ? (stripConfig?.cellHeight || 300) : manifest.cellHeight,
    columns: isStrip ? (stripConfig?.frames || totalFrames) : manifest.columns,
    scale: manifest.scale || 0.6,
  }
}

const eyeShiftCache = new Map()

function getEyeShiftedCanvas(imageSrc, img, cellW, cellH, col, row, dx, dy, isStrip = false) {
  if (dx === 0 && dy === 0) return null
  const cacheKey = `${imageSrc}:${col},${row}:${dx},${dy}`
  if (eyeShiftCache.has(cacheKey)) {
    return eyeShiftCache.get(cacheKey)
  }

  const offscreen = document.createElement('canvas')
  offscreen.width = cellW
  offscreen.height = cellH
  const ctx = offscreen.getContext('2d')
  if (!ctx) return null

  ctx.imageSmoothingEnabled = false
  const sx = col * cellW
  const sy = row * cellH
  ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, cellW, cellH)

  const imgData = ctx.getImageData(0, 0, cellW, cellH)
  const data = imgData.data

  const furR = 0x28
  const furG = 0x2c
  const furB = 0x38

  const eyePixels = []

  if (isStrip) {
    // Clamp displacement to at most 1 source pixel horizontally and 1 vertically
    const shiftX = Math.max(-1, Math.min(1, dx))
    const shiftY = Math.max(-1, Math.min(1, dy))
    if (shiftX === 0 && shiftY === 0) {
      eyeShiftCache.set(cacheKey, null)
      return null
    }

    // Collect green iris pixels to find iris region and iris color
    const greens = []
    let totalR = 0
    let totalG = 0
    let totalB = 0
    const maxY = Math.min(cellH - 1, 225)

    for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x < cellW; x++) {
        const off = (y * cellW + x) * 4
        const a = data[off + 3]
        if (a < 100) continue
        const r = data[off]
        const g = data[off + 1]
        const b = data[off + 2]
        if (g > 60 && g > r * 1.15 && g > b * 1.15) {
          greens.push({ x, y })
          totalR += r
          totalG += g
          totalB += b
        }
      }
    }

    // Skip frames with fewer than 6 green pixels (closed eyes)
    if (greens.length < 6) {
      eyeShiftCache.set(cacheKey, null)
      return null
    }

    const irisR = Math.round(totalR / greens.length)
    const irisG = Math.round(totalG / greens.length)
    const irisB = Math.round(totalB / greens.length)

    let minGx = cellW
    let maxGx = 0
    let minGy = cellH
    let maxGy = 0
    for (const gp of greens) {
      if (gp.x < minGx) minGx = gp.x
      if (gp.x > maxGx) maxGx = gp.x
      if (gp.y < minGy) minGy = gp.y
      if (gp.y > maxGy) maxGy = gp.y
    }

    // Find pupil pixels: dark pixels strictly within the iris bounding box (with 2px margin)
    const pupilPixels = []
    const boxMinX = Math.max(0, minGx - 2)
    const boxMaxX = Math.min(cellW - 1, maxGx + 2)
    const boxMinY = Math.max(0, minGy - 2)
    const boxMaxY = Math.min(maxY, maxGy + 2)

    for (let y = boxMinY; y <= boxMaxY; y++) {
      for (let x = boxMinX; x <= boxMaxX; x++) {
        const off = (y * cellW + x) * 4
        const a = data[off + 3]
        if (a < 100) continue
        const r = data[off]
        const g = data[off + 1]
        const b = data[off + 2]
        const isPupil = r < 30 && g < 35 && b < 55
        if (isPupil) {
          pupilPixels.push({ x, y, r, g, b, a })
        }
      }
    }

    if (pupilPixels.length === 0) {
      eyeShiftCache.set(cacheKey, null)
      return null
    }

    // 1. Fill original pupil pixel positions with iris green color
    for (const pp of pupilPixels) {
      const off = (pp.y * cellW + pp.x) * 4
      data[off] = irisR
      data[off + 1] = irisG
      data[off + 2] = irisB
      data[off + 3] = 255
    }

    // 2. Draw pupil pixels shifted by (shiftX, shiftY)
    for (const pp of pupilPixels) {
      const nx = pp.x + shiftX
      const ny = pp.y + shiftY
      if (nx >= 0 && nx < cellW && ny >= 0 && ny < cellH) {
        const off = (ny * cellW + nx) * 4
        data[off] = pp.r
        data[off + 1] = pp.g
        data[off + 2] = pp.b
        data[off + 3] = pp.a
      }
    }

    ctx.putImageData(imgData, 0, 0)
    eyeShiftCache.set(cacheKey, offscreen)
    return offscreen
  } else {
    // Old logic for old spritesheet
    const isListening = (imageSrc || '').includes('listening')
    const eyeBoxes = isListening
      ? [
          { minX: 99, maxX: 122, minY: 204, maxY: 223 },
          { minX: 124, maxX: 142, minY: 204, maxY: 223 },
        ]
      : [
          { minX: 104, maxX: 145, minY: 191, maxY: 219 },
          { minX: 147, maxX: 172, minY: 193, maxY: 219 },
        ]

    for (const box of eyeBoxes) {
      for (let y = box.minY; y <= box.maxY; y++) {
        for (let x = box.minX; x <= box.maxX; x++) {
          const off = (y * cellW + x) * 4
          const a = data[off + 3]
          if (a < 100) continue
          const r = data[off]
          const g = data[off + 1]
          const b = data[off + 2]
          const isGreen = g > 60 && g > r * 1.15 && g > b * 1.15
          const isGleam = r > 150 && g > 150 && b < 120
          const isPupil = r < 30 && g < 35 && b < 55
          if (isGreen || isGleam || isPupil) {
            eyePixels.push({ x, y, r, g, b, a })
          }
        }
      }
    }
  }

  if (eyePixels.length === 0) {
    eyeShiftCache.set(cacheKey, null)
    return null
  }

  for (const ep of eyePixels) {
    const off = (ep.y * cellW + ep.x) * 4
    data[off] = furR
    data[off + 1] = furG
    data[off + 2] = furB
    data[off + 3] = 255
  }

  for (const ep of eyePixels) {
    const nx = ep.x + dx
    const ny = ep.y + dy
    if (nx >= 0 && nx < cellW && ny >= 0 && ny < cellH) {
      const off = (ny * cellW + nx) * 4
      data[off] = ep.r
      data[off + 1] = ep.g
      data[off + 2] = ep.b
      data[off + 3] = ep.a
    }
  }

  ctx.putImageData(imgData, 0, 0)
  eyeShiftCache.set(cacheKey, offscreen)
  return offscreen
}

/**
 * Reusable SpriteAnimator component
 */
export default function SpriteAnimator({
  animation = 'idle',
  flipped = false,
  loop,
  manifest = defaultManifest,
  spritesheet,
  scale: propScale,
  className = '',
  style = {},
  onAnimationEnd,
  onShown,
  speed,
  animationSpeed,
  catAnimationSpeed,
  eyeTracking = false,
  cursorOffset = null,
  fpsCap = 60,
  ...rest
}) {
  const canvasRef = useRef(null)
  const onShownRef = useRef(onShown)
  onShownRef.current = onShown
  const lastShownAssetKeyRef = useRef(null)

  const isListeningMode = Boolean(
    spritesheet === listeningSheetSrc ||
    manifest === listeningManifest ||
    (typeof spritesheet === 'string' && spritesheet.includes('listening'))
  )

  const targetResolved = resolveAnimation(animation, isListeningMode)
  const targetAssetKey = getAssetKey(targetResolved, isListeningMode, spritesheet)

  // Image references for seamless switching (no blank flash)
  const currentImgRef = useRef(null)
  const [activeAsset, setActiveAsset] = useState(() => {
    const initialResolved = resolveAnimation(animation, isListeningMode)
    const initialIsStrip = initialResolved.type === 'strip'
    const initialKey = getAssetKey(initialResolved, isListeningMode, spritesheet)
    return {
      animName: initialResolved.name,
      isStrip: initialIsStrip,
      stripConfig: initialIsStrip ? initialResolved.config : null,
      image: null,
      imageKey: initialResolved.name,
      assetKey: initialKey,
    }
  })

  // Load strip or old sheet
  useEffect(() => {
    let cancelled = false
    const targetResolvedAnim = resolveAnimation(animation, isListeningMode)
    const targetIsStrip = targetResolvedAnim.type === 'strip'
    const targetName = targetResolvedAnim.name
    const targetConfig = targetIsStrip ? targetResolvedAnim.config : null
    const targetKey = getAssetKey(targetResolvedAnim, isListeningMode, spritesheet)
    let registeredUrl = null

    if (targetIsStrip) {
      loadStripUrl(targetName).then((url) => {
        if (cancelled || !url) return
        registeredUrl = url
        activeUrls.add(url)
        loadStripImage(url).then((img) => {
          if (cancelled || !img) return
          currentImgRef.current = img
          setActiveAsset({
            animName: targetName,
            isStrip: true,
            stripConfig: targetConfig,
            image: img,
            imageKey: targetName,
            assetKey: targetKey,
          })
        })
      })
    } else {
      const sheetSrc = isListeningMode ? listeningSheetSrc : (spritesheet || defaultSheetSrc)
      const unsub = getOldSheetImage(sheetSrc, (img) => {
        if (cancelled || !img) return
        currentImgRef.current = img
        setActiveAsset({
          animName: targetName,
          isStrip: false,
          stripConfig: null,
          image: img,
          imageKey: sheetSrc,
          assetKey: targetKey,
        })
      })
      return () => {
        cancelled = true
        unsub()
        if (registeredUrl) activeUrls.delete(registeredUrl)
      }
    }

    return () => {
      cancelled = true
      if (registeredUrl) activeUrls.delete(registeredUrl)
    }
  }, [animation, isListeningMode, spritesheet])

  let eyeDx = 0
  let eyeDy = 0
  if (eyeTracking && cursorOffset && typeof cursorOffset.x === 'number' && typeof cursorOffset.y === 'number') {
    const dist = Math.hypot(cursorOffset.x, cursorOffset.y)
    if (dist >= 40 && dist <= 750) {
      const nx = cursorOffset.x / dist
      const ny = cursorOffset.y / dist
      if (Math.abs(nx) > 0.35) {
        eyeDx = (Math.abs(nx) > 0.70 || (dist > 120 && Math.abs(nx) > 0.6))
          ? Math.sign(nx) * 2
          : Math.sign(nx) * 1
      }
      if (Math.abs(ny) > 0.4) {
        eyeDy = Math.sign(ny) * 1
      }
      if (flipped) {
        eyeDx = -eyeDx
      }
    }
  }

  const effectiveSpeed = catAnimationSpeed || animationSpeed || speed || 'normal'

  const { currentFrame, cellWidth, cellHeight, columns } = useSpriteAnimation({
    animation: activeAsset.animName,
    assetKey: activeAsset.assetKey,
    manifest: isListeningMode ? listeningManifest : manifest,
    stripConfig: activeAsset.isStrip ? activeAsset.stripConfig : null,
    loop,
    onAnimationEnd,
    speed: effectiveSpeed,
    fpsCap,
  })

  const scale = propScale ?? manifest.scale ?? 0.6
  const displayWidth = Math.round(cellWidth * scale)
  const displayHeight = Math.round(cellHeight * scale)

  const rawOffsetX = DISPLAY_OFFSET_X[activeAsset.animName] || 0
  const offsetX = Math.round(rawOffsetX * scale)
  const offsetY = DISPLAY_OFFSET_Y[activeAsset.animName] || 0

  // Draw current frame to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const img = currentImgRef.current || activeAsset.image
    if (!canvas || !img) return

    // Atomicity guard: do not clear or draw if activeAsset does not match the requested animation
    if (activeAsset.assetKey !== targetAssetKey) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, displayWidth, displayHeight)
    ctx.imageSmoothingEnabled = false

    let sx = 0
    let sy = 0
    if (activeAsset.isStrip) {
      sx = currentFrame * cellWidth
      sy = 0
    } else {
      const row = Math.floor(currentFrame / columns)
      const col = currentFrame % columns
      sx = col * cellWidth
      sy = row * cellHeight
    }

    const requestedAnim = animation
    const resolvedAnim = activeAsset.animName
    const imageKey = activeAsset.imageKey
    const currentOffsetX = DISPLAY_OFFSET_X[resolvedAnim] || 0
    const currentOffsetY = DISPLAY_OFFSET_Y[resolvedAnim] || 0

    drawTracer.push({
      timestamp: Date.now(),
      requestedAnim,
      resolvedAnim,
      imageKey,
      frameIndex: currentFrame,
      sx,
      sy,
      sWidth: cellWidth,
      sHeight: cellHeight,
      dx: currentOffsetX,
      dy: currentOffsetY,
      dWidth: displayWidth,
      dHeight: displayHeight,
    })
    if (drawTracer.length > MAX_TRACER_SIZE) {
      drawTracer.shift()
    }

    const isSpuriousDrag = String(imageKey).includes('drag') && requestedAnim !== 'drag' && requestedAnim !== 'fall'

    // Only log if an unexpected mismatch slips through our guard
    if (isSpuriousDrag) {
      console.warn('[sprite-flash] Spurious draw detected!', {
        requestedAnim,
        resolvedAnim,
        imageKey,
        recentDraws: drawTracer.slice(-5),
      })
      return
    }

    const shiftedCanvas = (eyeTracking && (eyeDx !== 0 || eyeDy !== 0) && (activeAsset.animName === 'idle' || activeAsset.animName === 'idle-old'))
      ? getEyeShiftedCanvas(
          activeAsset.isStrip ? activeAsset.animName : (spritesheet || defaultSheetSrc),
          img,
          cellWidth,
          cellHeight,
          activeAsset.isStrip ? currentFrame : (currentFrame % columns),
          activeAsset.isStrip ? 0 : Math.floor(currentFrame / columns),
          eyeDx,
          eyeDy,
          activeAsset.isStrip
        )
      : null

    if (shiftedCanvas) {
      ctx.drawImage(
        shiftedCanvas,
        0,
        0,
        cellWidth,
        cellHeight,
        0,
        0,
        displayWidth,
        displayHeight
      )
    } else {
      ctx.drawImage(
        img,
        sx,
        sy,
        cellWidth,
        cellHeight,
        0,
        0,
        displayWidth,
        displayHeight
      )
    }

    if (lastShownAssetKeyRef.current !== targetAssetKey) {
      lastShownAssetKeyRef.current = targetAssetKey
      onShownRef.current?.(activeAsset.animName, targetAssetKey)
    }
  }, [
    animation,
    targetAssetKey,
    currentFrame,
    activeAsset,
    cellWidth,
    cellHeight,
    columns,
    displayWidth,
    displayHeight,
    eyeTracking,
    eyeDx,
    eyeDy,
    spritesheet
  ])

  return (
    <canvas
      ref={canvasRef}
      width={displayWidth}
      height={displayHeight}
      className={`sprite-animator ${className}`}
      style={{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
        transform: `${flipped ? 'scaleX(-1)' : ''} ${offsetX ? `translateX(${offsetX}px)` : ''} ${offsetY ? `translateY(${offsetY}px)` : ''}`.trim() || 'none',
        transformOrigin: 'center center',
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  )
}

// Preload core animations safely at the end of the module
try {
  preloadCommonAnimations()
} catch (_) {
  // ignore
}

