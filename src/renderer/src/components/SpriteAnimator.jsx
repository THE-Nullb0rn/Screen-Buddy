import React, { useEffect, useRef, useState } from 'react'
import defaultManifest from '../assets/cat-sprite/manifest.json'
import defaultSheetSrc from '../assets/cat-sprite/spritesheet.png'
import './SpriteAnimator.css'

// Shared image cache to avoid re-decoding across re-renders/mounts
let cachedImage = null
let cachedImageSrc = null
let imageLoadListeners = []

if (typeof window !== 'undefined') {
  cachedImage = new Image()
  cachedImageSrc = defaultSheetSrc
  cachedImage.src = defaultSheetSrc
}

function getSpritesheetImage(src, onLoaded) {
  if (cachedImage && cachedImageSrc === src && cachedImage.complete && cachedImage.naturalWidth > 0) {
    onLoaded(cachedImage)
    return () => {}
  }

  if (!cachedImage || cachedImageSrc !== src) {
    cachedImage = new Image()
    cachedImageSrc = src
    imageLoadListeners = []
    cachedImage.src = src
  }

  const listener = () => onLoaded(cachedImage)
  if (cachedImage.complete && cachedImage.naturalWidth > 0) {
    listener()
    return () => {}
  }

  imageLoadListeners.push(listener)
  cachedImage.onload = () => {
    imageLoadListeners.forEach((fn) => fn())
    imageLoadListeners = []
  }

  return () => {
    imageLoadListeners = imageLoadListeners.filter((fn) => fn !== listener)
  }
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

  // Reset frame when animation name changes
  useEffect(() => {
    if (currentAnimationRef.current !== animation) {
      currentAnimationRef.current = animation
      frameIndexRef.current = 0
      setFrameIndex(0)
    }
  }, [animation])

  useEffect(() => {
    let animFrameId
    let lastTime = performance.now()
    const { frames, fps, loop } = animRef.current
    const frameInterval = 1000 / (fps || 1)

    const tick = (now) => {
      const elapsed = now - lastTime
      if (elapsed >= frameInterval) {
        const advance = Math.floor(elapsed / frameInterval)
        lastTime = now - (elapsed % frameInterval)

        const totalFrames = frames.length
        let next = frameIndexRef.current + advance

        if (loop) {
          next = next % totalFrames
          if (next !== frameIndexRef.current) {
            frameIndexRef.current = next
            setFrameIndex(next)
          }
        } else {
          if (next >= totalFrames - 1) {
            next = totalFrames - 1
            if (next !== frameIndexRef.current) {
              frameIndexRef.current = next
              setFrameIndex(next)
            }
            onEndRef.current?.(animation)
            return // Reached end of non-looping animation
          } else if (next !== frameIndexRef.current) {
            frameIndexRef.current = next
            setFrameIndex(next)
          }
        }
      }
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameId)
  }, [animation])

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
  const imageRef = useRef(cachedImage?.complete && cachedImage?.naturalWidth > 0 ? cachedImage : null)
  const [imageLoaded, setImageLoaded] = useState(Boolean(imageRef.current))

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
  }, [currentFrame, imageLoaded, cellWidth, cellHeight, columns, displayWidth, displayHeight])

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
