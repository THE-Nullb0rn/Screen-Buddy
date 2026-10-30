import React, { useCallback, useEffect, useRef, useState } from 'react'
import './Mascot.css'
import SpriteAnimator from './SpriteAnimator'
import listeningManifest from '../assets/cat-sprite/listening-manifest.json'
import listeningSheetSrc from '../assets/cat-sprite/cat_listening_spritesheet.png'

const MARGIN = 16
const SPRITE_WIDTH = 126
const SPRITE_HEIGHT = 180
const FLOOR_GAP_PX = 24
const FOOT_PAD_PX = 5

// NORMAL_CAT_CY = window height (128) − CSS bottom inset (8, must match Mascot.css) − sprite half-height (90).
// main.js has a copy that must change with this. The 8 must match Mascot.css `bottom: 8px`.
export const NORMAL_WIN_H = 128
export const NORMAL_BOTTOM_INSET_PX = 8
export const NORMAL_CAT_CX = 80
export const NORMAL_CAT_CY = NORMAL_WIN_H - NORMAL_BOTTOM_INSET_PX - SPRITE_HEIGHT / 2 // 128 - 8 - 90 = 30
export const TREATMENT_CAT_CX = 175
export const TREATMENT_CAT_CY = 192
const FALLBACK_WIDTH = SPRITE_WIDTH
const FALLBACK_HEIGHT = SPRITE_HEIGHT
const SLEEP_AFTER_MS = 2 * 60 * 1000
const SLEEP_CHANCE = 0.4
const IDLE_PAUSE_MIN_MS = 5000
const IDLE_PAUSE_MAX_MS = 15000
const WALK_MIN_MS = 3500
const WALK_MAX_MS = 6500
const EAT_DURATION_MS = 6000

// Idle behavior chances (checked each idle pause between walks)
const PLAY_CHANCE = 0.15         // Increased to compensate for removed typing roll

// Duration ranges for idle behaviors (ms)
const PLAY_MIN_MS = 3000
const PLAY_MAX_MS = 6000

// Click vs drag distinction
const CLICK_MAX_DISTANCE = 5     // pixels
const CLICK_MAX_DURATION = 300   // ms


