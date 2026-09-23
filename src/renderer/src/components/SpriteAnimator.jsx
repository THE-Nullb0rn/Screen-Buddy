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

/**
 * Custom hook to drive sprite sheet frame stepping based on manifest animations
 */
export function useSpriteAnimation({
  manifest = defaultManifest,
  animation = 'idle',
  loop: propLoop,
  onAnimationEnd,
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

  animRef.current = animConfig
  onEndRef.current = onAnimationEnd

  // Reset frame when animation name or manifest changes
  useEffect(() => {
    if (currentAnimationRef.current !== animation) {
      currentAnimationRef.current = animation
      frameIndexRef.current = 0
      setFrameIndex(0)
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

      // Drain accumulated time frame-by-frame so no frame is ever skipped
      let safety = 0
      while (safety++ < totalFrames + 1) {
        const duration = frameDurations
          ? (frameDurations[idx] ?? (1000 / (fps || 1)))
          : (1000 / (fps || 1))

        if (accumulated < duration) break

        accumulated -= duration

        const next = idx + 1
        if (next >= totalFrames) {
          if (loop) {
            idx = 0
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

  const scale = propScale ?? manifest.scale ?? 1
  const cellWidth = manifest.cellWidth
  const cellHeight = manifest.cellHeight
  const columns = manifest.columns
  const displayWidth = Math.round(cellWidth * scale)
  const displayHeight = Math.round(cellHeight * scale)

  const { currentFrame } = useSpriteAnimation({
    manifest,
    animation,
    loop,
    onAnimationEnd,
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
  }, [currentFrame, imageLoaded, spritesheet, cellWidth, cellHeight, columns, displayWidth, displayHeight])

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
