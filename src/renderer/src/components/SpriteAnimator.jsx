import React, { useEffect, useRef, useState } from 'react'
import defaultManifest from '../assets/cat-sprite/manifest.json'
import defaultSheetSrc from '../assets/cat-sprite/spritesheet.png'
import listeningSheetSrc from '../assets/cat-sprite/cat_listening_spritesheet.png'
import './SpriteAnimator.css'

// Shared image cache to avoid re-decoding across re-renders/mounts
const imageCache = new Map()
const imageLoadListeners = new Map()

function getSpritesheetImage(src, onLoaded) {
  let img = imageCache.get(src)
  if (img && img.complete && img.naturalWidth > 0) {
    onLoaded(img)
    return () => {}
  }

  if (!img) {
    img = new Image()
    imageCache.set(src, img)
    imageLoadListeners.set(src, [])
    img.src = src
  }

  const listener = () => onLoaded(img)
  if (img.complete && img.naturalWidth > 0) {
    listener()
    return () => {}
  }

  const listeners = imageLoadListeners.get(src) || []
  listeners.push(listener)
  imageLoadListeners.set(src, listeners)

  img.onload = () => {
    const list = imageLoadListeners.get(src) || []
    list.forEach((fn) => fn())
    imageLoadListeners.set(src, [])
  }

  return () => {
    const list = imageLoadListeners.get(src) || []
    imageLoadListeners.set(src, list.filter((fn) => fn !== listener))
  }
}

if (typeof window !== 'undefined') {
  getSpritesheetImage(defaultSheetSrc, () => {})
  getSpritesheetImage(listeningSheetSrc, () => {})
}

const SPEED_FACTORS = {
  slow: 0.5,
  normal: 1,
  fast: 2,
}

/**
 * Custom hook to drive sprite sheet frame stepping based on manifest animations
 */