function randBetween(min, max) {
  return min + Math.random() * (max - min)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function defaultPosition() {
  const sw = window.screen.availWidth || window.screen.width || 1920
  const sh = window.screen.availHeight || window.screen.height || 1080
  return {
    x: Math.max(MARGIN, sw - FALLBACK_WIDTH - 48),
    y: Math.max(MARGIN, sh - FALLBACK_HEIGHT - 48),
  }
}

// Animations that have a listening-spritesheet equivalent
const LISTENING_ANIMATIONS = ['idle', 'walk', 'talk', 'eat', 'pet', 'typing', 'typingfast', 'play']

const DRAG_BUTTON_MAP = {
  left: 0,
  middle: 1,
  right: 2,
}
const BUTTON_MASK = {
  0: 1, // left
  1: 4, // middle
  2: 2, // right
}

export default function Mascot({
  reminderState,
  reminderType = 'water',
  hungerState = 'IDLE',
  onFeed,
  feedSignal = 0,
  hungerBehavior = 'search-food',
  pomodoroCelebrating = false,
  REMINDER_STATE,
  mediaPlaying = false,
  chatState = 'idle',
  chatReply = '',
  onChatSend,
  onChatDismiss,
  onChatActivity,
  onChatOpen,
  clickToInteract = true,
  dragBehavior = true,
  dragButton = 'right',
  leftClickAction = 'react',
  rightClickAction = 'none',
  doubleClickAction = 'chat',
  rightDoubleClickAction = 'settings',
  onTogglePause,
  notificationVisible = false,
  // Coordinates are the global cat centre; App converts the persisted
  // BrowserWindow top-left position before passing this value.
  initialPosition = null,
  onSleepChange,
  catOpacity = 100,
  catAnimationSpeed = 'normal',
  mouseReaction = false,
  paused = false,
  reminderCatAnimation = true,
  animationFps = 60,
  reduceResourceUsage = false,
}) {
  const containerRef = useRef(null)
  
  const clampedOpacity = Math.min(
    100,
    Math.max(20, typeof catOpacity === 'number' ? catOpacity : 100)
  )
  const effectiveOpacity = clampedOpacity / 100
  const effectiveFps = reduceResourceUsage ? 30 : (animationFps || 60)
  

  const [cursorOffset, setCursorOffset] = useState(null)
  const [pose, setPose] = useState('idle')
  const [x, setX] = useState(() => Number.isFinite(initialPosition?.x) ? initialPosition.x : defaultPosition().x)
  const [y, setY] = useState(() => Number.isFinite(initialPosition?.y) ? initialPosition.y : defaultPosition().y)
  const [walkMs, setWalkMs] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [treatmentWindowReady, setTreatmentWindowReady] = useState(false)
  const [falling, setFalling] = useState(false)
  const fallRafRef = useRef(null)
  const fallVelocityRef = useRef(0)
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
  const justDroppedRef = useRef(false)

  // Idle behavior timeout ref
  const idleBehaviorTimeoutRef = useRef(null)
  const eatTimeoutRef = useRef(null)
  
  // Typing event tracking for real typing detection
  const typingEventsRef = useRef([])

  // Interaction & drag tracking refs
  const buttonPointersRef = useRef({ 0: null, 1: null, 2: null })
  const lastLeftClickRef = useRef({ time: 0, x: 0, y: 0 })
  const leftClickTimerRef = useRef(null)
  const lastRightClickRef = useRef({ time: 0, x: 0, y: 0 })
  const rightClickTimerRef = useRef(null)
  const isStartingDragRef = useRef(false)
  const dragStartedRef = useRef(false)
  const strokeTrackingRef = useRef({ currentDir: 0, apexX: 0, reversals: [] })
  const petLeaveTimeoutRef = useRef(null)

  const targetDragButton = DRAG_BUTTON_MAP[dragButton] ?? 2

  useEffect(() => {
    clearTimeout(leftClickTimerRef.current)
    clearTimeout(rightClickTimerRef.current)
    leftClickTimerRef.current = null
    rightClickTimerRef.current = null
  }, [clickToInteract, dragBehavior, dragButton, leftClickAction, rightClickAction, doubleClickAction, rightDoubleClickAction])

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
  const lastSentMoveRef = useRef({ x: -1, y: -1 })
  const dragPointerDownRef = useRef(false)
  const lastDragPointerRef = useRef(null)
  const dragExpandingRef = useRef(false)
  const dragEndingRef = useRef(false)
  const dragPointerIdRef = useRef(null)

  const mediaPlayingRef = useRef(mediaPlaying)
  useEffect(() => {
    mediaPlayingRef.current = mediaPlaying
  }, [mediaPlaying])

  poseRef.current = pose
  if (!draggingRef.current && !dragPointerDownRef.current) {
    posRef.current = { x, y }
  }

  const isReminder =
    reminderState === REMINDER_STATE.ENTRANCE ||
    reminderState === REMINDER_STATE.ACTIVE ||
    reminderState === REMINDER_STATE.EXIT

  const isBigTreatment = isReminder && (reminderCatAnimation !== false) && reminderType === 'movementBreak'

  const isEating = pose === 'eat'
  const isRoamBlocked = Boolean(
    isReminder ||
    pomodoroCelebrating ||
    chatState !== 'idle' ||
    notificationVisible ||
    (hungerState === 'ACTIVE' && hungerBehavior === 'sit') ||
    isEating
  )
  const roamBlockedRef = useRef(isRoamBlocked)
  roamBlockedRef.current = isRoamBlocked

  const measure = useCallback(() => ({
    width: SPRITE_WIDTH,    // always the sprite, never the container
    height: SPRITE_HEIGHT,  // bubbles must not affect floor math
  }), [])

  const clampToViewport = useCallback(
    (nx, ny) => {
      const screenW = window.screen.availWidth || window.screen.width || 1920
      const screenH = window.screen.availHeight || window.screen.height || 1080
      const minX = NORMAL_CAT_CX
      const maxX = Math.max(minX, screenW - 160 + NORMAL_CAT_CX)
      const minY = NORMAL_CAT_CY
      const maxY = Math.max(minY, screenH - (SPRITE_HEIGHT / 2) - FLOOR_GAP_PX + FOOT_PAD_PX)
      return {
        x: clamp(nx, minX, maxX),
        y: clamp(ny, minY, maxY),
      }
    },
    []
  )

  const snapVisualPosition = useCallback(() => {
    // The window is physically moved now; we don't need to read DOM rects.
    // posRef already perfectly tracks the physical screen position.
    return posRef.current
  }, [])

  const wakeUp = useCallback(() => {
    lastInteractRef.current = Date.now()
    if (poseRef.current === 'sleep') {
      poseRef.current = 'idle'
      setPose('idle')
    }
  }, [])

  const markInteraction = useCallback(() => {
    wakeUp()
  }, [wakeUp])

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

  const startEating = useCallback(() => {
    wakeUp()
    // Interrupt whatever it was doing to eat
    walkTweenRef.current = null
    setWalkMs(0)
    clearTimeout(roamTimeoutRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)
    clearTimeout(eatTimeoutRef.current)
    setIsHoveringHead(false)
    poseRef.current = 'eat'
    setPose('eat')
    eatTimeoutRef.current = setTimeout(() => {
      if (poseRef.current === 'eat') {
        poseRef.current = 'idle'
        setPose('idle')
      }
      eatTimeoutRef.current = null
    }, EAT_DURATION_MS)
  }, [wakeUp])

  const handleFeedTrigger = useCallback(() => {
    if (hungerState === 'ACTIVE') {
      if (onFeed) onFeed()
      startEating()
    }
  }, [hungerState, onFeed, startEating])

  const executeAction = useCallback((action) => {
    switch (action) {
      case 'react':
        if (poseRef.current === 'sleep') {
          wakeUp()
          setRoamEpoch((n) => n + 1)
        } else if (hungerState === 'ACTIVE') {
          handleFeedTrigger()
        } else {
          triggerAccentRef.current('is-stretch')
        }
        break
      case 'chat':
        if (onChatOpen) onChatOpen()
        break
      case 'settings':
        if (window.api?.openSettings) window.api.openSettings()
        break
      case 'pause':
        if (onTogglePause) onTogglePause()
        break
      case 'none':
      default:
        break
    }
  }, [hungerState, handleFeedTrigger, onChatOpen, onTogglePause, wakeUp])

  const prevFeedSignalRef = useRef(feedSignal)
  useEffect(() => {
    if (prevFeedSignalRef.current !== feedSignal) {
      prevFeedSignalRef.current = feedSignal
      startEating()
    }
  }, [feedSignal, startEating])

  // Wake cat from sleep when music starts playing
  useEffect(() => {
    if (mediaPlaying) {
      wakeUp()
    }
  }, [mediaPlaying, wakeUp])

  const isAsleep = pose === 'sleep'
  useEffect(() => {
    onSleepChange?.(isAsleep)
  }, [isAsleep, onSleepChange])

  // Squash on jump/pomodoro celebration landing
  const prevCelebratingRef = useRef(pomodoroCelebrating)
  useEffect(() => {
    if (prevCelebratingRef.current && !pomodoroCelebrating) {
      triggerAccent('is-squash')
    }
    prevCelebratingRef.current = pomodoroCelebrating
  }, [pomodoroCelebrating, triggerAccent])


  // ── Ensure cat falls if spawned in the air ──
  useEffect(() => {
    requestAnimationFrame(() => {
      if (draggingRef.current || fallRafRef.current) return;
      const { y: floorY } = clampToViewport(posRef.current.x, 999999)
      if (posRef.current.y < floorY - 5) {
        setFalling(true)
        poseRef.current = 'fall'
        setPose('fall')
        fallVelocityRef.current = 0
        justDroppedRef.current = true

        let lastTime = performance.now()
        const fallStep = (time) => {
          if (draggingRef.current || dragPointerDownRef.current || isReminder) {
            setFalling(false)
            if (fallRafRef.current) cancelAnimationFrame(fallRafRef.current)
            fallRafRef.current = null
            return
          }
          let dt = (time - lastTime) / 1000
          lastTime = time
          if (dt > 0.1) dt = 0.016

          fallVelocityRef.current += 3000 * dt
          let newY = posRef.current.y + fallVelocityRef.current * dt

          const { y: currentFloorY } = clampToViewport(posRef.current.x, 999999)

          if (newY >= currentFloorY) {
            newY = currentFloorY
            posRef.current = { x: posRef.current.x, y: newY }
            setY(newY)
            dragTargetRef.current = { ...posRef.current }
            setFalling(false)
            poseRef.current = 'idle'
            setPose('idle')
            triggerAccentRef.current('is-squash')
            setRoamEpoch((n) => n + 1)
            window.api?.persistPosition?.(posRef.current.x, newY)
            if (fallRafRef.current) cancelAnimationFrame(fallRafRef.current)
            fallRafRef.current = null
          } else {
            posRef.current = { x: posRef.current.x, y: newY }
            setY(newY)
            dragTargetRef.current = { ...posRef.current }
            fallRafRef.current = requestAnimationFrame(fallStep)
          }
        }
        fallRafRef.current = requestAnimationFrame(fallStep)
      } else if (posRef.current.y > floorY + 5) {
        // Below floor (stale saved position from old geometry) — snap up
        posRef.current = { x: posRef.current.x, y: floorY }
        setY(floorY)
        dragTargetRef.current = { ...posRef.current }
        triggerAccentRef.current('is-squash')
        setRoamEpoch((n) => n + 1)
        window.api?.persistPosition?.(posRef.current.x, floorY)
      }
    })
  }, [clampToViewport, isReminder])
  // ── Typing Activity Listener ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.api.on('typing:activity', () => {
      if (draggingRef.current || isReminder || pomodoroCelebrating) {
        return
      }
      
      // Do not interrupt important interactive/idle behaviors
      if (['eat', 'pet', 'play', 'sleep'].includes(poseRef.current) && poseRef.current !== 'sleep') {
        return
      }

      const now = Date.now()
      // Keep events for 1000ms for rate calculation
      typingEventsRef.current = typingEventsRef.current.filter(t => now - t < 1000)
      typingEventsRef.current.push(now)
      
      lastInteractRef.current = now

      // Interrupt walking or sleep
      if (poseRef.current.startsWith('walk')) {
        walkTweenRef.current = null
        setWalkMs(0)
        clearTimeout(roamTimeoutRef.current)
      }
      wakeUp()

      // Switch to typing or typingfast based on event frequency in the last 1000ms
      const rate = typingEventsRef.current.length
      
      // Hysteresis: escalate at > 12, de-escalate at < 8
      let targetPose = poseRef.current
      if (poseRef.current === 'typingfast') {
        if (rate < 8) targetPose = 'typing'
      } else {
        targetPose = rate > 12 ? 'typingfast' : 'typing'
      }

      if (poseRef.current !== targetPose) {
        poseRef.current = targetPose
        setPose(targetPose)
      }

      // Revert to idle if no more typing events occur
      clearTimeout(idleBehaviorTimeoutRef.current)
      idleBehaviorTimeoutRef.current = setTimeout(() => {
        if (poseRef.current === 'typing' || poseRef.current === 'typingfast') {
          poseRef.current = 'idle'
          setPose('idle')
          setRoamEpoch(e => e + 1) // Kick off roam cycle again
        }
      }, 800)
    })
    return unsub
  }, [isReminder, pomodoroCelebrating, wakeUp])

  // Walk tween is idle-only. Active drag writes pointer coords 1:1 in onDragMove.

  // ── Walk Tween (rAF ease-in-out) ─────────────────────────────────────────
  useEffect(() => {
    let rafId
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

    const step = (now) => {
      if (roamBlockedRef.current) {
        walkTweenRef.current = null
        if (poseRef.current.startsWith('walk')) {
          poseRef.current = 'idle'
          setPose('idle')
        }
      }
      const tween = walkTweenRef.current
      if (tween && !draggingRef.current && !dragPointerDownRef.current) {
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
        const screenW = window.screen.availWidth || window.screen.width || 1920
        const screenH = window.screen.availHeight || window.screen.height || 1080
        const cX = Math.round(screenW / 2)
        const cY = Math.round(screenH / 2)
        if (window.api?.setWindowMode) {
          window.api.setWindowMode('treatment', cX, cY).then(() => {
            setTreatmentWindowReady(true)
          })
        } else {
          setTreatmentWindowReady(true)
        }
      }
    } else {
      setTreatmentWindowReady(false)
      if (reminderState === REMINDER_STATE.IDLE_COUNTING && savedPosRef.current) {
        // Returned from big treatment: resume at saved position
        const saved = savedPosRef.current
        savedPosRef.current = null
        posRef.current = saved
        setX(saved.x)
        setY(saved.y)
        dragTargetRef.current = saved
        if (window.api?.setWindowMode) {
          window.api.setWindowMode('mascot', saved.x, saved.y)
        }
      }
    }
  }, [reminderState, isBigTreatment, REMINDER_STATE])

  // ── Roaming loop (idle only) ──────────────────────────────────────────────
  useEffect(() => {
    const gen = ++roamGenRef.current

    const later = (fn, ms) => {
      roamTimeoutRef.current = setTimeout(fn, ms)
    }

    if (isRoamBlocked) {
      walkTweenRef.current = null
      clearTimeout(roamTimeoutRef.current)
      if (!isEating) {
        clearTimeout(idleBehaviorTimeoutRef.current)
      }
      setWalkMs(0)
      if (isReminder) {
        lastInteractRef.current = Date.now()
        poseRef.current = 'alert'
        setPose('alert')
      } else if (isEating) {
        // preserve eating pose
      } else {
        wakeUp()
        if (poseRef.current !== 'idle') {
          poseRef.current = 'idle'
          setPose('idle')
        }
      }
      return () => {
        roamGenRef.current += 1
        clearTimeout(roamTimeoutRef.current)
        if (!isEating) {
          clearTimeout(idleBehaviorTimeoutRef.current)
        }
      }
    }

    if (poseRef.current === 'alert') {
      poseRef.current = 'idle'
      setPose('idle')
    }
    lastInteractRef.current = Date.now()

    const walkOnce = () => {
      if (gen !== roamGenRef.current) return
      if (roamBlockedRef.current) return
      if (draggingRef.current || dragPointerDownRef.current) {
        console.log(`[Renderer] walkOnce deferred (still dragging) gen=${gen}`)
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
      if (!mediaPlayingRef.current && idleFor >= SLEEP_AFTER_MS && Math.random() < SLEEP_CHANCE) {
        setWalkMs(0)
        poseRef.current = 'sleep'
        setPose('sleep')
        return
      }

      // ── Random idle behaviors before walking ──
      // Roll for a random behavior instead of walking sometimes
      const roll = Math.random()
      let triggeredBehavior = 'walk'
      if (roll < PLAY_CHANCE) triggeredBehavior = 'play'

      if (process.env.NODE_ENV === 'development') {
        console.log(`[Mascot] Idle roll: ${roll.toFixed(3)} -> Action: ${triggeredBehavior} (Thresholds: Play <${PLAY_CHANCE})`)
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
      const screenW = window.screen.availWidth || window.screen.width || 1920
      const maxX = Math.max(minX, screenW - width - MARGIN)
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
      console.log(`[Renderer] walkOnce START gen=${gen} dir=${dir} currentX=${currentX.toFixed(1)} targetX=${targetX.toFixed(1)} duration=${Math.round(duration)}ms`)

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
        if (roamBlockedRef.current) {
          walkTweenRef.current = null
          setWalkMs(0)
          if (poseRef.current.startsWith('walk')) {
            poseRef.current = 'idle'
            setPose('idle')
          }
          return
        }
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
    console.log(`[Renderer] roam loop start gen=${gen} justDropped=${justDroppedRef.current} initialDelay=${Math.round(initialDelay)}ms draggingRef=${draggingRef.current}`)
    justDroppedRef.current = false
    later(walkOnce, initialDelay)

    return () => {
      roamGenRef.current += 1
      clearTimeout(roamTimeoutRef.current)
      if (!isEating) {
        clearTimeout(idleBehaviorTimeoutRef.current)
      }
    }
  }, [isReminder, roamEpoch, measure, pomodoroCelebrating, startIdleBehavior, chatState, notificationVisible, wakeUp, isRoamBlocked, isEating])

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


  // ── Drag & Click Handling ─────────────────────────────────────────────────
  // We attach pointermove/pointerup to `document` during drag so that events
  // keep flowing even when the 350×350 Electron window physically moves away
  // from under the cursor via Hyprland IPC.

  const recaptureDragPointer = () => {
    const el = containerRef.current
    const pointerId = dragPointerIdRef.current
    if (!el || pointerId == null) return
    try {
      if (el.hasPointerCapture?.(pointerId)) return
      el.setPointerCapture(pointerId)
    } catch (_) {
      // Wayland may reject capture while the native window is mid-resize.
    }
  }

  const unbindDragPointerListeners = () => {
    document.removeEventListener('pointermove', onDocPointerMove, true)
    document.removeEventListener('pointerup', onDocPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('lostpointercapture', onLostPointerCapture, true)
    window.removeEventListener('blur', onWindowBlur, true)
  }

  const bindGlobalPointerListeners = () => {
    document.addEventListener('pointermove', onDocPointerMove, true)
    document.addEventListener('pointerup', onDocPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('lostpointercapture', onLostPointerCapture, true)
    window.addEventListener('blur', onWindowBlur, true)
  }

  const applyDragPointer = (event) => {
    let targetX
    let targetY

    if (dragExpandingRef.current) {
      // Window is still 160x128. clientX is local to the small window.
      // Global mouse = window cat center (posRef) + local offset from cat center.
      const globalMouseX = posRef.current.x + (event.clientX - (window.innerWidth / 2))
      const globalMouseY = posRef.current.y + (event.clientY - NORMAL_CAT_CY)
      targetX = globalMouseX - dragOffsetRef.current.x
      targetY = globalMouseY - dragOffsetRef.current.y
    } else {
      // Window is fullscreen (1920x1080). clientX is now global screen coordinate.
      targetX = event.clientX - dragOffsetRef.current.x
      targetY = event.clientY - dragOffsetRef.current.y
    }

    const next = clampToViewport(targetX, targetY)
    dragTargetRef.current = next
    lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }

    if (!draggingRef.current) return
    posRef.current = next
    setX(next.x)
    setY(next.y)
  }

  const startDrag = async (event) => {
    isStartingDragRef.current = true
    dragStartedRef.current = true
    dragPointerIdRef.current = event.pointerId
    try { containerRef.current?.setPointerCapture(event.pointerId) } catch (_) {}

    walkTweenRef.current = null
    dragEndingRef.current = false
    dragPointerDownRef.current = true
    draggingRef.current = true
    dragExpandingRef.current = true

    clearTimeout(roamTimeoutRef.current)
    clearTimeout(accentTimerRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)
    clearTimeout(eatTimeoutRef.current)

    roamGenRef.current += 1
    setWalkMs(0)
    poseRef.current = 'idle'
    setPose('idle')
    snapVisualPosition()
    markInteraction()

    dragTargetRef.current = { x: posRef.current.x, y: posRef.current.y }

    let dragResizeApplied = true
    if (window.api?.setWindowMode) {
      const result = await window.api.setWindowMode('drag')
      dragResizeApplied = result?.applied === true
      if (!dragResizeApplied) {
        console.error('[Renderer] startDrag NOT switching to screen-space CSS: hyprctl did not confirm fullscreen size')
      }
    }

    dragExpandingRef.current = false
    isStartingDragRef.current = false

    if (!dragPointerDownRef.current || dragEndingRef.current) {
      console.log('[Renderer] startDrag aborted: pointer released before fullscreen confirmed')
      if (dragResizeApplied && window.api?.setWindowMode) {
        await window.api.setWindowMode('mascot', posRef.current.x, posRef.current.y)
      }
      unbindDragPointerListeners()
      draggingRef.current = false
      setDragging(false)
      return
    }

    if (!dragResizeApplied) {
      unbindDragPointerListeners()
      draggingRef.current = false
      setDragging(false)
      return
    }

    const latestPointer = lastDragPointerRef.current
    const targetX = latestPointer.clientX - dragOffsetRef.current.x
    const targetY = latestPointer.clientY - dragOffsetRef.current.y
    const next = clampToViewport(targetX, targetY)
    dragTargetRef.current = next
    posRef.current = next
    setX(next.x)
    setY(next.y)

    recaptureDragPointer()
    setDragging(true)
  }

  const onLostPointerCapture = (event) => {
    if (!dragPointerDownRef.current && !draggingRef.current) return
    if (dragEndingRef.current) return
    if (dragPointerIdRef.current != null && event.pointerId !== dragPointerIdRef.current) return
    console.log('[Renderer] lostpointercapture during drag; recapturing')
    recaptureDragPointer()
  }

  const onPointerCancel = (event) => {
    if (dragStartedRef.current || draggingRef.current) {
      lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
      console.log(`[Renderer] pointercancel ignored (resize/capture loss); expanding=${dragExpandingRef.current} buttons=${event.buttons}`)
      recaptureDragPointer()
    } else {
      buttonPointersRef.current = { 0: null, 1: null, 2: null }
      clearTimeout(leftClickTimerRef.current)
      clearTimeout(rightClickTimerRef.current)
      leftClickTimerRef.current = null
      rightClickTimerRef.current = null
      unbindDragPointerListeners()
    }
  }

  const onDragEnd = async (event) => {
    if (dragEndingRef.current) return
    if (!dragPointerDownRef.current && !draggingRef.current) return

    if (event?.type === 'pointercancel') {
      onPointerCancel(event)
      return
    }
    if (dragExpandingRef.current && event?.type === 'pointerup') {
      console.log('[Renderer] deferring pointerup during drag-start expand')
      return
    }

    dragEndingRef.current = true
    dragExpandingRef.current = false
    dragPointerDownRef.current = false

    lastInteractRef.current = Date.now()

    unbindDragPointerListeners()
    dragPointerIdRef.current = null

    const finalPos = dragTargetRef.current
    posRef.current = finalPos
    setX(finalPos.x)
    setY(finalPos.y)

    const logCatBoundsVsWindow = (tag) => {
      const el = containerRef.current
      const cs = el ? window.getComputedStyle(el) : null
      const innerW = window.innerWidth
      const innerH = window.innerHeight
      const catW = el?.offsetWidth || FALLBACK_WIDTH
      const catH = el?.offsetHeight || FALLBACK_HEIGHT
      const dragCssInside160x128 = finalPos.x >= 0 && finalPos.x <= 160 && finalPos.y >= 0 && finalPos.y <= 128
      const dragCssInsideInner = finalPos.x >= 0 && finalPos.x <= innerW && finalPos.y >= 0 && finalPos.y <= innerH
      const centeredCssInsideInner = innerW >= catW && innerH >= catH
      console.log(
        `[Renderer] ${tag} inner=${innerW}x${innerH} catBox=${catW}x${catH} css left=${cs?.left} top=${cs?.top} transform=${cs?.transform} draggingRef=${draggingRef.current} walkTween=${!!walkTweenRef.current} finalPos=(${finalPos.x}, ${finalPos.y}) dragCssInside160x128=${dragCssInside160x128} dragCssInsideInner=${dragCssInsideInner} centeredCssFitsInner=${centeredCssInsideInner}`
      )
    }

    // Shrink window back to 160x128 and reposition at the cat's final center.
    // AWAIT this transition so the window fully moves to the right spot
    // before we turn off drag mode (which switches CSS back to centered)
    // and before we resume the roaming loop.
    console.log(`[Renderer] onDragEnd type=${event?.type} BEFORE setWindowMode mascot finalPos=(${finalPos.x}, ${finalPos.y}) draggingRef=${draggingRef.current} walkTween=${!!walkTweenRef.current}`)
    logCatBoundsVsWindow('onDragEnd before await mascot')
    let mascotResizeApplied = true
    if (window.api?.setWindowMode) {
      lastSentMoveRef.current = { x: finalPos.x, y: finalPos.y }
      const mascotResult = await window.api.setWindowMode('mascot', finalPos.x, finalPos.y)
      mascotResizeApplied = mascotResult?.applied === true
      console.log(`[Renderer] onDragEnd setWindowMode(mascot) resolved ${JSON.stringify(mascotResult)}`)
      if (!mascotResizeApplied) {
        console.error('[Renderer] onDragEnd hyprctl did not confirm 160x128 before roam resume')
      }
    }
    console.log('[Renderer] onDragEnd AFTER await setWindowMode mascot — about to set draggingRef=false and resume roam')
    logCatBoundsVsWindow('onDragEnd after await mascot, still draggingRef=true')

    draggingRef.current = false
    setDragging(false)
    logCatBoundsVsWindow('onDragEnd after draggingRef=false (React dragging state still true until next paint)')

    justDroppedRef.current = true
    setTimeout(() => {
      justDroppedRef.current = false
    }, 400)

    const { y: floorY } = clampToViewport(finalPos.x, 999999)
    const isFalling = finalPos.y < floorY - 5

    if (isFalling) {
      setFalling(true)
      poseRef.current = 'fall'
      setPose('fall')
      fallVelocityRef.current = 0
      justDroppedRef.current = true

      let lastTime = performance.now()
      const fallStep = (time) => {
        if (draggingRef.current || dragPointerDownRef.current || isReminder) {
          setFalling(false)
          if (fallRafRef.current) cancelAnimationFrame(fallRafRef.current)
          fallRafRef.current = null
          return
        }
        let dt = (time - lastTime) / 1000
        lastTime = time
        if (dt > 0.1) dt = 0.016

        fallVelocityRef.current += 3000 * dt
        let newY = posRef.current.y + fallVelocityRef.current * dt

        const { y: currentFloorY } = clampToViewport(posRef.current.x, 999999)

        if (newY >= currentFloorY) {
          newY = currentFloorY
          posRef.current = { x: posRef.current.x, y: newY }
          setY(newY)
          dragTargetRef.current = { ...posRef.current }
          setFalling(false)
          poseRef.current = 'idle'
          setPose('idle')
          triggerAccentRef.current('is-squash')
          setRoamEpoch((n) => n + 1)
          window.api?.persistPosition?.(posRef.current.x, newY)
          if (fallRafRef.current) cancelAnimationFrame(fallRafRef.current)
          fallRafRef.current = null
        } else {
          posRef.current = { x: posRef.current.x, y: newY }
          setY(newY)
          dragTargetRef.current = { ...posRef.current }
          fallRafRef.current = requestAnimationFrame(fallStep)
        }
      }
      fallRafRef.current = requestAnimationFrame(fallStep)
    } else {
      triggerAccent('is-squash')
      if (!isReminder) {
        justDroppedRef.current = true
        console.log(`[Renderer] onDragEnd scheduling roam resume via setRoamEpoch (after await + draggingRef=false mascotApplied=${mascotResizeApplied})`)
        setRoamEpoch((n) => n + 1)
      }
    }
  }

  const handleButtonRelease = (b, event) => {
    const downInfo = buttonPointersRef.current[b]
    buttonPointersRef.current[b] = null

    if (
      !buttonPointersRef.current[0] &&
      !buttonPointersRef.current[1] &&
      !buttonPointersRef.current[2] &&
      !draggingRef.current &&
      !dragExpandingRef.current
    ) {
      unbindDragPointerListeners()
    }

    if (b === targetDragButton) {
      if (dragStartedRef.current || draggingRef.current) {
        onDragEnd(event)
        dragStartedRef.current = false
        return
      }
      if (isStartingDragRef.current) {
        dragPointerDownRef.current = false
        dragEndingRef.current = true
        return
      }
    }

    if (draggingRef.current || dragStartedRef.current || justDroppedRef.current) {
      return
    }
    if (!downInfo) return
    if (clickToInteract === false) return

    const eventX = event?.screenX ?? downInfo.screenX
    const eventY = event?.screenY ?? downInfo.screenY
    const dx = Math.abs(eventX - downInfo.screenX)
    const dy = Math.abs(eventY - downInfo.screenY)
    if (Math.hypot(dx, dy) >= CLICK_MAX_DISTANCE) return
    if (Date.now() - downInfo.time > 800) return

    if (b === 0) {
      const now = Date.now()
      const prev = lastLeftClickRef.current
      const isDoubleClick = (now - prev.time <= CLICK_MAX_DURATION) &&
        Math.hypot(eventX - prev.x, eventY - prev.y) <= CLICK_MAX_DISTANCE

      if (isDoubleClick) {
        clearTimeout(leftClickTimerRef.current)
        leftClickTimerRef.current = null
        lastLeftClickRef.current = { time: 0, x: 0, y: 0 }
        if (doubleClickAction !== 'none') {
          executeAction(doubleClickAction)
        }
      } else {
        lastLeftClickRef.current = { time: now, x: eventX, y: eventY }
        if (doubleClickAction !== 'none') {
          clearTimeout(leftClickTimerRef.current)
          leftClickTimerRef.current = setTimeout(() => {
            leftClickTimerRef.current = null
            executeAction(leftClickAction)
          }, CLICK_MAX_DURATION)
        } else {
          clearTimeout(leftClickTimerRef.current)
          leftClickTimerRef.current = null
          executeAction(leftClickAction)
        }
      }
    } else if (b === 2) {
      const now = Date.now()
      const prev = lastRightClickRef.current
      const isDoubleClick = (now - prev.time <= CLICK_MAX_DURATION) &&
        Math.hypot(eventX - prev.x, eventY - prev.y) <= CLICK_MAX_DISTANCE

      if (isDoubleClick) {
        clearTimeout(rightClickTimerRef.current)
        rightClickTimerRef.current = null
        lastRightClickRef.current = { time: 0, x: 0, y: 0 }
        if (rightDoubleClickAction !== 'none') {
          executeAction(rightDoubleClickAction)
        }
      } else {
        lastRightClickRef.current = { time: now, x: eventX, y: eventY }
        if (rightDoubleClickAction !== 'none') {
          clearTimeout(rightClickTimerRef.current)
          rightClickTimerRef.current = setTimeout(() => {
            rightClickTimerRef.current = null
            executeAction(rightClickAction)
          }, CLICK_MAX_DURATION)
        } else {
          clearTimeout(rightClickTimerRef.current)
          rightClickTimerRef.current = null
          executeAction(rightClickAction)
        }
      }
    }
  }

  const onDocPointerMove = (event) => {
    for (const b of [0, 1, 2]) {
      if (buttonPointersRef.current[b] && (event.buttons & BUTTON_MASK[b]) === 0) {
        handleButtonRelease(b, event)
      }
    }

    lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }

    if (draggingRef.current || dragExpandingRef.current) {
      applyDragPointer(event)
      return
    }

    if (isStartingDragRef.current) return

    const dragDown = buttonPointersRef.current[targetDragButton]
    if (dragDown && dragBehavior !== false) {
      const dx = event.screenX - dragDown.screenX
      const dy = event.screenY - dragDown.screenY
      const dist = Math.hypot(dx, dy)
      if (dist >= CLICK_MAX_DISTANCE) {
        clearTimeout(leftClickTimerRef.current)
        clearTimeout(rightClickTimerRef.current)
        leftClickTimerRef.current = null
        rightClickTimerRef.current = null
        console.log(`[Renderer] drag started (button=${dragButton})`)
        startDrag(event)
      }
    }
  }

  const onDocPointerUp = (event) => {
    handleButtonRelease(event.button, event)
  }

  const onWindowBlur = () => {
    if (dragStartedRef.current || draggingRef.current) {
      onDragEnd(null)
      dragStartedRef.current = false
    }
    buttonPointersRef.current = { 0: null, 1: null, 2: null }
    clearTimeout(leftClickTimerRef.current)
    clearTimeout(rightClickTimerRef.current)
    leftClickTimerRef.current = null
    rightClickTimerRef.current = null
    unbindDragPointerListeners()
  }

  const handlePointerDown = (event) => {
    if (event.target.closest?.('.mascot-reminder-card')) return
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return

    if (event.button === 1) {
      event.preventDefault()
    }

    if (fallRafRef.current) {
      cancelAnimationFrame(fallRafRef.current)
      fallRafRef.current = null
      setFalling(false)
    }

    buttonPointersRef.current[event.button] = {
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      time: Date.now(),
    }

    if (event.button === targetDragButton) {
      isStartingDragRef.current = false
      dragStartedRef.current = false
      dragOffsetRef.current = {
        x: event.clientX - (window.innerWidth / 2),
        y: event.clientY - NORMAL_CAT_CY,
      }
      lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    }

    bindGlobalPointerListeners()
  }

  // Keep original handler names for the JSX props; pointerMove/Up on the
  // element are no-ops now — the document listeners do the real work.
  const handlePointerMove = () => {}
  const handlePointerUp = () => {}

  // ── Hitbox Hover (Pet) ────────────────────────────────────────────────────
  const handleHeadPointerEnter = () => {
    clearTimeout(petLeaveTimeoutRef.current)
    if (!isHoveringHead) {
      strokeTrackingRef.current = { currentDir: 0, apexX: 0, reversals: [] }
    }
  }

  const handleHeadPointerMove = (event) => {
    if (poseRef.current === 'sleep' || draggingRef.current || isReminder || pomodoroCelebrating) return
    clearTimeout(petLeaveTimeoutRef.current)
    if (isHoveringHead) return

    const tracking = strokeTrackingRef.current
    const currentX = event.clientX
    const now = Date.now()

    if (tracking.currentDir === 0) {
      tracking.apexX = currentX
      tracking.currentDir = 1
    } else if (tracking.currentDir === 1) {
      if (currentX > tracking.apexX) {
        tracking.apexX = currentX
      } else if (tracking.apexX - currentX >= 6) {
        tracking.currentDir = -1
        tracking.apexX = currentX
        tracking.reversals.push(now)
      }
    } else if (tracking.currentDir === -1) {
      if (currentX < tracking.apexX) {
        tracking.apexX = currentX
      } else if (currentX - tracking.apexX >= 6) {
        tracking.currentDir = 1
        tracking.apexX = currentX
        tracking.reversals.push(now)
      }
    }

    tracking.reversals = tracking.reversals.filter((t) => now - t <= 800)

    if (tracking.reversals.length >= 2) {
      walkTweenRef.current = null
      setWalkMs(0)
      clearTimeout(roamTimeoutRef.current)
      clearTimeout(idleBehaviorTimeoutRef.current)
      clearTimeout(eatTimeoutRef.current)
      setIsHoveringHead(true)
    }
  }

  const handleHeadPointerLeave = () => {
    if (poseRef.current === 'sleep') return
    clearTimeout(petLeaveTimeoutRef.current)
    if (isHoveringHead) {
      petLeaveTimeoutRef.current = setTimeout(() => {
        setIsHoveringHead(false)
        setRoamEpoch((n) => n + 1)
      }, 400)
    }
    strokeTrackingRef.current = { currentDir: 0, apexX: 0, reversals: [] }
  }

  const handleMouseEnter = () => {}
  const handleMouseLeave = () => {}

  useEffect(() => {
    return () => {
      // Clean up document-level drag listeners if component unmounts mid-drag
      unbindDragPointerListeners()
      clearTimeout(leftClickTimerRef.current)
      clearTimeout(rightClickTimerRef.current)
      clearTimeout(petLeaveTimeoutRef.current)
      clearTimeout(eatTimeoutRef.current)
    }
  }, [])

  let currentPose = pose
  if (isHoveringHead && !dragging && !isReminder && !pomodoroCelebrating && pose !== 'sleep') {
    currentPose = 'pet'
  }

  const displayPose = (isReminder && reminderCatAnimation !== false) ? 'alert' : pomodoroCelebrating ? 'jump' : currentPose
  const moving = walkMs > 0 && !dragging && displayPose.startsWith('walk')

  let stateClass = 'is-idle'
  if (moving) stateClass = 'is-walking'
  if (displayPose === 'sleep') stateClass = 'is-sleep'
  if (mediaPlaying && !isReminder && !dragging && !pomodoroCelebrating) stateClass = 'is-listening'

  // Map state machine to sprite animations
  let animationName = 'idle'
  let flipped = false

  if (falling) {
    animationName = 'fall'
    flipped = false
  } else if (pomodoroCelebrating) {
    animationName = 'jump'
    flipped = false
  } else if (dragging) {
    animationName = 'drag'
    flipped = false
  } else if (isReminder && reminderCatAnimation !== false) {
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
  } else if (chatState === 'reply') {
    animationName = 'talk'
    flipped = false
  } else {
    animationName = 'idle'
    flipped = false
  }

  const isEyeTrackingEligible = Boolean(
    !reduceResourceUsage &&
    mouseReaction &&
    !paused &&
    animationName === 'idle' &&
    !dragging &&
    !falling &&
    !pomodoroCelebrating &&
    !(isReminder && reminderCatAnimation !== false)
  )

  useEffect(() => {
    if (window.api?.setEyeTrackingActive) {
      window.api.setEyeTrackingActive(isEyeTrackingEligible)
    }
    return () => {
      if (window.api?.setEyeTrackingActive) {
        window.api.setEyeTrackingActive(false)
      }
    }
  }, [isEyeTrackingEligible])

  useEffect(() => {
    if (!isEyeTrackingEligible) {
      setCursorOffset(null)
      return undefined
    }
    const unsub = window.api?.on?.('mascot:cursor-offset', (offset) => {
      setCursorOffset(offset)
    })
    return () => {
      unsub?.()
    }
  }, [isEyeTrackingEligible])

  // ── Coordinates and Transitions for Center-Screen MovementBreak ───────────
  const screenW = window.screen.availWidth || window.screen.width || 1920
  const screenH = window.screen.availHeight || window.screen.height || 1080
  const centerX = Math.round(screenW / 2)
  const centerY = Math.round(screenH / 2)

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

  const isScaleBig =
    isBigTreatment && treatmentWindowReady &&
    (reminderState === REMINDER_STATE.ENTRANCE || reminderState === REMINDER_STATE.ACTIVE)
  const isNormalJump = !isBigTreatment && displayPose === 'jump'
  const spriteScale = isScaleBig ? 2 : isNormalJump ? 0.75 : 1

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

  // Only flip the stack order if dragging (full-screen window), as mascot window
  // has a fixed 162px of empty space above the sprite that bubbles must stack into.
  const isNearTop = targetY < 120 && dragging

  // ── Sync physical window position with logical coordinates ──────────────
  // During drag the window is fullscreen and the cat is positioned via CSS
  // transform, so we skip Hyprland window movement.
  useEffect(() => {
    if (window.api?.moveWindow && !draggingRef.current) {
      // Prevent stale/redundant moveWindow IPCs if we already sent this position
      // (e.g. via setWindowMode('mascot', x, y) on drag release)
      if (lastSentMoveRef.current.x === targetX && lastSentMoveRef.current.y === targetY) {
        return
      }
      lastSentMoveRef.current = { x: targetX, y: targetY }
      console.log(`[Renderer] calling moveWindow(${targetX}, ${targetY}) draggingRef=${draggingRef.current} walkTween=${!!walkTweenRef.current}`)
      window.api.moveWindow(targetX, targetY)
    }
  }, [targetX, targetY])

  return (
    <div
      ref={containerRef}
      className={`mascot-container ${stateClass} ${dragging ? 'is-dragging' : ''} ${isNearTop ? 'is-near-top' : ''}`}
      style={dragging ? {
        // During drag the window is fullscreen at (0,0). Position the cat
        // at its screen coordinates via CSS transform.
        left: 0,
        top: 0,
        bottom: 'auto',
        transform: `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, calc(-100% + ${SPRITE_HEIGHT / 2}px))`,
        transition: 'none',
      } : {
        // Normal mode: cat is centered in the 160x128 window via Mascot.css.
      }}
      onContextMenu={(e) => e.preventDefault()}
      onAuxClick={(e) => e.preventDefault()}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
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
          position: 'relative', // Added to position the hitbox correctly
          ...(isBigTreatment || isNormalJump ? { transformOrigin: 'center bottom' } : {})
        }}
      >
        {/* Hover hit-box over the cat's head for petting */}
        <div
          className="mascot-head-hitbox"
          style={{
            position: 'absolute',
            top: '48.9%',
            left: '33.3%',
            width: '54%',
            height: '30%',
            zIndex: 10,
          }}
          onPointerEnter={handleHeadPointerEnter}
          onPointerMove={handleHeadPointerMove}
          onPointerLeave={handleHeadPointerLeave}
          title="Pet me!"
        />
        <div
          className="mascot-opacity-wrap"
          style={{ opacity: effectiveOpacity }}
        >
          <SpriteAnimator
            animation={animationName}
            flipped={flipped}
            loop={true}
            manifest={useListening ? listeningManifest : undefined}
            spritesheet={useListening ? listeningSheetSrc : undefined}
            catAnimationSpeed={catAnimationSpeed}
            eyeTracking={isEyeTrackingEligible}
            cursorOffset={cursorOffset}
            fpsCap={effectiveFps}
          />
        </div>
      </div>


      </div>
  )
}
