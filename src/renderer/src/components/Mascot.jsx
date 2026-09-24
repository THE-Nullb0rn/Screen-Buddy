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

// Idle behavior chances (checked each idle pause between walks)
const TYPING_CHANCE = 0.15       // Increased from 10% to 15%
const TYPING_FAST_ESCALATE = 0.3 // ~30% chance typing escalates to typingfast
const PLAY_CHANCE = 0.10         // Increased from 8% to 10%

// Duration ranges for idle behaviors (ms)
const TYPING_MIN_MS = 4000
const TYPING_MAX_MS = 8000
const TYPING_FAST_MIN_MS = 2000
const TYPING_FAST_MAX_MS = 4000
const PLAY_MIN_MS = 3000
const PLAY_MAX_MS = 6000

// Click vs drag distinction
const CLICK_MAX_DISTANCE = 5     // pixels
const CLICK_MAX_DURATION = 300   // ms

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

// Animations that have a listening-spritesheet equivalent
const LISTENING_ANIMATIONS = ['idle', 'walk', 'talk', 'eat', 'pet', 'typing', 'typingfast', 'play']

export default function Mascot({
  reminderState,
  reminderType = 'water',
  hungerState = 'IDLE',
  onFeed,
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
  
  // Hover state for petting
  const [isHoveringHead, setIsHoveringHead] = useState(false)

  // Walk tween: rAF-driven ease-in-out interpolation
  const walkTweenRef = useRef(null) // { startX, targetX, startTime, duration }

  // Squash & stretch accent class
  const [spriteAccent, setSpriteAccent] = useState(null)
  const spriteWrapRef = useRef(null)
  const accentTimerRef = useRef(null)
  const roamTimeoutRef = useRef(null)
  const blinkTimeoutRef = useRef(null)
  const justDroppedRef = useRef(false)

  // Idle behavior timeout ref
  const idleBehaviorTimeoutRef = useRef(null)
  
  // Click detection refs
  const pointerDownInfoRef = useRef(null) // { x, y, time }

  const triggerAccent = useCallback((cls) => {
    clearTimeout(accentTimerRef.current)
    setSpriteAccent(null)
    // Double-rAF ensures the class removal flushes before re-adding (forces restart)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpriteAccent(cls)
        accentTimerRef.current = setTimeout(() => setSpriteAccent(null), 250)
      })
    })
  }, [])
  const triggerAccentRef = useRef(triggerAccent)
  triggerAccentRef.current = triggerAccent

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

  // ── Helper: start an idle behavior pose for a duration, then return to idle ──
  const startIdleBehavior = useCallback((behaviorPose, durationMs) => {
    clearTimeout(idleBehaviorTimeoutRef.current)
    poseRef.current = behaviorPose
    setPose(behaviorPose)
    idleBehaviorTimeoutRef.current = setTimeout(() => {
      // Only revert if still in the behavior pose (wasn't interrupted)
      if (poseRef.current === behaviorPose) {
        poseRef.current = 'idle'
        setPose('idle')
      }
    }, durationMs)
  }, [])

  const handleFeedTrigger = useCallback(() => {
    if (hungerState === 'ACTIVE') {
      if (onFeed) onFeed()
      // Interrupt whatever it was doing to eat
      walkTweenRef.current = null
      setWalkMs(0)
      clearTimeout(roamTimeoutRef.current)
      clearTimeout(idleBehaviorTimeoutRef.current)
      setIsHoveringHead(false)
      startIdleBehavior('eat', 900)
    }
  }, [hungerState, onFeed, startIdleBehavior])

  // Wake cat from sleep when music starts playing
  useEffect(() => {
    if (mediaPlaying && poseRef.current === 'sleep') {
      poseRef.current = 'idle'
      setPose('idle')
      lastInteractRef.current = Date.now()
    }
  }, [mediaPlaying])

  // Squash on jump/pomodoro celebration landing
  const prevCelebratingRef = useRef(pomodoroCelebrating)
  useEffect(() => {
    if (prevCelebratingRef.current && !pomodoroCelebrating) {
      triggerAccent('is-squash')
    }
    prevCelebratingRef.current = pomodoroCelebrating
  }, [pomodoroCelebrating, triggerAccent])

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

  // ── Walk Tween (rAF ease-in-out) ─────────────────────────────────────────
  useEffect(() => {
    let rafId
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

    const step = (now) => {
      const tween = walkTweenRef.current
      if (tween && !draggingRef.current) {
        const elapsed = now - tween.startTime
        const t = Math.min(1, elapsed / tween.duration)
        const eased = easeInOut(t)
        const newX = tween.startX + (tween.targetX - tween.startX) * eased
        posRef.current = { x: newX, y: posRef.current.y }
        setX(newX)
        if (t >= 1) {
          walkTweenRef.current = null
        }
      }
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafId)
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

    const later = (fn, ms) => {
      roamTimeoutRef.current = setTimeout(fn, ms)
    }

    if (isReminder || pomodoroCelebrating) {
      walkTweenRef.current = null
      clearTimeout(roamTimeoutRef.current)
      clearTimeout(idleBehaviorTimeoutRef.current)
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
        clearTimeout(roamTimeoutRef.current)
        clearTimeout(idleBehaviorTimeoutRef.current)
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
      // Don't interrupt active idle behaviors (eat, pet, typing, play)
      if (['eat', 'pet', 'typing', 'typingfast', 'play'].includes(poseRef.current)) {
        later(walkOnce, 1000)
        return
      }

      const idleFor = Date.now() - lastInteractRef.current
      if (idleFor >= SLEEP_AFTER_MS && Math.random() < SLEEP_CHANCE) {
        setWalkMs(0)
        poseRef.current = 'sleep'
        setPose('sleep')
        return
      }

      // ── Random idle behaviors before walking ──
      // Roll for a random behavior instead of walking sometimes
      const roll = Math.random()
      let triggeredBehavior = 'walk'
      if (roll < TYPING_CHANCE) triggeredBehavior = 'typing'
      else if (roll < TYPING_CHANCE + PLAY_CHANCE) triggeredBehavior = 'play'

      if (process.env.NODE_ENV === 'development') {
        console.log(`[Mascot] Idle roll: ${roll.toFixed(3)} -> Action: ${triggeredBehavior} (Thresholds: Type <${TYPING_CHANCE}, Play <${(TYPING_CHANCE + PLAY_CHANCE).toFixed(2)})`)
      }

      if (triggeredBehavior === 'typing') {
        // Typing: sustained for a few seconds, may escalate to typingfast
        const typingDuration = randBetween(TYPING_MIN_MS, TYPING_MAX_MS)
        startIdleBehavior('typing', typingDuration)

        // Maybe escalate to fast typing partway through
        if (Math.random() < TYPING_FAST_ESCALATE) {
          const escalateAfter = typingDuration * 0.5
          const fastDuration = randBetween(TYPING_FAST_MIN_MS, TYPING_FAST_MAX_MS)
          setTimeout(() => {
            if (gen !== roamGenRef.current) return
            if (poseRef.current === 'typing') {
              startIdleBehavior('typingfast', fastDuration)
            }
          }, escalateAfter)
        }

        later(walkOnce, randBetween(IDLE_PAUSE_MIN_MS, IDLE_PAUSE_MAX_MS))
        return
      }
      if (triggeredBehavior === 'play') {
        // Play: cat bats its paws for a few seconds
        const playDuration = randBetween(PLAY_MIN_MS, PLAY_MAX_MS)
        startIdleBehavior('play', playDuration)
        later(walkOnce, randBetween(IDLE_PAUSE_MIN_MS, IDLE_PAUSE_MAX_MS))
        return
      }

      // ── Normal walk ──
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

      // Stretch: body-gather moment as the walk leg launches
      triggerAccentRef.current('is-stretch')

      // Kick off the rAF-driven ease-in-out tween
      walkTweenRef.current = {
        startX: posRef.current.x,
        targetX,
        startTime: performance.now(),
        duration,
      }
      dragTargetRef.current = { x: targetX, y: posRef.current.y }

      later(() => {
        if (gen !== roamGenRef.current) return
        walkTweenRef.current = null
        setWalkMs(0)
        if (poseRef.current.startsWith('walk')) {
          poseRef.current = 'idle'
          setPose('idle')
        }
        // Squash: landing accent when arriving at destination
        triggerAccentRef.current('is-squash')
        later(walkOnce, randBetween(IDLE_PAUSE_MIN_MS, IDLE_PAUSE_MAX_MS))
      }, duration + 40)
    }

    const initialDelay = justDroppedRef.current ? randBetween(5000, 6000) : randBetween(2500, 6000)
    justDroppedRef.current = false
    later(walkOnce, initialDelay)

    return () => {
      roamGenRef.current += 1
      clearTimeout(roamTimeoutRef.current)
      clearTimeout(idleBehaviorTimeoutRef.current)
    }
  }, [isReminder, roamEpoch, measure, pomodoroCelebrating, startIdleBehavior])

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

  // ── Idle secondary motion (blink / tail-flick stand-in) ───────────────────
  useEffect(() => {
    if (dragging) return
    const scheduleNext = () => {
      const delay = randBetween(8000, 15000)
      blinkTimeoutRef.current = setTimeout(() => {
        const isIdleNow =
          !draggingRef.current &&
          poseRef.current === 'idle' &&
          !isReminder

        if (isIdleNow) {
          // 55% chance to actually blink, otherwise silently skip to make it less metronomic
          if (Math.random() > 0.45) {
            triggerAccentRef.current('is-blink')
          }
        }
        scheduleNext()
      }, delay)
    }
    scheduleNext()
    return () => clearTimeout(blinkTimeoutRef.current)
  }, [isReminder, dragging])

  // ── Drag & Click Handling ─────────────────────────────────────────────────
  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    if (event.target.closest?.('.mascot-reminder-card')) return

    // Record down info to distinguish click from drag
    pointerDownInfoRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
    }

    walkTweenRef.current = null
    clearTimeout(roamTimeoutRef.current)
    clearTimeout(blinkTimeoutRef.current)
    clearTimeout(accentTimerRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)

    roamGenRef.current += 1
    setWalkMs(0)
    poseRef.current = 'idle'
    setPose('idle')
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

    // ── Click detection: was this a click (not a drag)? ──
    const downInfo = pointerDownInfoRef.current
    if (downInfo) {
      const dx = Math.abs(event.clientX - downInfo.x)
      const dy = Math.abs(event.clientY - downInfo.y)
      const elapsed = Date.now() - downInfo.time
      const isClick = dx <= CLICK_MAX_DISTANCE && dy <= CLICK_MAX_DISTANCE && elapsed <= CLICK_MAX_DURATION

      if (isClick && hungerState === 'ACTIVE') {
        pointerDownInfoRef.current = null
        handleFeedTrigger()
        return
      }
      pointerDownInfoRef.current = null
    }

    triggerAccent('is-squash')

    if (!isReminder) {
      justDroppedRef.current = true
      setRoamEpoch((n) => n + 1)
    }
  }

  // ── Hitbox Hover (Pet) ────────────────────────────────────────────────────
  const handleHeadPointerEnter = () => {
    if (draggingRef.current || isReminder || pomodoroCelebrating) return
    // Cancel walks and other idle behaviors while being pet
    walkTweenRef.current = null
    setWalkMs(0)
    clearTimeout(roamTimeoutRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)
    setIsHoveringHead(true)
  }

  const handleHeadPointerLeave = () => {
    if (isHoveringHead) {
      setIsHoveringHead(false)
      // Resume normal idle cycle
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

  let currentPose = pose
  if (isHoveringHead && !dragging && !isReminder && !pomodoroCelebrating) {
    currentPose = 'pet'
  }

  const displayPose = isReminder ? 'alert' : pomodoroCelebrating ? 'jump' : currentPose
  const moving = walkMs > 0 && !dragging && displayPose.startsWith('walk')

  let stateClass = 'is-idle'
  if (moving) stateClass = 'is-walking'
  if (displayPose === 'sleep') stateClass = 'is-sleep'
  if (mediaPlaying && !isReminder && !dragging && !pomodoroCelebrating) stateClass = 'is-listening'

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
  } else if (displayPose === 'walk-left') {
    animationName = 'walk'
    flipped = true
  } else if (displayPose === 'walk-right') {
    animationName = 'walk'
    flipped = false
  } else if (displayPose === 'sleep') {
    animationName = 'sleep'
    flipped = false
  } else if (displayPose === 'eat') {
    animationName = 'eat'
    flipped = false
  } else if (displayPose === 'pet') {
    animationName = 'pet'
    flipped = false
  } else if (displayPose === 'typing') {
    animationName = 'typing'
    flipped = false
  } else if (displayPose === 'typingfast') {
    animationName = 'typingfast'
    flipped = false
  } else if (displayPose === 'play') {
    animationName = 'play'
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
    containerTransition = 'none' // rAF tween drives position directly
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

  // Determine whether to use the listening spritesheet
  const useListening = mediaPlaying && !isReminder && !dragging && !pomodoroCelebrating && LISTENING_ANIMATIONS.includes(animationName)

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
        ref={spriteWrapRef}
        className={[
          'mascot-sprite-wrap',
          isReminder && !isBigTreatment ? 'is-alert' : '',
          spriteAccent || '',
        ].filter(Boolean).join(' ')}
        style={{
          transform: `scale(${spriteScale})`,
          transition: spriteTransition,
          position: 'relative' // Added to position the hitbox correctly
        }}
      >
        {/* Hover hit-box over the cat's head for petting */}
        <div
          className="mascot-head-hitbox"
          style={{
            position: 'absolute',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '45%',
            height: '40%',
            zIndex: 10,
          }}
          onPointerEnter={handleHeadPointerEnter}
          onPointerLeave={handleHeadPointerLeave}
          title="Pet me!"
        />
        <SpriteAnimator
          animation={animationName}
          flipped={flipped}
          loop={true}
          manifest={useListening ? listeningManifest : undefined}
          spritesheet={useListening ? listeningSheetSrc : undefined}
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

      {/* Active Hunger Card (hidden if a regular reminder is active to prevent overlapping cards) */}
      {hungerState === 'ACTIVE' && reminderState !== REMINDER_STATE.ACTIVE && (
        <div
          className="mascot-reminder-card is-small"
          onClick={(e) => {
            e.stopPropagation()
            handleFeedTrigger()
          }}
        >
          <div className="mascot-reminder-card__content">
            <span className="mascot-reminder-card__icon">🐟</span>
            <div className="mascot-reminder-card__text-wrap">
              <div className="mascot-reminder-card__title">Hungry!</div>
              <div className="mascot-reminder-card__message">Time to eat.</div>
            </div>
          </div>
          <button
            className="mascot-dismiss"
            onClick={(e) => {
              e.stopPropagation()
              handleFeedTrigger()
            }}
            aria-label="Feed cat"
          >
            ✕
          </button>
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