export function useSpriteAnimation({
  manifest = defaultManifest,
  animation = 'idle',
  loop: propLoop,
  onAnimationEnd,
  speed = 'normal',
}) {
  const baseConfig =
    manifest.animations[animation] ||
    manifest.animations.idle || { frames: [0], fps: 1, loop: true }

  const animConfig = {
    ...baseConfig,
    loop: propLoop !== undefined ? propLoop : baseConfig.loop,
  }

  const [frameIndex, setFrameIndex] = useState(0)

  const animRef = useRef(animConfig)
  const currentAnimationRef = useRef(animation)
  const onEndRef = useRef(onAnimationEnd)
  const frameIndexRef = useRef(0)
  const speedFactorRef = useRef(1)
  const idleBlinkStateRef = useRef({
    openDuration: 3000 + Math.random() * 3000,
    blinkDuration: 120 + Math.random() * 60,
    doubleBlinkPending: false,
    isSecondBlinkOpen: false,
  })

  animRef.current = animConfig
  onEndRef.current = onAnimationEnd
  speedFactorRef.current = SPEED_FACTORS[speed] || 1

  // Reset frame when animation name or manifest changes
  useEffect(() => {
    if (currentAnimationRef.current !== animation) {
      currentAnimationRef.current = animation
      frameIndexRef.current = 0
      setFrameIndex(0)
      if (animation === 'idle') {
        idleBlinkStateRef.current = {
          openDuration: 3000 + Math.random() * 3000,
          blinkDuration: 120 + Math.random() * 60,
          doubleBlinkPending: false,
          isSecondBlinkOpen: false,
        }
      }
    }
  }, [animation, manifest])

  useEffect(() => {
    let animFrameId
    let lastTime = performance.now()
    let accumulated = 0
    const { frames, fps, loop, frameDurations } = animRef.current

    const tick = (now) => {
      accumulated += now - lastTime
      lastTime = now

      const totalFrames = frames.length
      let idx = frameIndexRef.current
      const speedFactor = speedFactorRef.current || 1

      // Drain accumulated time frame-by-frame so no frame is ever skipped
      let safety = 0
      while (safety++ < totalFrames + 1) {
        let rawDuration
        const isTwoFrameIdle = currentAnimationRef.current === 'idle' && totalFrames === 2
        if (isTwoFrameIdle) {
          if (idx === 0) {
            rawDuration = idleBlinkStateRef.current.isSecondBlinkOpen
              ? 120 + Math.random() * 50
              : idleBlinkStateRef.current.openDuration
          } else {
            rawDuration = idleBlinkStateRef.current.blinkDuration
          }
        } else {
          rawDuration = frameDurations
            ? (frameDurations[idx] ?? (1000 / (fps || 1)))
            : (1000 / (fps || 1))
        }
        const duration = rawDuration / speedFactor

        if (accumulated < duration) break

        accumulated -= duration

        const next = idx + 1
        if (next >= totalFrames) {
          if (loop) {
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
            idx = totalFrames - 1
            if (idx !== frameIndexRef.current) {
              frameIndexRef.current = idx
              setFrameIndex(idx)
            }
            onEndRef.current?.(animation)
            return // End of non-looping animation
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
  }, [animation, manifest])

  const safeFrameIndex = Math.min(frameIndex, animConfig.frames.length - 1)
  const currentFrame = animConfig.frames[safeFrameIndex] ?? animConfig.frames[0] ?? 0

  return {
    currentFrame,
    frameIndex: safeFrameIndex,
    animConfig,
    cellWidth: manifest.cellWidth,
    cellHeight: manifest.cellHeight,
    columns: manifest.columns,
    scale: manifest.scale || 1,
  }
}

const eyeShiftCache = new Map()

function getEyeShiftedCanvas(spritesheetSrc, img, cellW, cellH, col, row, dx, dy) {
  if (dx === 0 && dy === 0) return null
  const cacheKey = `${spritesheetSrc}:${col},${row}:${dx},${dy}`
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

  const isListening = spritesheetSrc.includes('listening')
  const eyeBoxes = isListening
    ? [
        { minX: 99, maxX: 122, minY: 204, maxY: 223 },
        { minX: 124, maxX: 142, minY: 204, maxY: 223 },
      ]
    : [
        { minX: 104, maxX: 145, minY: 191, maxY: 219 },
        { minX: 147, maxX: 172, minY: 193, maxY: 219 },
      ]

  const furR = 0x28
  const furG = 0x2c
  const furB = 0x38

  let totalEyePixels = 0

  for (const box of eyeBoxes) {
    const eyePixels = []
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const off = (y * cellW + x) * 4
        const r = data[off]
        const g = data[off + 1]
        const b = data[off + 2]
        const a = data[off + 3]
        const isGreen = g > 60 && g > r * 1.15 && g > b * 1.15
        const isGleam = r > 150 && g > 150 && b < 120
        const isPupil = r < 30 && g < 35 && b < 55
        if (a > 100 && (isGreen || isGleam || isPupil)) {
          eyePixels.push({ x, y, r, g, b, a })
        }
      }
    }

    if (eyePixels.length === 0) continue
    totalEyePixels += eyePixels.length

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
  }

  if (totalEyePixels === 0) {
    eyeShiftCache.set(cacheKey, null)
    return null
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
  spritesheet = defaultSheetSrc,
  scale: propScale,
  className = '',
  style = {},
  onAnimationEnd,
  speed,
  animationSpeed,
  catAnimationSpeed,
  eyeTracking = false,
  cursorOffset = null,
  ...rest
}) {
  const canvasRef = useRef(null)
  const cached = imageCache.get(spritesheet)
  const currentImg = cached?.complete && cached?.naturalWidth > 0 ? cached : null
  const imageRef = useRef(currentImg)
  const [imageLoaded, setImageLoaded] = useState(Boolean(imageRef.current))

  if (currentImg && imageRef.current !== currentImg) {
    imageRef.current = currentImg
  }

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

  const scale = propScale ?? manifest.scale ?? 1
  const cellWidth = manifest.cellWidth
  const cellHeight = manifest.cellHeight
  const columns = manifest.columns
  const displayWidth = Math.round(cellWidth * scale)
  const displayHeight = Math.round(cellHeight * scale)

  const effectiveSpeed = catAnimationSpeed || animationSpeed || speed || 'normal'

  const { currentFrame } = useSpriteAnimation({
    manifest,
    animation,
    loop,
    onAnimationEnd,
    speed: effectiveSpeed,
  })

  // Load / listen to spritesheet
  useEffect(() => {
    return getSpritesheetImage(spritesheet, (img) => {
      imageRef.current = img
      setImageLoaded(true)
    })
  }, [spritesheet])

  // Draw current frame to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img || !imageLoaded) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, displayWidth, displayHeight)
    ctx.imageSmoothingEnabled = false

    const row = Math.floor(currentFrame / columns)
    const col = currentFrame % columns
    const sx = col * cellWidth
    const sy = row * cellHeight

    const shiftedCanvas = (eyeTracking && (eyeDx !== 0 || eyeDy !== 0))
      ? getEyeShiftedCanvas(spritesheet, img, cellWidth, cellHeight, col, row, eyeDx, eyeDy)
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
  }, [currentFrame, imageLoaded, spritesheet, cellWidth, cellHeight, columns, displayWidth, displayHeight, eyeTracking, eyeDx, eyeDy])

  return (
    <canvas
      ref={canvasRef}
      width={displayWidth}
      height={displayHeight}
      className={`sprite-animator ${className}`}
      style={{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
        transform: flipped ? 'scaleX(-1)' : 'none',
        transformOrigin: 'center center',
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  )
}
