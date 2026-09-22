import React, { useCallback, useEffect, useRef, useState } from 'react'
import './Mascot.css'
import SpriteAnimator from './SpriteAnimator'
import listeningManifest from '../assets/cat-sprite/listening-manifest.json'
import listeningSheetSrc from '../assets/cat-sprite/cat_listening_spritesheet.png'

const MARGIN = 16
const SPRITE_WIDTH = 126
const SPRITE_HEIGHT = 180
const FALLBACK_WIDTH = SPRITE_WIDTH
const FALLBACK_HEIGHT = SPRITE_HEIGHT
const SLEEP_AFTER_MS = 2 * 60 * 1000
const SLEEP_CHANCE = 0.4
const IDLE_PAUSE_MIN_MS = 5000
const IDLE_PAUSE_MAX_MS = 15000
const WALK_MIN_MS = 3500
const WALK_MAX_MS = 6500

const REMINDER_MESSAGES = {
  water: {
    title: 'Water Break',
    text: 'Time to hydrate!',
    icon: '💧',
  },
  eyeRest: {
    title: 'Eye Rest',
    text: 'Rest your eyes — look at something 20ft away',
    icon: '👀',
  },
  movementBreak: {
    title: 'Movement Break',
    text: 'Time to get up and move!!',
    icon: '🤸',
  },
  pomodoroWorkEnd: {
    title: 'Pomodoro Done!',
    text: 'Pomodoro complete — take a 5 min break!',
    icon: '🍅',
  },
  pomodoroBreakEnd: {
    title: "Break's Over",
    text: "Break's over — back to work!",
    icon: '💼',
  },
}

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

