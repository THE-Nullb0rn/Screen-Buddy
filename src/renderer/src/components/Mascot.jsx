/**
 * screen-buddy — animated cat mascot
 *
 * Renders the current pose sprite, roams along the bottom while the reminder
 * timer is idle, switches to alert when a reminder fires, and can be dragged
 * to a new spot (which pauses roaming until the pointer is released).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import CatCanvas from './CatCanvas'
import './Mascot.css'

const MARGIN = 16
const FALLBACK_WIDTH = 220
const FALLBACK_HEIGHT = 148
const SLEEP_AFTER_MS = 2 * 60 * 1000
const SLEEP_CHANCE = 0.4
const IDLE_PAUSE_MIN_MS = 5000
const IDLE_PAUSE_MAX_MS = 15000
const WALK_MIN_MS = 3500
const WALK_MAX_MS = 6500

function randBetween(min, max) {
  return min + Math.random() * (max - min)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function defaultPosition() {
  return {
    x: Math.max(MARGIN, window.innerWidth - FALLBACK_WIDTH - 48),
    y: Math.max(MARGIN, window.innerHeight - FALLBACK_HEIGHT - 48),
  }
}

export default function Mascot({ reminderState, REMINDER_STATE, onDismiss }) {
  const containerRef = useRef(null)

  const [pose, setPose] = useState('idle')
  const [x, setX] = useState(() => defaultPosition().x)
  const [y, setY] = useState(() => defaultPosition().y)
  const [walkMs, setWalkMs] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [roamEpoch, setRoamEpoch] = useState(0)

  const poseRef = useRef(pose)
  const posRef = useRef({ x, y })
  const draggingRef = useRef(false)
  const lastInteractRef = useRef(Date.now())
  const roamGenRef = useRef(0)
  const dragOffsetRef = useRef({ x: 0, y: 0 })

  poseRef.current = pose
  posRef.current = { x, y }
  draggingRef.current = dragging

  const isReminder =
    reminderState === REMINDER_STATE.ENTRANCE ||
    reminderState === REMINDER_STATE.ACTIVE ||
    reminderState === REMINDER_STATE.EXIT

  const measure = useCallback(() => {
    const el = containerRef.current
    return {
      width: el?.offsetWidth || FALLBACK_WIDTH,
      height: el?.offsetHeight || FALLBACK_HEIGHT,
    }
  }, [])

  const clampToViewport = useCallback(
    (nx, ny) => {
      const { width, height } = measure()
      return {
        x: clamp(nx, MARGIN, Math.max(MARGIN, window.innerWidth - width - MARGIN)),
        y: clamp(ny, MARGIN, Math.max(MARGIN, window.innerHeight - height - MARGIN)),
      }
    },
    [measure]
  )

  const snapVisualPosition = useCallback(() => {
    const el = containerRef.current
    if (!el) return posRef.current
    const rect = el.getBoundingClientRect()
    const next = { x: rect.left, y: rect.top }
    posRef.current = next
    setX(next.x)
    setY(next.y)
    return next
  }, [])

  const markInteraction = useCallback(() => {
    lastInteractRef.current = Date.now()
    if (poseRef.current === 'sleep') {
      poseRef.current = 'idle'
      setPose('idle')
    }
  }, [])

  // ── Roaming loop (idle only) ──────────────────────────────────────────────
  useEffect(() => {
    const gen = ++roamGenRef.current
    const timers = []

    const later = (fn, ms) => {
      const id = setTimeout(fn, ms)
      timers.push(id)
    }

    if (isReminder) {
      setWalkMs(0)
      poseRef.current = 'alert'
      setPose('alert')
      return () => {
        roamGenRef.current += 1
        timers.forEach(clearTimeout)
      }
    }

    if (poseRef.current === 'alert') {
      poseRef.current = 'idle'
      setPose('idle')
    }
    lastInteractRef.current = Date.now()

    const walkOnce = () => {
      if (gen !== roamGenRef.current) return
      if (draggingRef.current) {
        later(walkOnce, 400)
        return
      }
      if (poseRef.current === 'sleep') return

      const idleFor = Date.now() - lastInteractRef.current
      if (idleFor >= SLEEP_AFTER_MS && Math.random() < SLEEP_CHANCE) {
        setWalkMs(0)
        poseRef.current = 'sleep'
        setPose('sleep')
        return
      }

      const { width } = measure()
      const minX = MARGIN
      const maxX = Math.max(minX, window.innerWidth - width - MARGIN)
      const currentX = posRef.current.x
      let dir = Math.random() < 0.5 ? 'left' : 'right'
      if (currentX <= minX + 24) dir = 'right'
      if (currentX >= maxX - 24) dir = 'left'

      const span = Math.max(80, (maxX - minX) * 0.4)
      const distance = randBetween(span * 0.45, span)
      const targetX = clamp(
        dir === 'left' ? currentX - distance : currentX + distance,
        minX,
        maxX
      )
      const duration = randBetween(WALK_MIN_MS, WALK_MAX_MS)

      poseRef.current = dir === 'left' ? 'walk-left' : 'walk-right'
      setPose(poseRef.current)
      setWalkMs(duration)

      requestAnimationFrame(() => {
        if (gen !== roamGenRef.current) return
        setX(targetX)
      })

      later(() => {
        if (gen !== roamGenRef.current) return
        setWalkMs(0)
        if (poseRef.current.startsWith('walk')) {
          poseRef.current = 'idle'
          setPose('idle')
        }
        later(walkOnce, randBetween(IDLE_PAUSE_MIN_MS, IDLE_PAUSE_MAX_MS))
      }, duration + 40)
    }

    later(walkOnce, randBetween(2500, 6000))

    return () => {
      roamGenRef.current += 1
      timers.forEach(clearTimeout)
    }
  }, [isReminder, roamEpoch, measure])

  // ── Keep the cat on-screen if the overlay is resized ──────────────────────
  useEffect(() => {
    const onResize = () => {
      const next = clampToViewport(posRef.current.x, posRef.current.y)
      setX(next.x)
      setY(next.y)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampToViewport])

  // ── Drag ──────────────────────────────────────────────────────────────────
  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    if (event.target.closest?.('.mascot-dismiss')) return

    roamGenRef.current += 1
    setWalkMs(0)
    snapVisualPosition()
    markInteraction()

    const rect = containerRef.current.getBoundingClientRect()
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    draggingRef.current = true
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event) => {
    if (!draggingRef.current) return
    const next = clampToViewport(
      event.clientX - dragOffsetRef.current.x,
      event.clientY - dragOffsetRef.current.y
    )
    posRef.current = next
    setX(next.x)
    setY(next.y)
  }

  const handlePointerUp = (event) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    lastInteractRef.current = Date.now()
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // capture may already be released
    }
    if (!isReminder) {
      setRoamEpoch((n) => n + 1)
    }
  }

  const handleMouseEnter = () => window.api.mouseEnterInteractive()
  const handleMouseLeave = () => {
    if (draggingRef.current) return
    window.api.mouseLeaveInteractive()
  }

  useEffect(() => {
    return () => {
      window.api.mouseLeaveInteractive()
    }
  }, [])

  const displayPose = isReminder ? 'alert' : pose
  const moving = walkMs > 0 && !dragging && displayPose.startsWith('walk')

  return (
    <div
      ref={containerRef}
      className={`mascot-container${dragging ? ' is-dragging' : ''}${moving ? ' is-walking' : ''}`}
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        transition: moving ? `transform ${walkMs}ms linear` : 'none',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="img"
      aria-label={`screen-buddy, ${displayPose}`}
    >
      <div className={`mascot-sprite-wrap${isReminder ? ' is-alert' : ''}`}>
        <CatCanvas pose={displayPose} />
      </div>

      {reminderState === REMINDER_STATE.ACTIVE && (
        <button
          className="mascot-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss reminder"
        >
          ✕
        </button>
      )}
    </div>
  )
}
