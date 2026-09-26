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
const PLAY_CHANCE = 0.15         // Increased to compensate for removed typing roll

// Duration ranges for idle behaviors (ms)
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
  const sw = window.screen.availWidth || window.screen.width || 1920
  const sh = window.screen.availHeight || window.screen.height || 1080
  return {
    x: Math.max(MARGIN, sw - FALLBACK_WIDTH - 48),
    y: Math.max(MARGIN, sh - FALLBACK_HEIGHT - 48),
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
  
  // Typing event tracking for real typing detection
  const typingEventsRef = useRef([])
  
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
  const lastSentMoveRef = useRef({ x: -1, y: -1 })
  const dragPointerDownRef = useRef(false)
  const lastDragPointerRef = useRef(null)
  const dragExpandingRef = useRef(false)
  const dragEndingRef = useRef(false)
  const dragPointerIdRef = useRef(null)

  poseRef.current = pose
  if (!draggingRef.current && !dragPointerDownRef.current) {
    posRef.current = { x, y }
  }

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
      // Use logical screen size instead of the (now small) window innerWidth
      const screenW = window.screen.width || 1920
      const screenH = window.screen.height || 1080
      return {
        x: clamp(nx, MARGIN, Math.max(MARGIN, screenW - width - MARGIN)),
        y: clamp(ny, MARGIN, Math.max(MARGIN, screenH - height - MARGIN)),
      }
    },
    [measure]
  )

  const snapVisualPosition = useCallback(() => {
    // The window is physically moved now; we don't need to read DOM rects.
    // posRef already perfectly tracks the physical screen position.
    return posRef.current
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
      } else if (poseRef.current === 'sleep') {
        poseRef.current = 'idle'
        setPose('idle')
      }

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
  }, [isReminder, pomodoroCelebrating])

  // Walk tween is idle-only. Active drag writes pointer coords 1:1 in onDragMove.

  // ── Walk Tween (rAF ease-in-out) ─────────────────────────────────────────
  useEffect(() => {
    let rafId
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

    const step = (now) => {
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
    document.removeEventListener('pointermove', onDragMove, true)
    document.removeEventListener('pointerup', onDragEnd, true)
    document.removeEventListener('pointercancel', onDragCancel, true)
    document.removeEventListener('lostpointercapture', onLostPointerCapture, true)
    document.removeEventListener('mouseup', onMouseUp, true)
  }

  const applyDragPointer = (event) => {
    let targetX
    let targetY

    if (dragExpandingRef.current) {
      // Window is still 350x350. clientX is local to the small window.
      // Global mouse = window center (posRef) + local offset from center.
      const globalMouseX = posRef.current.x + (event.clientX - (window.innerWidth / 2))
      const globalMouseY = posRef.current.y + (event.clientY - (window.innerHeight / 2))
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

  const handlePointerDown = async (event) => {
    if (event.button !== 0) return
    if (event.target.closest?.('.mascot-reminder-card')) return

    // Record down info to distinguish click from drag
    pointerDownInfoRef.current = {
      x: event.screenX,
      y: event.screenY,
      time: Date.now(),
    }

    dragPointerIdRef.current = event.pointerId
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch (_) {}

    walkTweenRef.current = null
    dragEndingRef.current = false
    dragPointerDownRef.current = true
    draggingRef.current = true
    dragExpandingRef.current = true
    lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }

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

    // Cat is perfectly centered in the 350x350 window.
    // The offset of the cursor from the cat's center is just clientX - center.
    dragOffsetRef.current = {
      x: event.clientX - (window.innerWidth / 2),
      y: event.clientY - (window.innerHeight / 2),
    }
    dragTargetRef.current = { x: posRef.current.x, y: posRef.current.y }

    document.addEventListener('pointermove', onDragMove, true)
    document.addEventListener('pointerup', onDragEnd, true)
    document.addEventListener('pointercancel', onDragCancel, true)
    document.addEventListener('lostpointercapture', onLostPointerCapture, true)
    document.addEventListener('mouseup', onMouseUp, true)

    let dragResizeApplied = true
    if (window.api?.setWindowMode) {
      const result = await window.api.setWindowMode('drag')
      dragResizeApplied = result?.applied === true
      if (!dragResizeApplied) {
        console.error('[Renderer] handlePointerDown NOT switching to screen-space CSS: hyprctl did not confirm fullscreen size')
      }
    }

    dragExpandingRef.current = false

    if (!dragPointerDownRef.current || dragEndingRef.current) {
      console.log('[Renderer] handlePointerDown aborted: pointer released before fullscreen confirmed')
      return
    }

    if (!dragResizeApplied) {
      unbindDragPointerListeners()
      draggingRef.current = false
      setDragging(false)
      return
    }

    recaptureDragPointer()
    applyDragPointer({
      clientX: lastDragPointerRef.current?.clientX ?? event.clientX,
      clientY: lastDragPointerRef.current?.clientY ?? event.clientY,
    })
    setDragging(true)
  }

  const onDragMove = (event) => {
    if (!dragPointerDownRef.current && !draggingRef.current) return
    // If we missed a fast pointerup during the resize expansion,
    // the next move event will correctly report that the button is physically released.
    if (event.buttons === 0) {
      console.log('[Renderer] button physically released during move, force ending drag')
      onDragEnd(event)
      return
    }
    applyDragPointer(event)
  }

  const onDragCancel = (event) => {
    if (!dragPointerDownRef.current && !draggingRef.current) return
    lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    console.log(`[Renderer] pointercancel ignored (resize/capture loss); expanding=${dragExpandingRef.current} buttons=${event.buttons}`)
    recaptureDragPointer()
  }

  const onLostPointerCapture = (event) => {
    if (!dragPointerDownRef.current && !draggingRef.current) return
    if (dragEndingRef.current) return
    if (dragPointerIdRef.current != null && event.pointerId !== dragPointerIdRef.current) return
    console.log('[Renderer] lostpointercapture during drag; recapturing')
    recaptureDragPointer()
  }

  const onMouseUp = (event) => {
    if (event.button !== 0) return
    if (dragExpandingRef.current) {
      console.log('[Renderer] deferring mouseup during drag-start expand')
      return
    }
    onDragEnd(event)
  }

  const onDragEnd = async (event) => {
    if (dragEndingRef.current) return
    if (!dragPointerDownRef.current && !draggingRef.current) return

    if (event?.type === 'pointercancel') {
      onDragCancel(event)
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
      const dragCssInside350 = finalPos.x >= 0 && finalPos.x <= 350 && finalPos.y >= 0 && finalPos.y <= 350
      const dragCssInsideInner = finalPos.x >= 0 && finalPos.x <= innerW && finalPos.y >= 0 && finalPos.y <= innerH
      const centeredCssInsideInner = innerW >= catW && innerH >= catH
      console.log(
        `[Renderer] ${tag} inner=${innerW}x${innerH} catBox=${catW}x${catH} css left=${cs?.left} top=${cs?.top} transform=${cs?.transform} draggingRef=${draggingRef.current} walkTween=${!!walkTweenRef.current} finalPos=(${finalPos.x}, ${finalPos.y}) dragCssInside350=${dragCssInside350} dragCssInsideInner=${dragCssInsideInner} centeredCssFitsInner=${centeredCssInsideInner}`
      )
    }

    // Shrink window back to 350x350 and reposition at the cat's final center.
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
        console.error('[Renderer] onDragEnd hyprctl did not confirm 350x350 before roam resume')
      }
    }
    console.log('[Renderer] onDragEnd AFTER await setWindowMode mascot — about to set draggingRef=false and resume roam')
    logCatBoundsVsWindow('onDragEnd after await mascot, still draggingRef=true')

    draggingRef.current = false
    setDragging(false)
    logCatBoundsVsWindow('onDragEnd after draggingRef=false (React dragging state still true until next paint)')

    // ── Click detection: was this a click (not a drag)? ──
    const downInfo = pointerDownInfoRef.current
    if (downInfo) {
      const dx = Math.abs(event.screenX - downInfo.x)
      const dy = Math.abs(event.screenY - downInfo.y)
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
      console.log(`[Renderer] onDragEnd scheduling roam resume via setRoamEpoch (after await + draggingRef=false mascotApplied=${mascotResizeApplied})`)
      setRoamEpoch((n) => n + 1)
    }
  }

  // Keep original handler names for the JSX props; pointerMove/Up on the
  // element are no-ops now — the document listeners do the real work.
  const handlePointerMove = () => {}
  const handlePointerUp = () => {}

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

  const handleMouseEnter = () => {}
  const handleMouseLeave = () => {}

  useEffect(() => {
    return () => {
      // Clean up document-level drag listeners if component unmounts mid-drag
      unbindDragPointerListeners()
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
  const screenW = window.screen.availWidth || window.screen.width || 1920
  const screenH = window.screen.availHeight || window.screen.height || 1080
  const centerX = Math.max(MARGIN, Math.round((screenW - SPRITE_WIDTH) / 2))
  const centerY = Math.max(MARGIN, Math.round((screenH - SPRITE_HEIGHT) / 2))

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
        transform: `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`,
        transition: 'none',
      } : {
        // Normal mode: cat is centered in the 350x350 window via Mascot.css.
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