export default function Mascot({
  reminderState,
  reminderType = 'water',
  pomodoroCelebrating = false,
  timerMode = 'none',
  timerFormatted = '',
  REMINDER_STATE,
  onDismiss,
  mediaPlaying = false,
  mediaArtist = '',
  mediaTitle = '',
  nowPlayingVisible = false,
}) {
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
  const dragTargetRef = useRef({ x, y })
  const savedPosRef = useRef(null)

  poseRef.current = pose
  posRef.current = { x, y }
  draggingRef.current = dragging

  const isReminder =
    reminderState === REMINDER_STATE.ENTRANCE ||
    reminderState === REMINDER_STATE.ACTIVE ||
    reminderState === REMINDER_STATE.EXIT

  const isBigTreatment = isReminder && reminderType === 'movementBreak'

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
    dragTargetRef.current = next
    return next
  }, [])

  const markInteraction = useCallback(() => {
    lastInteractRef.current = Date.now()
    if (poseRef.current === 'sleep') {
      poseRef.current = 'idle'
      setPose('idle')
    }
  }, [])

  // Wake cat from sleep when music starts playing
  useEffect(() => {
    if (mediaPlaying && poseRef.current === 'sleep') {
      poseRef.current = 'idle'
      setPose('idle')
      lastInteractRef.current = Date.now()
    }
  }, [mediaPlaying])

  // ── Drag Spring Physics ──────────────────────────────────────────────────
  useEffect(() => {
    let animationFrameId
    const updateSpring = () => {
      if (draggingRef.current) {
        const target = dragTargetRef.current
        const current = posRef.current

        const dx = target.x - current.x
        const dy = target.y - current.y

        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const next = {
            x: current.x + dx * 0.3,
            y: current.y + dy * 0.3,
          }
          posRef.current = next
          setX(next.x)
          setY(next.y)
        }
      }
      animationFrameId = requestAnimationFrame(updateSpring)
    }
    updateSpring()
    return () => cancelAnimationFrame(animationFrameId)
  }, [])

  // ── Save position and handle center-screen treatment transitions ──────────
  useEffect(() => {
    if (isBigTreatment) {
      if (reminderState === REMINDER_STATE.ENTRANCE) {
        if (!savedPosRef.current) {
          savedPosRef.current = { x: posRef.current.x, y: posRef.current.y }
        }
        setWalkMs(0)
      }
    } else if (reminderState === REMINDER_STATE.IDLE_COUNTING && savedPosRef.current) {
      // Returned from big treatment: resume at saved position
      const saved = savedPosRef.current
      savedPosRef.current = null
      posRef.current = saved
      setX(saved.x)
      setY(saved.y)
      dragTargetRef.current = saved
    }
  }, [reminderState, isBigTreatment, REMINDER_STATE])

  // ── Roaming loop (idle only) ──────────────────────────────────────────────
  useEffect(() => {
    const gen = ++roamGenRef.current
    const timers = []

    const later = (fn, ms) => {
      const id = setTimeout(fn, ms)
      timers.push(id)
    }

    if (isReminder || mediaPlaying) {
      setWalkMs(0)
      if (isReminder) {
        poseRef.current = 'alert'
        setPose('alert')
      } else if (poseRef.current.startsWith('walk')) {
        poseRef.current = 'idle'
        setPose('idle')
      }
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
      if (!mediaPlaying && idleFor >= SLEEP_AFTER_MS && Math.random() < SLEEP_CHANCE) {
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
        dragTargetRef.current = { x: targetX, y: posRef.current.y }
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
  }, [isReminder, roamEpoch, measure, mediaPlaying])

  // ── Keep the cat on-screen if the overlay is resized ──────────────────────
  useEffect(() => {
    const onResize = () => {
      const next = clampToViewport(posRef.current.x, posRef.current.y)
      setX(next.x)
      setY(next.y)
      dragTargetRef.current = next
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampToViewport])

  // ── Drag ──────────────────────────────────────────────────────────────────
  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    if (event.target.closest?.('.mascot-reminder-card')) return

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
    const targetX = event.clientX - dragOffsetRef.current.x
    const targetY = event.clientY - dragOffsetRef.current.y
    dragTargetRef.current = clampToViewport(targetX, targetY)
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

    const finalPos = dragTargetRef.current
    posRef.current = finalPos
    setX(finalPos.x)
    setY(finalPos.y)

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

  const isListening = Boolean(mediaPlaying) && !isReminder && !dragging && !pomodoroCelebrating
  const displayPose = isReminder ? 'alert' : pomodoroCelebrating ? 'jump' : isListening ? 'listening' : pose
  const moving = walkMs > 0 && !dragging && displayPose.startsWith('walk')

  let stateClass = 'is-idle'
  if (moving) stateClass = 'is-walking'
  if (displayPose === 'sleep') stateClass = 'is-sleep'
  if (isListening) stateClass = 'is-listening'

  // Map state machine to sprite animations
  let animationName = 'idle'
  let flipped = false

  if (pomodoroCelebrating) {
    animationName = 'jump'
    flipped = false
  } else if (dragging) {
    animationName = 'drag'
    flipped = false
  } else if (isReminder) {
    animationName = isBigTreatment ? 'stretch' : 'talk'
    flipped = false
  } else if (isListening) {
    animationName = 'listening'
    flipped = false
  } else if (displayPose === 'walk-left') {
    animationName = 'walk'
    flipped = true
  } else if (displayPose === 'walk-right') {
    animationName = 'walk'
    flipped = false
  } else if (displayPose === 'sleep') {
    animationName = 'sleep'
    flipped = false
  } else {
    animationName = 'idle'
    flipped = false
  }

  // ── Coordinates and Transitions for Center-Screen MovementBreak ───────────
  const centerX = Math.max(MARGIN, Math.round((window.innerWidth - SPRITE_WIDTH) / 2))
  const centerY = Math.max(MARGIN, Math.round((window.innerHeight - SPRITE_HEIGHT) / 2))

  let targetX = x
  let targetY = y

  if (isBigTreatment) {
    if (reminderState === REMINDER_STATE.ENTRANCE || reminderState === REMINDER_STATE.ACTIVE) {
      targetX = centerX
      targetY = centerY
    } else if (reminderState === REMINDER_STATE.EXIT) {
      targetX = savedPosRef.current ? savedPosRef.current.x : x
      targetY = savedPosRef.current ? savedPosRef.current.y : y
    }
  }

  let containerTransition = 'transform 0.15s ease-out'
  if (dragging) {
    containerTransition = 'none'
  } else if (moving) {
    containerTransition = `transform ${walkMs}ms linear`
  } else if (isBigTreatment) {
    if (reminderState === REMINDER_STATE.ENTRANCE) {
      containerTransition = 'transform 0.8s cubic-bezier(0.34, 1.2, 0.64, 1)'
    } else if (reminderState === REMINDER_STATE.ACTIVE) {
      containerTransition = 'transform 0.15s ease-out'
    } else if (reminderState === REMINDER_STATE.EXIT) {
      containerTransition = 'transform 0.75s ease-in-out'
    }
  }

  const isScaleBig =
    isBigTreatment &&
    (reminderState === REMINDER_STATE.ENTRANCE || reminderState === REMINDER_STATE.ACTIVE)
  const spriteScale = isScaleBig ? 2 : 1

  let spriteTransition = 'none'
  if (isBigTreatment) {
    if (reminderState === REMINDER_STATE.ENTRANCE) {
      spriteTransition = 'transform 0.8s cubic-bezier(0.34, 1.2, 0.64, 1)'
    } else if (reminderState === REMINDER_STATE.EXIT) {
      spriteTransition = 'transform 0.75s ease-in-out'
    } else if (reminderState === REMINDER_STATE.ACTIVE) {
      spriteTransition = 'transform 0.15s ease-out'
    }
  }

  const isNearTop = targetY < 120
  const reminderInfo = REMINDER_MESSAGES[reminderType] || REMINDER_MESSAGES.water

  return (
    <div
      ref={containerRef}
      className={`mascot-container ${stateClass} ${dragging ? 'is-dragging' : ''} ${isNearTop ? 'is-near-top' : ''}`}
      style={{
        transform: `translate3d(${targetX}px, ${targetY}px, 0)`,
        transition: containerTransition,
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
      <div
        className={`mascot-sprite-wrap${isReminder && !isBigTreatment ? ' is-alert' : ''}`}
        style={{
          transform: `scale(${spriteScale})`,
          transition: spriteTransition,
        }}
      >
        <SpriteAnimator
          animation={isListening ? 'listening' : animationName}
          flipped={flipped}
          loop={true}
          manifest={isListening ? listeningManifest : undefined}
          spritesheet={isListening ? listeningSheetSrc : undefined}
        />
      </div>

      {/* Persistent Timer / Stopwatch indicator near the cat */}
      {timerMode !== 'none' && reminderState !== REMINDER_STATE.ACTIVE && (
        <div className="mascot-timer-badge">
          <span className="mascot-timer-badge__icon">
            {timerMode.startsWith('pomodoro') ? '🍅' : '⏱️'}
          </span>
          <span className="mascot-timer-badge__time">{timerFormatted}</span>
        </div>
      )}

      {/* Now Playing card — shown briefly on track changes, hidden during reminders */}
      {nowPlayingVisible && (mediaTitle || mediaArtist) && !isReminder && (
        <div className="mascot-now-playing">
          <span className="mascot-now-playing__icon">🎵</span>
          <div className="mascot-now-playing__text">
            {mediaTitle && <div className="mascot-now-playing__title">{mediaTitle}</div>}
            {mediaArtist && <div className="mascot-now-playing__artist">{mediaArtist}</div>}
          </div>
        </div>
      )}

      {/* Active Reminder Dismiss Card */}
      {reminderState === REMINDER_STATE.ACTIVE && (
        <div
          className={`mascot-reminder-card ${isBigTreatment ? 'is-big' : 'is-small'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mascot-reminder-card__content">
            <span className="mascot-reminder-card__icon">{reminderInfo.icon}</span>
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__title">{reminderInfo.title}</div>
              <div className="mascot-reminder-card__message">{reminderInfo.text}</div>
            </div>
          </div>
          <button
            className="mascot-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss reminder"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
