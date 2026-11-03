import React, { useCallback, useEffect, useRef, useState } from 'react'
import './Mascot.css'
import SpriteAnimator, { SPEED_FACTORS } from './SpriteAnimator'
import listeningManifest from '../assets/cat-sprite/listening-manifest.json'
import listeningSheetSrc from '../assets/cat-sprite/cat_listening_spritesheet.png'
import animsManifest from '../assets/cat-sprite/anims/anims.json'
import { useMood, moodModifiers, MOOD_EMOJIS } from '../hooks/useMood'

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
// ── Activity & Roam Timing Constants ────────────────────────────────────────
export const TIME_OF_DAY_SHIFT = 0.30

export const ROAM_INTERVAL_MIN_MS = 12000
export const ROAM_INTERVAL_MAX_MS = 35000
export const ROAM_CHANCE = 0.7
export const ROAM_DISTANCE_MIN_PX = 60
export const ROAM_DISTANCE_MAX_PX = 260
export const ACTIVITY_GAP_MIN_MS = 6000
export const IDLE_LIFE_INTERVAL_MIN_MS = 10000
export const IDLE_LIFE_INTERVAL_MAX_MS = 25000
export const IDLE_LIFE_SIT_CHANCE = 0.25

export const WALK_SPEED_MIN_PX_S = 80
export const WALK_SPEED_MAX_PX_S = 120
export const WALK_PX_PER_CYCLE = 72

export const STALK_SPEED_MIN_PX_S = 35
export const STALK_SPEED_MAX_PX_S = 60
export const STALK_PX_PER_CYCLE = 68

export const RUN_SPEED_MIN_PX_S = 240
export const RUN_SPEED_MAX_PX_S = 320
export const RUN_PX_PER_CYCLE = 170

// Knockoff constants
export const KNOCKOFF_ARRIVE_CHANCE = 0.40
export const KNOCKOFF_IDLE_CHANCE = 0.35
export const KNOCKOFF_COOLDOWN_MS = 180000 // 3 minutes
export const KNOCKOFF_EDGE_WALK_CHANCE = 0.15
export const KNOCKOFF_EDGE_DIST_PX = 70

// Gift constants
export const GIFT_CHANCE = 0.10
export const GIFT_COOLDOWN_MS = 600000 // 10 minutes
export const GIFT_MIN_AFFECTION = 95

const FALLBACK_WIDTH = SPRITE_WIDTH
const FALLBACK_HEIGHT = SPRITE_HEIGHT
const SLEEP_AFTER_MS = 2 * 60 * 1000
const SLEEP_CHANCE = 0.4

export const ONE_SHOT_ANIMATIONS = new Set(['yawn', 'pounce', 'crouch', 'crouchpounce', 'wakeup', 'gift', 'knockoff', 'annoyed', 'sad', 'standup', 'sitdown', 'stretch', 'lookaround', 'tailflick'])

export function getAnimationDuration(name, speed = 'normal', holdMs = 800) {
  let animName = name
  if (animName === 'crouch' || animName === 'pounce') {
    animName = 'crouchpounce'
  }
  const anim = animsManifest?.animations?.[animName]
  const speedFactor = typeof speed === 'number' ? speed : (SPEED_FACTORS[speed] || 1)
  if (anim && anim.frames && anim.fps) {
    const extraHold = animName === 'wakeup' ? 250 : (animName === 'standup' || animName === 'sitdown') ? 0 : holdMs
    return Math.round((anim.frames / (anim.fps * speedFactor)) * 1000 + extraHold)
  }
  return 2000
}

export function getTimeOfDayPeriod(date = new Date()) {
  const hour = date.getHours()
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}

export function getMovementSpeedMultiplier(energy = 100, date = new Date()) {
  let mult = 1.0
  if (energy <= 35) mult *= 0.85
  const period = getTimeOfDayPeriod(date)
  if (period === 'night') mult *= 0.9
  return mult
}

export function getRoamIntervalMultiplier(date = new Date()) {
  const period = getTimeOfDayPeriod(date)
  if (period === 'night') return 1.3
  return 1.0
}

export const LIFE_CHAINS = [
  { id: 'lookaround', baseWeight: 10, isChain: true },
  { id: 'tailflick', baseWeight: 8, isChain: true },
  { id: 'stretch_in_place', baseWeight: 8, isChain: true },
  { id: 'wake_stretch', baseWeight: 0, isChain: true },
  { id: 'patrol', baseWeight: 8, isChain: true },
  { id: 'walk_then_act', baseWeight: 10, isChain: true },
  { id: 'stalk_pounce', baseWeight: 6, isChain: true },
  { id: 'run_burst', baseWeight: 6, isChain: true },
  { id: 'nap_elsewhere', baseWeight: 5, isChain: true },
]

export function getIdleWeights(mood = null, energy = 100, date = new Date()) {
  const mods = moodModifiers(mood)
  const period = getTimeOfDayPeriod(date)
  const shift = TIME_OF_DAY_SHIFT

  // Base seated items
  let groomWeight = 15 * mods.groom
  let yawnWeight = 15 * mods.yawn
  let proudWeight = 12 * mods.proud
  let playWeight = 12 * mods.play
  let toyplayWeight = 14 * mods.toyplay
  let curiousWeight = 14 * mods.curious

  // Base chain items
  let lookaroundWeight = 10
  let tailflickWeight = 8
  let stretchWeight = 8
  let wakeStretchWeight = 0
  let patrolWeight = 8
  let walkThenActWeight = 10
  let stalkPounceWeight = 6
  let runBurstWeight = 6
  let napElsewhereWeight = 5

  // ── Energy modifiers ──
  if (energy >= 65) {
    runBurstWeight *= 1.6
    stalkPounceWeight *= 1.6
    yawnWeight *= 0.6
    napElsewhereWeight = 0
  } else if (energy <= 35) {
    runBurstWeight *= 0.2
    stalkPounceWeight *= 0.2
    yawnWeight *= 1.8
    napElsewhereWeight *= 2.5
  }

  // ── Mood modifiers ──
  if (mood === 'Sleepy') {
    napElsewhereWeight *= 2
    runBurstWeight = 0
    stalkPounceWeight = 0
  } else if (mood === 'Hungry') {
    runBurstWeight *= 0.3
    stalkPounceWeight *= 0.3
  } else if (mood === 'Lonely' || mood === 'Annoyed') {
    runBurstWeight = 0
    stalkPounceWeight = 0
  }

  // ── Time-of-day modifiers ──
  if (period === 'morning') {
    stretchWeight *= (1 + shift)
    wakeStretchWeight *= (1 + shift)
    yawnWeight *= (1 + shift)
    runBurstWeight *= (1 + shift / 2)
  } else if (period === 'evening') {
    runBurstWeight *= (1 - shift / 2)
  } else if (period === 'night') {
    napElsewhereWeight *= (1 + shift)
    yawnWeight *= (1 + shift)
    runBurstWeight *= (1 - shift)
    stalkPounceWeight *= (1 - shift)
  }

  // ── Requirement gates ──
  const canNap = energy < 40 || mood === 'Sleepy' || period === 'night'
  if (!canNap) napElsewhereWeight = 0

  const canRun = energy >= 45 && mood !== 'Sleepy' && mood !== 'Lonely' && mood !== 'Annoyed'
  if (!canRun) runBurstWeight = 0

  const canStalk = energy >= 40 && mood !== 'Sleepy' && mood !== 'Lonely' && mood !== 'Annoyed'
  if (!canStalk) stalkPounceWeight = 0

  const base = [
    { pose: 'groom', type: 'loop', duration: getAnimationDuration('groom'), weight: groomWeight },
    { pose: 'yawn', type: 'oneshot', duration: getAnimationDuration('yawn'), weight: yawnWeight },
    { pose: 'proud', type: 'loop', duration: getAnimationDuration('proud'), weight: proudWeight },
    { pose: 'play', type: 'loop', duration: getAnimationDuration('play'), weight: playWeight },
    { pose: 'toyplay', type: 'loop', duration: getAnimationDuration('toyplay'), weight: toyplayWeight },
    { pose: 'curious', type: 'loop', duration: getAnimationDuration('curious'), weight: curiousWeight },
    // Life chains
    { id: 'lookaround', pose: 'lookaround', type: 'oneshot', isChain: true, weight: lookaroundWeight },
    { id: 'tailflick', pose: 'tailflick', type: 'oneshot', isChain: true, weight: tailflickWeight },
    { id: 'stretch_in_place', pose: 'stretch_in_place', isChain: true, weight: stretchWeight },
    { id: 'wake_stretch', pose: 'wake_stretch', isChain: true, weight: wakeStretchWeight },
    { id: 'patrol', pose: 'patrol', isChain: true, weight: patrolWeight },
    { id: 'walk_then_act', pose: 'walk_then_act', isChain: true, weight: walkThenActWeight },
    { id: 'stalk_pounce', pose: 'stalk_pounce', isChain: true, weight: stalkPounceWeight },
    { id: 'run_burst', pose: 'run_burst', isChain: true, weight: runBurstWeight },
    { id: 'nap_elsewhere', pose: 'nap_elsewhere', isChain: true, weight: napElsewhereWeight },
  ]
  if (mods.sadWeight > 0) {
    base.push({ pose: 'sad', type: 'oneshot', duration: getAnimationDuration('sad'), weight: mods.sadWeight })
  }
  return base.filter((item) => item.weight > 0)
}

// Click vs drag distinction
const CLICK_MAX_DISTANCE = 5     // pixels
const CLICK_MAX_DURATION = 300   // ms
export const DRAG_START_THRESHOLD_PX = 5

const DEBUG_MOVE_WINDOW = false


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
const LISTENING_ANIMATIONS = ['idle', 'idle-old', 'walk', 'talk', 'eat', 'pet', 'typing', 'typingfast', 'play']

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
  onPetStart,
  onEatStart,
  onFeedComplete,
  onLeftClickReact,
  onWakeUpClick,
  onTriggerRemark,
  onCallMeow,
  onLaunchMeow,
  developerMode = false,
  moodEnabled = true,
  moodIndicator = 'hover',
  catRemarks = true,
  catSize = 100,
}) {
  const containerRef = useRef(null)
  
  const clampedOpacity = Math.min(
    100,
    Math.max(20, typeof catOpacity === 'number' ? catOpacity : 100)
  )
  const effectiveOpacity = clampedOpacity / 100
  const effectiveFps = reduceResourceUsage ? 30 : (animationFps || 60)
  const isDebug = Boolean(developerMode) || process.env.NODE_ENV === 'development' || (typeof process !== 'undefined' && process.env?.SCREEN_BUDDY_DEBUG === '1')
  const isDebugRef = useRef(isDebug)
  isDebugRef.current = isDebug
  

  const [cursorOffset, setCursorOffset] = useState(null)
  const [pose, setPose] = useState('idle')
  const [x, setX] = useState(() => Number.isFinite(initialPosition?.x) ? initialPosition.x : defaultPosition().x)
  const [y, setY] = useState(() => Number.isFinite(initialPosition?.y) ? initialPosition.y : defaultPosition().y)
  const [walkMs, setWalkMs] = useState(0)
  const [walkSpeedRate, setWalkSpeedRate] = useState(1)
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
  const lastActivityEndRef = useRef(Date.now())
  const justDroppedRef = useRef(false)

  // Idle behavior timeout ref
  const idleBehaviorTimeoutRef = useRef(null)
  const eatTimeoutRef = useRef(null)

  // One-shot animation and pose management refs
  const oneShotPoseRef = useRef(null)
  const oneShotTimeoutRef = useRef(null)
  const oneShotCallbackRef = useRef(null)
  const [oneShotPose, setOneShotPose] = useState(null)

  // Chase and movement tracking refs
  const facingRef = useRef('right')
  const chaseFlippedRef = useRef(null)
  const isChasingRef = useRef(false)
  const lastChaseTimeRef = useRef(0)
  const cursorHistoryRef = useRef([])
  const chaseStartTimeoutRef = useRef(null)
  const chaseRafRef = useRef(null)
  const lastIdleBehaviorRef = useRef(null)

  // Life chain refs
  const chainTokenRef = useRef(0)
  const isChainActiveRef = useRef(false)
  const activeChainIdRef = useRef(null)
  const lastLifeChainIdRef = useRef(null)
  const chainTimeoutsRef = useRef([])
  const postureRef = useRef('sit')
  const standingFacingRef = useRef('right')
  const standSafetyTimeoutRef = useRef(null)
  const lastSeatedTimeRef = useRef(Date.now())
  const startLifeChainRef = useRef(null)
  const cancelActiveLifeChainRef = useRef(null)
  const scheduleStandSafetyNetRef = useRef(null)
  const executeChainMoveRef = useRef(null)
  const currentDrawnAnimRef = useRef('idle')
  const shownListenersRef = useRef(new Set())
  const onceAnimEndListenersRef = useRef(new Set())
  const restartIdleVariantTimerRef = useRef(null)
  const suppressWakeStretchRef = useRef(false)
  const waitForAnimShownRef = useRef(null)
  const playOnceAnimationRef = useRef(null)
  const ensureStandingRef = useRef(null)
  const ensureSittingRef = useRef(null)
  const performMovementRef = useRef(null)
  const getStrideForAnimRef = useRef(null)
  const strideOverridesRef = useRef({
    walk: null,
    stalk: null,
    run: null
  })
  const moveHistoryRef = useRef([])

  // Wakeup from sleep transition refs
  const wakingUpRef = useRef(false)
  const wakeTargetPoseRef = useRef(null)
  const wakeCallbackRef = useRef(null)
  const lastTypingEventTimeRef = useRef(0)

  // Calm window after pet & call walk timeout refs
  const calmUntilRef = useRef(0)
  const callWalkTimeoutRef = useRef(null)

  // Idle variant alternating between 'old' (2-frame blink) and 'new' (6-frame ear twitch)
  const [idleVariant, setIdleVariant] = useState('old')

  // Battery and launch refs
  const isLowBatteryRef = useRef(false)
  const lastLowBatteryRemarkRef = useRef(0)
  const hasLaunchedRef = useRef(false)
  
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

  const scheduleStandSafetyNet = useCallback(() => {
    if (standSafetyTimeoutRef.current) {
      clearTimeout(standSafetyTimeoutRef.current)
      standSafetyTimeoutRef.current = null
    }
    if (postureRef.current === 'stand' && !isChainActiveRef.current) {
      standSafetyTimeoutRef.current = setTimeout(() => {
        standSafetyTimeoutRef.current = null
        if (postureRef.current === 'stand' && !isChainActiveRef.current) {
          if (isDebugRef.current) {
            console.log('[life] Stand safety net triggered: playing sitdown')
          }
          if (roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) {
            postureRef.current = 'sit'
            lastSeatedTimeRef.current = Date.now()
            poseRef.current = 'idle'
            setPose('idle')
          } else {
            standingFacingRef.current = 'right'
            poseRef.current = 'sitdown'
            setPose('sitdown')
            setTimeout(() => {
              postureRef.current = 'sit'
              lastSeatedTimeRef.current = Date.now()
              poseRef.current = 'idle'
              setPose('idle')
            }, 1000)
          }
        }
      }, 3000)
    }
  }, [])
  scheduleStandSafetyNetRef.current = scheduleStandSafetyNet

  const cancelActiveLifeChain = useCallback((reason = 'interrupted') => {
    if (!isChainActiveRef.current) return
    if (isDebugRef.current) {
      console.log(`[life] chain ${activeChainIdRef.current || 'unknown'} abort ${reason}`)
    }
    chainTokenRef.current += 1
    isChainActiveRef.current = false
    activeChainIdRef.current = null
    chainTimeoutsRef.current.forEach((t) => {
      if (typeof t === 'function') t()
      else clearTimeout(t)
    })
    chainTimeoutsRef.current = []
    if (walkTweenRef.current) {
      walkTweenRef.current = null
      setWalkMs(0)
      setWalkSpeedRate(1)
    }
    scheduleStandSafetyNetRef.current?.()
  }, [])
  cancelActiveLifeChainRef.current = cancelActiveLifeChain

  const cancelIdleAndOneShot = useCallback(() => {
    cancelActiveLifeChainRef.current?.('cancelIdleAndOneShot')
    clearTimeout(idleBehaviorTimeoutRef.current)
    idleBehaviorTimeoutRef.current = null
    clearTimeout(oneShotTimeoutRef.current)
    oneShotTimeoutRef.current = null
    oneShotPoseRef.current = null
    setOneShotPose(null)
    oneShotCallbackRef.current = null
    if (chaseStartTimeoutRef.current) {
      clearTimeout(chaseStartTimeoutRef.current)
      chaseStartTimeoutRef.current = null
    }
    if (chaseRafRef.current) {
      cancelAnimationFrame(chaseRafRef.current)
      chaseRafRef.current = null
    }
    if (callWalkTimeoutRef.current) {
      clearTimeout(callWalkTimeoutRef.current)
      callWalkTimeoutRef.current = null
    }
    chaseFlippedRef.current = null
    isChasingRef.current = false
  }, [])

  // ── Helper: play a one-shot animation (yawn, pounce, wakeup, crouchpounce, etc.) ──
  const playOneShot = useCallback((animName, onComplete) => {
    let targetAnim = animName
    if (targetAnim === 'crouch' || targetAnim === 'pounce') {
      targetAnim = 'crouchpounce'
    }
    cancelIdleAndOneShot()
    oneShotPoseRef.current = targetAnim
    setOneShotPose(targetAnim)
    oneShotCallbackRef.current = onComplete || null

    const duration = getAnimationDuration(targetAnim, catAnimationSpeed)
    if (oneShotTimeoutRef.current) clearTimeout(oneShotTimeoutRef.current)
    oneShotTimeoutRef.current = setTimeout(() => {
      oneShotTimeoutRef.current = null
      if (oneShotPoseRef.current === targetAnim) {
        oneShotPoseRef.current = null
        setOneShotPose(null)
        lastActivityEndRef.current = Date.now()
        const cb = oneShotCallbackRef.current
        oneShotCallbackRef.current = null
        cb?.()
      }
    }, duration)
  }, [cancelIdleAndOneShot, catAnimationSpeed])

  const wakeTo = useCallback((targetPose, onDone) => {
    lastInteractRef.current = Date.now()
    if (poseRef.current !== 'sleep' && !wakingUpRef.current) {
      if (targetPose && poseRef.current !== targetPose) {
        poseRef.current = targetPose
        setPose(targetPose)
      }
      onDone?.()
      return
    }

    if (wakingUpRef.current) {
      wakeTargetPoseRef.current = targetPose
      if (onDone) wakeCallbackRef.current = onDone
      return
    }

    wakingUpRef.current = true
    wakeTargetPoseRef.current = targetPose
    wakeCallbackRef.current = onDone || null

    cancelIdleAndOneShot()
    playOneShot('wakeup', () => {
      wakingUpRef.current = false
      let nextPose = wakeTargetPoseRef.current || 'idle'
      wakeTargetPoseRef.current = null
      if ((nextPose === 'typing' || nextPose === 'typingfast') && Date.now() - lastTypingEventTimeRef.current > 800) {
        nextPose = 'idle'
      }
      poseRef.current = nextPose
      setPose(nextPose)
      const cb = wakeCallbackRef.current
      wakeCallbackRef.current = null
      cb?.()

      if (nextPose === 'idle' && !suppressWakeStretchRef.current && !isChainActiveRef.current && Math.random() < 0.60 && !roamBlockedRef.current && !draggingRef.current) {
        startLifeChainRef.current?.('wake_stretch')
      }
    })
  }, [cancelIdleAndOneShot, playOneShot])
  const wakeToRef = useRef(wakeTo)
  wakeToRef.current = wakeTo

  const wakeUp = useCallback(() => {
    wakeTo('idle')
  }, [wakeTo])

  const markInteraction = useCallback(() => {
    cancelIdleAndOneShot()
    wakeUp()
  }, [wakeUp, cancelIdleAndOneShot])

  const handleAnimationEnd = useCallback((anim) => {
    let animName = anim
    if (animName === 'crouch' || animName === 'pounce') {
      animName = 'crouchpounce'
    }
    const listeners = Array.from(onceAnimEndListenersRef.current)
    for (const listener of listeners) {
      try {
        listener(animName)
      } catch (err) {
        console.error('[life] error in animEnd listener', err)
      }
    }

    if (ONE_SHOT_ANIMATIONS.has(animName) && oneShotPoseRef.current === animName) {
      if (oneShotTimeoutRef.current) clearTimeout(oneShotTimeoutRef.current)
      oneShotTimeoutRef.current = setTimeout(() => {
        oneShotTimeoutRef.current = null
        if (oneShotPoseRef.current === animName) {
          oneShotPoseRef.current = null
          setOneShotPose(null)
          lastActivityEndRef.current = Date.now()
          const cb = oneShotCallbackRef.current
          oneShotCallbackRef.current = null
          cb?.()
        }
      }, 800)
    }
  }, [])

  const handleSpriteShown = useCallback((animName) => {
    currentDrawnAnimRef.current = animName
    const listeners = Array.from(shownListenersRef.current)
    for (const listener of listeners) {
      try {
        listener(animName)
      } catch (err) {
        console.error('[life] error in shown listener', err)
      }
    }
  }, [])

  const waitForAnimShown = useCallback((expectedAnim, onShownReady) => {
    let fired = false
    let fallbackTimer = null

    const done = () => {
      if (fired) return
      fired = true
      if (fallbackTimer) clearTimeout(fallbackTimer)
      shownListenersRef.current.delete(listener)
      onShownReady()
    }

    const listener = (anim) => {
      if (anim === expectedAnim) {
        done()
      }
    }

    shownListenersRef.current.add(listener)
    fallbackTimer = setTimeout(done, 400)
    return () => {
      if (fallbackTimer) clearTimeout(fallbackTimer)
      shownListenersRef.current.delete(listener)
    }
  }, [])
  waitForAnimShownRef.current = waitForAnimShown

  const playOnceAnimation = useCallback((token, animName, onFinish) => {
    let completed = false
    let fallbackTimer = null
    let cancelShown = null

    const finish = () => {
      if (completed || (token && chainTokenRef.current !== token)) return
      completed = true
      if (fallbackTimer) clearTimeout(fallbackTimer)
      if (cancelShown) cancelShown()
      onceAnimEndListenersRef.current.delete(listener)
      onFinish()
    }

    const listener = (anim) => {
      if (anim === animName) {
        finish()
      }
    }

    onceAnimEndListenersRef.current.add(listener)

    poseRef.current = animName
    setPose(animName)

    cancelShown = waitForAnimShown(animName, () => {
      if (completed || (token && chainTokenRef.current !== token)) return
      const duration = getAnimationDuration(animName, catAnimationSpeed)
      const fallbackMs = duration + 300
      fallbackTimer = setTimeout(finish, fallbackMs)
      if (token) {
        chainTimeoutsRef.current.push(fallbackTimer)
      }
    })
  }, [waitForAnimShown, catAnimationSpeed])
  playOnceAnimationRef.current = playOnceAnimation

  // ── Helper: start an idle behavior pose for a duration, then return to idle ──
  const startIdleBehavior = useCallback((behaviorPose, durationMs) => {
    cancelIdleAndOneShot()
    poseRef.current = behaviorPose
    setPose(behaviorPose)
    const duration = getAnimationDuration(behaviorPose, catAnimationSpeed) || durationMs || 3000
    if (idleBehaviorTimeoutRef.current) clearTimeout(idleBehaviorTimeoutRef.current)
    idleBehaviorTimeoutRef.current = setTimeout(() => {
      // Only revert if still in the behavior pose (wasn't interrupted)
      if (poseRef.current === behaviorPose) {
        poseRef.current = 'idle'
        setPose('idle')
      }
      idleBehaviorTimeoutRef.current = null
      lastActivityEndRef.current = Date.now()
    }, duration)
  }, [cancelIdleAndOneShot, catAnimationSpeed])

  const playOneShotRef = useRef(playOneShot)
  playOneShotRef.current = playOneShot
  const startIdleBehaviorRef = useRef(startIdleBehavior)
  startIdleBehaviorRef.current = startIdleBehavior

  const isIdleForRemarks = Boolean(
    pose === 'idle' &&
    !oneShotPose &&
    !dragging &&
    !isReminder &&
    chatState === 'idle' &&
    !paused
  )

  const {
    mood,
    stats,
    recentMoodChange,
    handlePetStart: moodHandlePetStart,
    handlePetStateChange: moodHandlePetStateChange,
    handleBodyClick: moodHandleBodyClick,
    handleShortcutCall: moodHandleShortcutCall,
    handleChatReply: moodHandleChatReply,
  } = useMood({
    moodEnabled,
    hungerState,
    isSleeping: pose === 'sleep',
    catRemarks,
    onTriggerRemark,
    playOneShot,
    developerMode,
    isIdleForRemarks,
  })

  // Log mood changes and initial state on mount
  useEffect(() => {
    console.log(`[mood] enabled=${moodEnabled} indicator=${moodIndicator} mood=${mood} stats=${JSON.stringify(stats)}`)
  }, [moodEnabled, moodIndicator, mood, stats])

  const moodRef = useRef(mood)
  moodRef.current = mood
  const statsRef = useRef(stats)
  statsRef.current = stats
  const moodEnabledRef = useRef(moodEnabled)
  moodEnabledRef.current = moodEnabled
  const lastKnockoffRef = useRef(0)
  const lastGiftRef = useRef(0)

  const ensureStanding = (token, onReady) => {
    if (token && chainTokenRef.current !== token) return
    if (postureRef.current === 'stand') {
      onReady()
      return
    }
    postureRef.current = 'stand'
    standingFacingRef.current = 'right'
    playOnceAnimationRef.current?.(token, 'standup', () => {
      if (token && chainTokenRef.current !== token) return
      poseRef.current = 'standidle'
      setPose('standidle')
      onReady()
    })
  }
  ensureStandingRef.current = ensureStanding

  const ensureSitting = (token, onReady) => {
    if (token && chainTokenRef.current !== token) return
    if (postureRef.current === 'sit') {
      onReady()
      return
    }
    standingFacingRef.current = 'right'
    playOnceAnimationRef.current?.(token, 'sitdown', () => {
      if (token && chainTokenRef.current !== token) return
      postureRef.current = 'sit'
      lastSeatedTimeRef.current = Date.now()
      poseRef.current = 'idle'
      setPose('idle')
      restartIdleVariantTimerRef.current?.('new')
      lastActivityEndRef.current = Date.now()
      onReady()
    })
  }
  ensureSittingRef.current = ensureSitting

  const getStrideForAnim = (anim) => {
    const override = strideOverridesRef.current?.[anim]
    if (typeof override === 'number' && override > 0) return override
    const base = anim === 'stalk' ? STALK_PX_PER_CYCLE : anim === 'run' ? RUN_PX_PER_CYCLE : WALK_PX_PER_CYCLE
    return Math.round(base * ((catSize || 100) / 100))
  }
  getStrideForAnimRef.current = getStrideForAnim

  const performMovement = ({
    anim = 'walk',
    distanceOrTarget,
    speedRange,
    edgeMargin = 40,
    token = null,
    gen = null,
    forcedDir = null,
    onArrive,
    onAbort
  }) => {
    if (token && chainTokenRef.current !== token) return
    if (gen && gen !== roamGenRef.current) return

    const screenW = window.screen.availWidth || window.screen.width || 1920
    const catW = measure().width
    const minX = edgeMargin
    const maxX = Math.max(minX, screenW - catW - edgeMargin)
    const currentX = posRef.current.x

    let targetX
    let dir
    let plannedDist
    let realDist

    if (
      typeof distanceOrTarget === 'object' &&
      distanceOrTarget !== null &&
      !Array.isArray(distanceOrTarget) &&
      typeof distanceOrTarget.targetX === 'number'
    ) {
      const plannedTargetX = distanceOrTarget.targetX
      targetX = clamp(plannedTargetX, minX, maxX)
      dir = forcedDir || (targetX < currentX ? 'left' : 'right')
      plannedDist = Math.abs(plannedTargetX - currentX)
      realDist = Math.abs(targetX - currentX)
    } else if (typeof distanceOrTarget === 'number' && distanceOrTarget > 500) {
      const plannedTargetX = distanceOrTarget
      targetX = clamp(plannedTargetX, minX, maxX)
      dir = forcedDir || (targetX < currentX ? 'left' : 'right')
      plannedDist = Math.abs(plannedTargetX - currentX)
      realDist = Math.abs(targetX - currentX)
    } else if (typeof distanceOrTarget === 'number' && forcedDir) {
      plannedDist = Math.abs(distanceOrTarget)
      dir = forcedDir
      const plannedTargetX = dir === 'left' ? currentX - plannedDist : currentX + plannedDist
      targetX = clamp(plannedTargetX, minX, maxX)
      realDist = Math.abs(targetX - currentX)
    } else if (typeof distanceOrTarget === 'number' && !Array.isArray(distanceOrTarget)) {
      plannedDist = Math.abs(distanceOrTarget)
      dir = distanceOrTarget < 0
        ? 'left'
        : (currentX <= minX + 24 ? 'right' : (currentX >= maxX - 24 ? 'left' : (Math.random() < 0.5 ? 'left' : 'right')))
      const plannedTargetX = dir === 'left' ? currentX - plannedDist : currentX + plannedDist
      targetX = clamp(plannedTargetX, minX, maxX)
      realDist = Math.abs(targetX - currentX)
    } else {
      const [distMin, distMax] = Array.isArray(distanceOrTarget) ? distanceOrTarget : [80, 260]
      plannedDist = randBetween(distMin, distMax)
      dir = forcedDir || (Math.random() < 0.5 ? 'left' : 'right')
      if (!forcedDir && currentX <= minX + 24) dir = 'right'
      if (!forcedDir && currentX >= maxX - 24) dir = 'left'

      const plannedTargetX = dir === 'left' ? currentX - plannedDist : currentX + plannedDist
      targetX = clamp(plannedTargetX, minX, maxX)
      realDist = Math.abs(targetX - currentX)

      if (!forcedDir && realDist < 40) {
        const oppDir = dir === 'left' ? 'right' : 'left'
        const oppTargetX = clamp(oppDir === 'left' ? currentX - plannedDist : currentX + plannedDist, minX, maxX)
        const oppDist = Math.abs(oppTargetX - currentX)
        if (oppDist >= 40) {
          dir = oppDir
          targetX = oppTargetX
          realDist = oppDist
        }
      }
    }

    if (realDist < 30) {
      if (isDebugRef.current) {
        console.log(`[move] anim=${anim} skipped: real=${realDist.toFixed(1)}px < 30px (planned=${plannedDist.toFixed(1)}px)`)
      }
      onArrive?.()
      return
    }

    standingFacingRef.current = dir
    facingRef.current = dir

    const effectiveSpeedRange = speedRange || (
      anim === 'stalk'
        ? [STALK_SPEED_MIN_PX_S, STALK_SPEED_MAX_PX_S]
        : anim === 'run'
          ? [RUN_SPEED_MIN_PX_S, RUN_SPEED_MAX_PX_S]
          : [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S]
    )

    const speedMult = getMovementSpeedMultiplier(statsRef.current?.energy ?? 100, new Date())
    const nominalSpeed = randBetween(effectiveSpeedRange[0], effectiveSpeedRange[1]) * speedMult

    const duration = (realDist / nominalSpeed) * 1000
    const groundSpeed = realDist / (duration / 1000)

    const baseFps = anim === 'stalk' ? 8 : anim === 'run' ? 14 : 12
    const totalFrames = 8
    const stridePxPerCycle = getStrideForAnim(anim)

    const calculatedRate = groundSpeed / (stridePxPerCycle * (baseFps / totalFrames))
    const minRate = anim === 'walk' ? 0.4 : 0.5
    const rate = clamp(calculatedRate, minRate, 1.5)
    setWalkSpeedRate(rate)

    const cycles = (duration / 1000) * (baseFps * rate / totalFrames)
    const impliedPxPerCycle = cycles > 0 ? (realDist / cycles) : stridePxPerCycle

    const moveRecord = {
      anim,
      plannedPx: Number(plannedDist.toFixed(1)),
      realPx: Number(realDist.toFixed(1)),
      durationMs: Math.round(duration),
      speedPxS: Number(groundSpeed.toFixed(1)),
      rate: Number(rate.toFixed(2)),
      impliedCycles: Number(cycles.toFixed(2)),
      impliedPxPerCycle: Number(impliedPxPerCycle.toFixed(1))
    }
    moveHistoryRef.current.push(moveRecord)
    if (moveHistoryRef.current.length > 5) {
      moveHistoryRef.current.shift()
    }

    if (isDebugRef.current) {
      console.log(`[move] anim=${anim} planned=${plannedDist.toFixed(1)} real=${realDist.toFixed(1)} duration=${Math.round(duration)} speed=${groundSpeed.toFixed(1)} rate=${rate.toFixed(2)} cycles=${cycles.toFixed(2)}`)
    }

    const movePose = anim === 'walk'
      ? (dir === 'left' ? 'walk-left' : 'walk-right')
      : (dir === 'left' ? `${anim}-left` : `${anim}-right`)
    poseRef.current = movePose
    setPose(movePose)

    let moveEnded = false
    let fallbackTimeout = null

    const finishMove = (reason = 'complete') => {
      if (moveEnded) return
      if (token && chainTokenRef.current !== token) return
      if (gen && gen !== roamGenRef.current) return
      moveEnded = true
      if (fallbackTimeout) {
        clearTimeout(fallbackTimeout)
        fallbackTimeout = null
      }
      walkTweenRef.current = null
      setWalkMs(0)
      setWalkSpeedRate(1)
      if (postureRef.current === 'stand') {
        poseRef.current = 'standidle'
        setPose('standidle')
      }
      triggerAccentRef.current('is-squash')
      lastActivityEndRef.current = Date.now()
      if (reason === 'blocked') {
        onAbort?.('blocked during move')
      } else {
        onArrive?.()
      }
    }

    const cancelShown = waitForAnimShownRef.current?.(anim, () => {
      if (moveEnded) return
      if (token && chainTokenRef.current !== token) return
      if (gen && (gen !== roamGenRef.current || roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current)) {
        scheduleStandSafetyNetRef.current?.()
        return
      }

      setWalkMs(duration)
      triggerAccentRef.current('is-stretch')

      walkTweenRef.current = {
        startX: posRef.current.x,
        targetX,
        startTime: performance.now(),
        duration,
        onComplete: () => {
          finishMove('complete')
        }
      }
      dragTargetRef.current = { x: targetX, y: posRef.current.y }

      fallbackTimeout = setTimeout(() => {
        if (token && chainTokenRef.current !== token) return
        if (gen && gen !== roamGenRef.current) return
        if (roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) {
          finishMove('blocked')
        } else {
          finishMove('complete')
        }
      }, duration + 100)
      if (token) {
        chainTimeoutsRef.current.push(fallbackTimeout)
      }
    })
    if (cancelShown && token) {
      chainTimeoutsRef.current.push(cancelShown)
    }
  }
  performMovementRef.current = performMovement

  const executeChainMove = (token, anim, distanceOrTarget, pxPerCycle, speedRange, edgeMargin, onArrive, onAbort) => {
    performMovement({
      anim,
      distanceOrTarget,
      speedRange,
      edgeMargin,
      token,
      onArrive,
      onAbort
    })
  }
  executeChainMoveRef.current = executeChainMove

  const startLifeChain = useCallback((chainId, isDebugOverride = false, forcedActionX = null) => {
    if (isChainActiveRef.current) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort active chain already running`)
      return false
    }
    if (
      poseRef.current === 'sleep' ||
      wakingUpRef.current ||
      poseRef.current !== 'idle' ||
      oneShotPoseRef.current ||
      postureRef.current !== 'sit' ||
      draggingRef.current ||
      dragPointerDownRef.current ||
      fallRafRef.current ||
      falling ||
      poseRef.current === 'eat' ||
      eatTimeoutRef.current
    ) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort not seated idle (pose=${poseRef.current}, posture=${postureRef.current})`)
      return false
    }
    if (mediaPlayingRef.current) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort listening (headphones)`)
      return false
    }
    if (isReminder || notificationVisible || chatState !== 'idle') {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort reminder/bubble active`)
      return false
    }
    if (roamBlockedRef.current) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort roam blocked`)
      return false
    }
    if (moodRef.current === 'Annoyed') {
      const isPlayful = chainId === 'run_burst' || chainId === 'stalk_pounce' || (chainId === 'walk_then_act' && forcedActionX === 'toyplay')
      if (isPlayful) {
        if (isDebugRef.current) console.log(`[life] chain ${chainId} abort annoyed mood`)
        return false
      }
    }

    if (!isDebugOverride && chainId === lastLifeChainIdRef.current) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort duplicate chain`)
      return false
    }

    const token = ++chainTokenRef.current
    isChainActiveRef.current = true
    activeChainIdRef.current = chainId
    lastLifeChainIdRef.current = chainId
    if (standSafetyTimeoutRef.current) {
      clearTimeout(standSafetyTimeoutRef.current)
      standSafetyTimeoutRef.current = null
    }

    if (isDebugRef.current) {
      console.log(`[life] chain ${chainId} start`)
    }

    const completedSteps = new Set()
    const advanceStep = (stepIndex, fn) => {
      if (chainTokenRef.current !== token) return
      if (completedSteps.has(stepIndex)) return
      completedSteps.add(stepIndex)
      fn()
    }

    const chainLater = (fn, ms) => {
      const t = setTimeout(() => {
        if (chainTokenRef.current !== token) return
        fn()
      }, ms)
      chainTimeoutsRef.current.push(t)
      return t
    }

    let chainEnded = false
    const endChain = (reason = 'complete') => {
      if (chainEnded || chainTokenRef.current !== token) return
      chainEnded = true
      isChainActiveRef.current = false
      activeChainIdRef.current = null
      lastActivityEndRef.current = Date.now()
      if (isDebugRef.current) {
        if (reason === 'complete') {
          console.log(`[life] chain ${chainId} end`)
        } else {
          console.log(`[life] chain ${chainId} abort ${reason}`)
        }
      }
      scheduleStandSafetyNetRef.current?.()
    }

    if (chainId === 'stretch_in_place' || chainId === 'wake_stretch') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log(`[life] chain ${chainId} step 1 standup`)
        ensureStandingRef.current?.(token, () => {
          advanceStep(2, () => {
            if (isDebugRef.current) console.log(`[life] chain ${chainId} step 2 stretch`)
            playOnceAnimationRef.current?.(token, 'stretch', () => {
              advanceStep(3, () => {
                if (isDebugRef.current) console.log(`[life] chain ${chainId} step 3 standidle`)
                poseRef.current = 'standidle'
                setPose('standidle')
                waitForAnimShownRef.current?.('standidle', () => {
                  chainLater(() => {
                    advanceStep(4, () => {
                      if (isDebugRef.current) console.log(`[life] chain ${chainId} step 4 sitdown`)
                      ensureSittingRef.current?.(token, () => {
                        endChain('complete')
                      })
                    })
                  }, randBetween(1000, 3000))
                })
              })
            })
          })
        })
      })
    } else if (chainId === 'patrol') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain patrol step 1 standup')
        ensureStandingRef.current?.(token, () => {
          advanceStep(2, () => {
            if (isDebugRef.current) console.log('[life] chain patrol step 2 walk')
            executeChainMoveRef.current(
              token,
              'walk',
              [80, 260],
              WALK_PX_PER_CYCLE,
              [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S],
              40,
              () => {
                advanceStep(3, () => {
                  if (isDebugRef.current) console.log('[life] chain patrol step 3 standidle')
                  poseRef.current = 'standidle'
                  setPose('standidle')
                  waitForAnimShownRef.current?.('standidle', () => {
                    chainLater(() => {
                      advanceStep(4, () => {
                        if (isDebugRef.current) console.log('[life] chain patrol step 4 sitdown')
                        ensureSittingRef.current?.(token, () => {
                          if (Math.random() < 0.50) {
                            advanceStep(5, () => {
                              if (isDebugRef.current) console.log('[life] chain patrol step 5 lookaround')
                              playOnceAnimationRef.current?.(token, 'lookaround', () => {
                                poseRef.current = 'idle'
                                setPose('idle')
                                endChain('complete')
                              })
                            })
                          } else {
                            endChain('complete')
                          }
                        })
                      })
                    }, randBetween(1500, 4000))
                  })
                })
              },
              (abortReason) => {
                endChain(abortReason)
              }
            )
          })
        })
      })
    } else if (chainId === 'walk_then_act') {
      let actionX = forcedActionX
      const allowedActions = ['toyplay', 'groom', 'yawn', 'curious']
      if (!actionX || !allowedActions.includes(actionX)) {
        const candidates = allowedActions.filter(
          (a) => moodRef.current !== 'Annoyed' || a !== 'toyplay'
        )
        actionX = candidates[Math.floor(Math.random() * candidates.length)]
      }
      if (moodRef.current === 'Annoyed' && actionX === 'toyplay') {
        actionX = 'groom'
      }
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain walk_then_act step 1 standup')
        ensureStandingRef.current?.(token, () => {
          advanceStep(2, () => {
            if (isDebugRef.current) console.log('[life] chain walk_then_act step 2 walk')
            executeChainMoveRef.current(
              token,
              'walk',
              [60, 200],
              WALK_PX_PER_CYCLE,
              [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S],
              40,
              () => {
                advanceStep(3, () => {
                  if (isDebugRef.current) console.log('[life] chain walk_then_act step 3 sitdown')
                  ensureSittingRef.current?.(token, () => {
                    advanceStep(4, () => {
                      if (isDebugRef.current) console.log(`[life] chain walk_then_act step 4 ${actionX}`)
                      playOnceAnimationRef.current?.(token, actionX, () => {
                        poseRef.current = 'idle'
                        setPose('idle')
                        endChain('complete')
                      })
                    })
                  })
                })
              },
              (abortReason) => {
                endChain(abortReason)
              }
            )
          })
        })
      })
    } else if (chainId === 'stalk_pounce') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain stalk_pounce step 1 standup')
        ensureStandingRef.current?.(token, () => {
          advanceStep(2, () => {
            if (isDebugRef.current) console.log('[life] chain stalk_pounce step 2 stalk')
            executeChainMoveRef.current(
              token,
              'stalk',
              [80, 200],
              STALK_PX_PER_CYCLE,
              [STALK_SPEED_MIN_PX_S, STALK_SPEED_MAX_PX_S],
              40,
              () => {
                advanceStep(3, () => {
                  if (isDebugRef.current) console.log('[life] chain stalk_pounce step 3 crouchpounce')
                  playOnceAnimationRef.current?.(token, 'crouchpounce', () => {
                    postureRef.current = 'sit'
                    lastSeatedTimeRef.current = Date.now()
                    poseRef.current = 'idle'
                    setPose('idle')
                    restartIdleVariantTimerRef.current?.('new')
                    endChain('complete')
                  })
                })
              },
              (abortReason) => {
                endChain(abortReason)
              }
            )
          })
        })
      })
    } else if (chainId === 'run_burst') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain run_burst step 1 standup')
        ensureStandingRef.current?.(token, () => {
          const totalLegs = Math.floor(randBetween(1, 3.99))
          let currentLeg = 0
          const runNextLeg = () => {
            if (chainTokenRef.current !== token) return
            currentLeg += 1
            if (isDebugRef.current) {
              console.log(`[life] chain run_burst step 2 run (leg ${currentLeg}/${totalLegs})`)
            }
            executeChainMoveRef.current(
              token,
              'run',
              [100, 260],
              RUN_PX_PER_CYCLE,
              [RUN_SPEED_MIN_PX_S, RUN_SPEED_MAX_PX_S],
              60,
              () => {
                if (currentLeg < totalLegs) {
                  chainLater(runNextLeg, 100)
                } else {
                  advanceStep(3, () => {
                    if (isDebugRef.current) console.log('[life] chain run_burst step 3 standidle')
                    poseRef.current = 'standidle'
                    setPose('standidle')
                    waitForAnimShownRef.current?.('standidle', () => {
                      chainLater(() => {
                        advanceStep(4, () => {
                          if (isDebugRef.current) console.log('[life] chain run_burst step 4 sitdown')
                          ensureSittingRef.current?.(token, () => {
                            endChain('complete')
                          })
                        })
                      }, randBetween(1000, 2000))
                    })
                  })
                }
              },
              (abortReason) => {
                endChain(abortReason)
              }
            )
          }
          runNextLeg()
        })
      })
    } else if (chainId === 'lookaround') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain lookaround step 1 lookaround')
        playOnceAnimationRef.current?.(token, 'lookaround', () => {
          poseRef.current = 'idle'
          setPose('idle')
          endChain('complete')
        })
      })
    } else if (chainId === 'tailflick') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain tailflick step 1 tailflick')
        playOnceAnimationRef.current?.(token, 'tailflick', () => {
          poseRef.current = 'idle'
          setPose('idle')
          endChain('complete')
        })
      })
    } else if (chainId === 'nap_elsewhere') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain nap_elsewhere step 1 standup')
        ensureStandingRef.current?.(token, () => {
          const catW = measure().width
          const screenW = window.screen.availWidth || window.screen.width || 1920
          const minX = 40
          const maxX = Math.max(minX, screenW - catW - 40)
          const currentX = posRef.current.x
          let napTargetX

          const roomLeft = currentX - minX
          const roomRight = maxX - currentX

          if (roomLeft >= 150 && roomRight >= 150) {
            const goLeft = Math.random() < 0.5
            napTargetX = goLeft
              ? randBetween(minX, currentX - 150)
              : randBetween(currentX + 150, maxX)
          } else if (roomRight >= 150) {
            napTargetX = randBetween(currentX + 150, maxX)
          } else if (roomLeft >= 150) {
            napTargetX = randBetween(minX, currentX - 150)
          } else {
            napTargetX = roomRight > roomLeft ? maxX : minX
          }

          advanceStep(2, () => {
            if (isDebugRef.current) console.log('[life] chain nap_elsewhere step 2 walk')
            executeChainMoveRef.current(
              token,
              'walk',
              napTargetX,
              WALK_PX_PER_CYCLE,
              [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S],
              40,
              () => {
                advanceStep(3, () => {
                  if (isDebugRef.current) console.log('[life] chain nap_elsewhere step 3 sitdown')
                  ensureSittingRef.current?.(token, () => {
                    advanceStep(4, () => {
                      if (isDebugRef.current) console.log('[life] chain nap_elsewhere step 4 sleep')
                      setWalkMs(0)
                      poseRef.current = 'sleep'
                      setPose('sleep')
                      endChain('complete')
                    })
                  })
                })
              },
              (abortReason) => {
                endChain(abortReason)
              }
            )
          })
        })
      })
    } else {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort unknown chain id`)
      isChainActiveRef.current = false
      activeChainIdRef.current = null
      return false
    }

    return true
  }, [measure, falling, isReminder, notificationVisible, chatState])

  startLifeChainRef.current = startLifeChain

  const prevChatStateRef = useRef(chatState)
  useEffect(() => {
    if (prevChatStateRef.current !== 'reply' && chatState === 'reply') {
      moodHandleChatReply()
    }
    prevChatStateRef.current = chatState
  }, [chatState, moodHandleChatReply])

  const startEating = useCallback(() => {
    // Interrupt whatever it was doing to eat
    cancelActiveLifeChainRef.current?.('eating')
    walkTweenRef.current = null
    setWalkMs(0)
    clearTimeout(roamTimeoutRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)
    clearTimeout(eatTimeoutRef.current)
    setIsHoveringHead(false)

    const doEat = () => {
      poseRef.current = 'eat'
      setPose('eat')
      onEatStart?.()
      const eatDuration = getAnimationDuration('eat', catAnimationSpeed)
      eatTimeoutRef.current = setTimeout(() => {
        if (poseRef.current === 'eat') {
          poseRef.current = 'idle'
          setPose('idle')
          onFeedComplete?.()
        }
        eatTimeoutRef.current = null
      }, eatDuration)
    }

    if (poseRef.current === 'sleep') {
      wakeTo('eat', doEat)
    } else {
      doEat()
    }
  }, [wakeTo, onEatStart, onFeedComplete, catAnimationSpeed])

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
          wakeTo('idle', () => {
            setRoamEpoch((n) => n + 1)
          })
          onWakeUpClick?.()
        } else if (hungerState === 'ACTIVE') {
          handleFeedTrigger()
        } else {
          triggerAccentRef.current('is-stretch')
          onLeftClickReact?.()
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
  }, [hungerState, handleFeedTrigger, onChatOpen, onTogglePause, wakeTo, onWakeUpClick, onLeftClickReact])

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
      wakeTo('idle')
    }
  }, [mediaPlaying, wakeTo])

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
      if (['eat', 'pet', 'purr', 'play', 'toyplay'].includes(poseRef.current)) {
        return
      }

      const now = Date.now()
      // Keep events for 1000ms for rate calculation
      typingEventsRef.current = typingEventsRef.current.filter(t => now - t < 1000)
      typingEventsRef.current.push(now)
      lastTypingEventTimeRef.current = now
      
      lastInteractRef.current = now

      // Interrupt walking
      if (poseRef.current.startsWith('walk')) {
        walkTweenRef.current = null
        setWalkMs(0)
        clearTimeout(roamTimeoutRef.current)
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

      if (poseRef.current === 'sleep' || wakingUpRef.current) {
        wakeTo(targetPose)
      } else if (!oneShotPoseRef.current) {
        if (poseRef.current !== targetPose) {
          poseRef.current = targetPose
          setPose(targetPose)
        }
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
  }, [isReminder, pomodoroCelebrating, wakeTo])

  // Walk tween is idle-only. Active drag writes pointer coords 1:1 in onDragMove.

  // ── Walk Tween (rAF ease-in-out) ─────────────────────────────────────────
  useEffect(() => {
    let rafId
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

    const step = (now) => {
      if (roamBlockedRef.current) {
        if (isChainActiveRef.current) {
          cancelActiveLifeChainRef.current?.('roam_blocked')
        }
        walkTweenRef.current = null
        setWalkMs(0)
        setWalkSpeedRate(1)
        if (poseRef.current.startsWith('walk') || poseRef.current.startsWith('run') || poseRef.current.startsWith('stalk')) {
          poseRef.current = 'idle'
          setPose('idle')
        }
      }
      const tween = walkTweenRef.current
      if (tween && !draggingRef.current && !dragPointerDownRef.current) {
        const elapsed = now - tween.startTime
        const t = Math.min(1, elapsed / tween.duration)
        const eased = easeInOut(t)
        const targetX = tween.targetX
        const newX = tween.startX + (targetX - tween.startX) * eased
        posRef.current = { x: newX, y: posRef.current.y }
        setX(newX)

        const reachedTarget = t >= 1 || Math.abs(newX - targetX) < 0.5
        if (reachedTarget) {
          const onComplete = tween.onComplete
          walkTweenRef.current = null
          setWalkMs(0)
          setWalkSpeedRate(1)
          if (postureRef.current === 'stand') {
            poseRef.current = 'standidle'
            setPose('standidle')
          } else if (poseRef.current.startsWith('walk') || poseRef.current.startsWith('run') || poseRef.current.startsWith('stalk')) {
            poseRef.current = 'idle'
            setPose('idle')
          }
          triggerAccentRef.current('is-squash')
          lastActivityEndRef.current = Date.now()
          onComplete?.()
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
      if (roamBlockedRef.current) {
        if (isDebugRef.current) {
          console.log('[Mascot] Roam outcome: blocked by guard (roam blocked), next attempt in 2000ms')
        }
        later(walkOnce, 2000)
        return
      }
      if (Date.now() < calmUntilRef.current) {
        const retryDelay = Math.max(500, calmUntilRef.current - Date.now())
        if (isDebugRef.current) {
          console.log(`[Mascot] Roam outcome: blocked by guard (calm window), next attempt in ${Math.round(retryDelay)}ms`)
        }
        later(walkOnce, retryDelay)
        return
      }
      if (draggingRef.current || dragPointerDownRef.current) {
        if (isDebugRef.current) {
          console.log('[Mascot] Roam outcome: blocked by guard (dragging), next attempt in 400ms')
        }
        console.log(`[Renderer] walkOnce deferred (still dragging) gen=${gen}`)
        later(walkOnce, 400)
        return
      }
      if (poseRef.current === 'sleep') {
        if (isDebugRef.current) {
          console.log('[Mascot] Roam outcome: blocked by guard (sleep)')
        }
        return
      }
      // Don't interrupt active idle behaviors or one-shots, or active life chains
      if (
        isChainActiveRef.current ||
        oneShotPoseRef.current ||
        (poseRef.current !== 'idle' && !poseRef.current.startsWith('walk'))
      ) {
        const reason = isChainActiveRef.current ? 'active chain' : oneShotPoseRef.current ? `oneShot ${oneShotPoseRef.current}` : `pose ${poseRef.current}`
        const retryDelay = isChainActiveRef.current ? randBetween(4000, 6000) : randBetween(3000, 5000)
        if (isDebugRef.current) {
          console.log(`[Mascot] Roam outcome: blocked by guard (${reason}), next attempt in ${Math.round(retryDelay)}ms`)
        }
        later(walkOnce, retryDelay)
        return
      }

      const mods = moodModifiers(moodRef.current)
      const idleFor = Date.now() - lastInteractRef.current
      const sleepChance = isLowBatteryRef.current ? Math.min(1, SLEEP_CHANCE * 2) : SLEEP_CHANCE
      const effectiveSleepAfterMs = SLEEP_AFTER_MS * mods.sleepDelay
      if (!mediaPlayingRef.current && idleFor >= effectiveSleepAfterMs && Math.random() < sleepChance) {
        setWalkMs(0)
        poseRef.current = 'sleep'
        setPose('sleep')
        if (isDebugRef.current) {
          console.log('[Mascot] Roam outcome: started sleep')
        }
        return
      }

      // Check activity gap: do not start anything if inside ACTIVITY_GAP_MIN_MS of last activity
      const timeSinceActivity = Date.now() - lastActivityEndRef.current
      if (timeSinceActivity < ACTIVITY_GAP_MIN_MS) {
        const retryDelay = randBetween(3000, 5000)
        if (isDebugRef.current) {
          console.log(`[Mascot] Roam outcome: blocked by activity gap (${Math.round(timeSinceActivity)}ms < ${ACTIVITY_GAP_MIN_MS}ms), next attempt in ${Math.round(retryDelay)}ms`)
        }
        later(walkOnce, retryDelay)
        return
      }

      // Roll roam chance (50% base chance to walk, otherwise sit still)
      let effectiveRoamChance = ROAM_CHANCE * mods.roamChance
      if (mods.roamChanceCap !== null) {
        effectiveRoamChance = Math.min(mods.roamChanceCap, effectiveRoamChance)
      }
      if (Math.random() >= effectiveRoamChance) {
        const roamIntervalMult = getRoamIntervalMultiplier(new Date())
        const nextDelay = randBetween(ROAM_INTERVAL_MIN_MS * mods.roamInterval * roamIntervalMult, ROAM_INTERVAL_MAX_MS * mods.roamInterval * roamIntervalMult)
        if (isDebugRef.current) {
          console.log(`[Mascot] Roam outcome: skipped by chance (${Math.round(effectiveRoamChance * 100)}%), next attempt in ${Math.round(nextDelay)}ms`)
        }
        later(walkOnce, nextDelay)
        return
      }

      // ── Normal walk ──
      const { width } = measure()
      const minX = MARGIN
      const screenW = window.screen.availWidth || window.screen.width || 1920
      const maxX = Math.max(minX, screenW - width - MARGIN)
      const currentX = posRef.current.x
      let dir
      let targetX
      let realDist

      // Edge walk roll: 15% chance to intentionally pick an edge-zone destination
      const trueRightEdge = Math.max(NORMAL_CAT_CX, screenW - 160 + NORMAL_CAT_CX)
      if (Math.random() < KNOCKOFF_EDGE_WALK_CHANCE && currentX < trueRightEdge - 50) {
        targetX = trueRightEdge
        dir = 'right'
        realDist = Math.abs(targetX - currentX)
      } else {
        dir = Math.random() < 0.5 ? 'left' : 'right'
        if (currentX <= minX + 24) dir = 'right'
        if (currentX >= maxX - 24) dir = 'left'

        const distance = randBetween(ROAM_DISTANCE_MIN_PX, ROAM_DISTANCE_MAX_PX)

        // Compute clamped destination BEFORE starting the walk
        targetX = clamp(
          dir === 'left' ? currentX - distance : currentX + distance,
          minX,
          maxX
        )
        realDist = Math.abs(targetX - currentX)

        // If the real distance in chosen direction is < 40 px, pick opposite direction if room, else skip
        if (realDist < 40) {
          const oppDir = dir === 'left' ? 'right' : 'left'
          const oppTargetX = clamp(
            oppDir === 'left' ? currentX - distance : currentX + distance,
            minX,
            maxX
          )
          const oppDist = Math.abs(oppTargetX - currentX)
          if (oppDist >= 40) {
            dir = oppDir
            targetX = oppTargetX
            realDist = oppDist
          } else {
            // Neither direction has room: skip this roam and stay idle
            const roamIntervalMult = getRoamIntervalMultiplier(new Date())
            const nextDelay = randBetween(ROAM_INTERVAL_MIN_MS * mods.roamInterval * roamIntervalMult, ROAM_INTERVAL_MAX_MS * mods.roamInterval * roamIntervalMult)
            if (isDebugRef.current) {
              console.log(`[Mascot] Roam outcome: skipped by guard (no room >= 40px), next attempt in ${Math.round(nextDelay)}ms`)
            }
            later(walkOnce, nextDelay)
            return
          }
        }
      }

      const startRoamWalk = () => {
        if (gen !== roamGenRef.current || roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) return

        performMovementRef.current?.({
          gen,
          anim: 'walk',
          distanceOrTarget: { targetX },
          forcedDir: dir,
          speedRange: [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S],
          edgeMargin: MARGIN,
          onArrive: () => {
            poseRef.current = 'standidle'
            setPose('standidle')

            later(() => {
              if (gen !== roamGenRef.current || roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) {
                scheduleStandSafetyNetRef.current?.()
                return
              }

              // Knockoff trigger (a): roam walk ends in edge zone
              const inEdgeZone = posRef.current.x >= trueRightEdge - KNOCKOFF_EDGE_DIST_PX
              const now = Date.now()
              if (
                inEdgeZone &&
                now - lastKnockoffRef.current >= KNOCKOFF_COOLDOWN_MS &&
                Math.random() < KNOCKOFF_ARRIVE_CHANCE
              ) {
                lastKnockoffRef.current = now
                const remainingDist = trueRightEdge - posRef.current.x
                if (remainingDist <= 3) {
                  standingFacingRef.current = 'right'
                  playOnceAnimationRef.current?.(null, 'sitdown', () => {
                    postureRef.current = 'sit'
                    lastSeatedTimeRef.current = Date.now()
                    facingRef.current = 'right'
                    poseRef.current = 'idle'
                    setPose('idle')
                    restartIdleVariantTimerRef.current?.('new')
                    playOneShotRef.current?.('knockoff')
                  })
                } else if (!roamBlockedRef.current) {
                  performMovementRef.current?.({
                    gen,
                    anim: 'walk',
                    distanceOrTarget: { targetX: trueRightEdge },
                    forcedDir: 'right',
                    speedRange: [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S],
                    edgeMargin: 0,
                    onArrive: () => {
                      poseRef.current = 'standidle'
                      setPose('standidle')
                      later(() => {
                        standingFacingRef.current = 'right'
                        playOnceAnimationRef.current?.(null, 'sitdown', () => {
                          postureRef.current = 'sit'
                          lastSeatedTimeRef.current = Date.now()
                          facingRef.current = 'right'
                          poseRef.current = 'idle'
                          setPose('idle')
                          restartIdleVariantTimerRef.current?.('new')
                          playOneShotRef.current?.('knockoff')
                        })
                      }, randBetween(600, 1000))
                    },
                    onAbort: () => {
                      scheduleStandSafetyNetRef.current?.()
                    }
                  })
                }
              } else {
                // Normal roam arrival: sit down
                standingFacingRef.current = 'right'
                playOnceAnimationRef.current?.(null, 'sitdown', () => {
                  postureRef.current = 'sit'
                  lastSeatedTimeRef.current = Date.now()
                  poseRef.current = 'idle'
                  setPose('idle')
                  restartIdleVariantTimerRef.current?.('new')
                })
              }

              const roamIntervalMult = getRoamIntervalMultiplier(new Date())
              const nextDelay = randBetween(ROAM_INTERVAL_MIN_MS * mods.roamInterval * roamIntervalMult, ROAM_INTERVAL_MAX_MS * mods.roamInterval * roamIntervalMult)
              if (isDebugRef.current) {
                console.log(`[Mascot] Roam walk ended, next attempt in ${Math.round(nextDelay)}ms`)
              }
              later(walkOnce, nextDelay)
            }, randBetween(800, 1500))
          },
          onAbort: () => {
            scheduleStandSafetyNetRef.current?.()
          }
        })
      }

      if (postureRef.current === 'sit') {
        postureRef.current = 'stand'
        standingFacingRef.current = 'right'
        if (isDebugRef.current) {
          console.log('[Mascot] Roam outcome: standing up for walk')
        }
        playOnceAnimationRef.current?.(null, 'standup', () => {
          if (gen !== roamGenRef.current || roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) {
            scheduleStandSafetyNetRef.current?.()
            return
          }
          poseRef.current = 'standidle'
          setPose('standidle')
          later(startRoamWalk, randBetween(300, 600))
        })
      } else {
        startRoamWalk()
      }
    }

    const initialMods = moodModifiers(moodRef.current)
    const roamIntervalMult = getRoamIntervalMultiplier(new Date())
    const initialDelay = randBetween(ROAM_INTERVAL_MIN_MS * initialMods.roamInterval * roamIntervalMult, ROAM_INTERVAL_MAX_MS * initialMods.roamInterval * roamIntervalMult)
    if (isDebugRef.current) {
      console.log(`[Mascot] Roam scheduler started, next attempt in ${Math.round(initialDelay)}ms`)
    }
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
  }, [isReminder, roamEpoch, measure, pomodoroCelebrating, chatState, notificationVisible, wakeUp, isRoamBlocked, isEating])

  // ── Part 2: Idle Life Scheduler (every 10–25s) ────────────────────────────
  useEffect(() => {
    let timerId = null

    const scheduleNextIdle = (delay) => {
      timerId = setTimeout(() => {
        const nextDelay = triggerIdleLife()
        scheduleNextIdle(nextDelay)
      }, delay)
    }

    const triggerIdleLife = () => {
      let blockReason = null
      if (isChainActiveRef.current) blockReason = 'chain active'
      else if (postureRef.current === 'stand') blockReason = 'standing'
      else if (Date.now() < calmUntilRef.current) blockReason = 'calm window'
      else if (poseRef.current !== 'idle') blockReason = `pose is ${poseRef.current}`
      else if (oneShotPoseRef.current) blockReason = `oneShot is ${oneShotPoseRef.current}`
      else if (walkTweenRef.current) blockReason = 'walking/roaming'
      else if (draggingRef.current || dragPointerDownRef.current) blockReason = 'dragging'
      else if (mediaPlayingRef.current) blockReason = 'media playing'
      else if (roamBlockedRef.current) blockReason = 'roam blocked'

      if (blockReason) {
        const retryDelay = randBetween(3000, 5000)
        if (isDebugRef.current) {
          console.log(`[Mascot] Idle-life outcome: blocked by guard (${blockReason}), next attempt in ${Math.round(retryDelay)}ms`)
        }
        return retryDelay
      }

      const timeSinceActivity = Date.now() - lastActivityEndRef.current
      if (timeSinceActivity < ACTIVITY_GAP_MIN_MS) {
        const retryDelay = randBetween(3000, 5000)
        if (isDebugRef.current) {
          console.log(`[Mascot] Idle-life outcome: blocked by activity gap (${Math.round(timeSinceActivity)}ms < ${ACTIVITY_GAP_MIN_MS}ms), next attempt in ${Math.round(retryDelay)}ms`)
        }
        return retryDelay
      }

      const nextDelay = randBetween(IDLE_LIFE_INTERVAL_MIN_MS, IDLE_LIFE_INTERVAL_MAX_MS)

      // Boredom rule: if continuously seated with no activity for 60 s, ignore sit chance and pick movement chain
      const continuouslySeatedMs = Date.now() - lastSeatedTimeRef.current
      const isBored = postureRef.current === 'sit' && continuouslySeatedMs >= 60000

      if (!isBored) {
        // 25% chance that it does nothing at all (she just keeps sitting)
        if (Math.random() < IDLE_LIFE_SIT_CHANCE) {
          if (isDebugRef.current) {
            console.log(`[Mascot] Idle-life outcome: skipped by chance (25% sit), next attempt in ${Math.round(nextDelay)}ms`)
          }
          return nextDelay
        }
      }

      // Gift trigger: peak mood (or mood disabled)
      const now = Date.now()
      const moodActive = moodEnabledRef.current
      const isPeakMood = !moodActive || (moodRef.current === 'Happy' && (statsRef.current?.affection ?? 0) >= GIFT_MIN_AFFECTION)
      const canGift = now - lastGiftRef.current >= GIFT_COOLDOWN_MS
      if (isPeakMood && canGift && Math.random() < GIFT_CHANCE) {
        lastGiftRef.current = now
        lastIdleBehaviorRef.current = 'gift'
        if (isDebugRef.current) {
          console.log(`[Mascot] Idle-life outcome: started gift, next attempt in ${Math.round(nextDelay)}ms`)
        }
        playOneShotRef.current?.('gift')
        return nextDelay
      }

      // Knockoff trigger (b): idle-life roll while already in edge zone
      const currentScreenW = window.screen.availWidth || window.screen.width || 1920
      const trueRightEdge = Math.max(NORMAL_CAT_CX, currentScreenW - 160 + NORMAL_CAT_CX)
      const inEdgeZone = posRef.current.x >= trueRightEdge - KNOCKOFF_EDGE_DIST_PX
      const canKnockoff = now - lastKnockoffRef.current >= KNOCKOFF_COOLDOWN_MS
      if (inEdgeZone && canKnockoff && Math.random() < KNOCKOFF_IDLE_CHANCE) {
        lastKnockoffRef.current = now
        lastIdleBehaviorRef.current = 'knockoff'
        const remainingDist = trueRightEdge - posRef.current.x
        if (remainingDist <= 3) {
          facingRef.current = 'right'
          if (isDebugRef.current) {
            console.log(`[Mascot] Idle-life outcome: started knockoff at edge zone, next attempt in ${Math.round(nextDelay)}ms`)
          }
          playOneShotRef.current?.('knockoff')
          return nextDelay
        } else if (!roamBlockedRef.current) {
          ensureStandingRef.current?.(null, () => {
            if (roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) {
              scheduleStandSafetyNetRef.current?.()
              return
            }
            performMovementRef.current?.({
              anim: 'walk',
              distanceOrTarget: { targetX: trueRightEdge },
              forcedDir: 'right',
              speedRange: [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S],
              edgeMargin: 0,
              onArrive: () => {
                poseRef.current = 'standidle'
                setPose('standidle')
                setTimeout(() => {
                  standingFacingRef.current = 'right'
                  playOnceAnimationRef.current?.(null, 'sitdown', () => {
                    postureRef.current = 'sit'
                    lastSeatedTimeRef.current = Date.now()
                    facingRef.current = 'right'
                    poseRef.current = 'idle'
                    setPose('idle')
                    restartIdleVariantTimerRef.current?.('new')
                    if (isDebugRef.current) {
                      console.log(`[Mascot] Idle-life outcome: completed edge walk and started knockoff, next attempt in ${Math.round(nextDelay)}ms`)
                    }
                    playOneShotRef.current?.('knockoff')
                  })
                }, randBetween(600, 1000))
              },
              onAbort: () => {
                scheduleStandSafetyNetRef.current?.()
              }
            })
          })
          return nextDelay + 2500
        }
      }

      const allWeights = getIdleWeights(moodRef.current, statsRef.current?.energy ?? 100, new Date())
      let pool = allWeights
      if (isBored) {
        const movementIds = new Set(['patrol', 'walk_then_act', 'stretch_in_place'])
        const canRun = (statsRef.current?.energy ?? 100) >= 45 && moodRef.current !== 'Sleepy' && moodRef.current !== 'Lonely' && moodRef.current !== 'Annoyed'
        if (canRun) movementIds.add('run_burst')
        pool = allWeights.filter((item) => movementIds.has(item.id))
        if (pool.length === 0) pool = allWeights.filter((item) => movementIds.has(item.id) || item.isChain)
      }

      let availableWeights = pool.filter((item) => item.id !== lastIdleBehaviorRef.current && item.pose !== lastIdleBehaviorRef.current)
      if (availableWeights.length === 0) availableWeights = pool
      if (availableWeights.length === 0) availableWeights = allWeights

      const totalWeight = availableWeights.reduce((acc, w) => acc + w.weight, 0)
      let r = Math.random() * totalWeight
      let selected = availableWeights[0]
      for (const item of availableWeights) {
        if (r < item.weight) {
          selected = item
          break
        }
        r -= item.weight
      }

      if (selected.isChain) {
        lastIdleBehaviorRef.current = selected.id
        if (isDebugRef.current) {
          console.log(`[Mascot] Idle-life outcome: started chain ${selected.id}, next attempt in ${Math.round(nextDelay)}ms`)
        }
        startLifeChainRef.current?.(selected.id)
      } else {
        // 40% of the time a seated action is chosen it is turned into walk_then_act
        const allowedWalkActions = ['toyplay', 'groom', 'yawn', 'curious']
        const canConvert = allowedWalkActions.includes(selected.pose) && !(moodRef.current === 'Annoyed' && selected.pose === 'toyplay')
        if (Math.random() < 0.40 && canConvert) {
          lastIdleBehaviorRef.current = 'walk_then_act'
          if (isDebugRef.current) {
            console.log(`[Mascot] Idle-life outcome: converted ${selected.pose} to walk_then_act, next attempt in ${Math.round(nextDelay)}ms`)
          }
          startLifeChainRef.current?.('walk_then_act', false, selected.pose)
        } else {
          lastIdleBehaviorRef.current = selected.pose
          if (isDebugRef.current) {
            console.log(`[Mascot] Idle-life outcome: started ${selected.pose} (${selected.type}), next attempt in ${Math.round(nextDelay)}ms`)
          }
          if (selected.type === 'oneshot') {
            playOneShotRef.current?.(selected.pose)
          } else {
            startIdleBehaviorRef.current?.(selected.pose, selected.duration)
          }
        }
      }

      return nextDelay
    }

    const initialDelay = randBetween(IDLE_LIFE_INTERVAL_MIN_MS, IDLE_LIFE_INTERVAL_MAX_MS)
    if (isDebugRef.current) {
      console.log(`[Mascot] Idle-life scheduler started, next attempt in ${Math.round(initialDelay)}ms`)
    }
    scheduleNextIdle(initialDelay)
    return () => {
      if (timerId) clearTimeout(timerId)
    }
  }, [])

  // ── Part 3: Chase Cursor Effect ───────────────────────────────────────────
  useEffect(() => {
    if (!mouseReaction || reduceResourceUsage || paused) {
      cursorHistoryRef.current = []
      return undefined
    }

    const unsub = window.api?.on?.('mascot:cursor-offset', (offset) => {
      if (!offset || typeof offset.x !== 'number' || typeof offset.y !== 'number') return

      const now = performance.now()
      const hist = cursorHistoryRef.current
      hist.push({ x: offset.x, y: offset.y, time: now })

      // Retain samples within the last 600ms
      while (hist.length > 0 && now - hist[0].time > 600) {
        hist.shift()
      }

      // Check horizontal distance: between 100px and 300px away horizontally
      const absX = Math.abs(offset.x)
      if (absX < 100 || absX > 300 || Math.abs(offset.y) > 300) return

      // Eligible: cat is idle, not dragging, not in reminder/chat/walk, not chasing, cooldown 30s, not in calm window
      if (
        isChainActiveRef.current ||
        poseRef.current !== 'idle' ||
        oneShotPoseRef.current ||
        walkTweenRef.current ||
        chaseRafRef.current ||
        draggingRef.current ||
        dragPointerDownRef.current ||
        isRoamBlocked ||
        isChasingRef.current ||
        Date.now() < calmUntilRef.current ||
        Date.now() - lastChaseTimeRef.current < 30000 ||
        mediaPlayingRef.current ||
        hungerState === 'ACTIVE' ||
        chatState !== 'idle' ||
        isReminder ||
        isEating
      ) {
        return
      }

      // Check if cursor is ahead of her in the direction she is currently facing
      const facing = facingRef.current || 'right'
      const isAhead = (facing === 'right' && offset.x > 0) || (facing === 'left' && offset.x < 0)
      if (!isAhead) {
        // Behind her: do nothing (no pounce, no move, no remark, NO cooldown started)
        return
      }

      if (hist.length < 2) return

      const dt = (now - hist[0].time) / 1000
      if (dt < 0.25) return

      const dx = offset.x - hist[0].x
      const dy = offset.y - hist[0].y
      const cursorSpeed = Math.hypot(dx, dy) / dt
      if (cursorSpeed < 250) return

      // Random chance: roll Math.random() < 0.4
      if (Math.random() >= 0.4) {
        // Roll failed: short re-roll cooldown (8s) so she doesn't re-test every tick
        lastChaseTimeRef.current = Date.now() - 22000
        return
      }

      // Roll succeeded: start chase with 30s cooldown
      lastChaseTimeRef.current = Date.now()
      isChasingRef.current = true

      // Never turn her around just to chase the cursor. Facing must NOT change.
      chaseFlippedRef.current = facing === 'left'

      // Lock target position before mouse moves
      const { width } = measure()
      const minX = MARGIN
      const screenW = window.screen.availWidth || window.screen.width || 1920
      const maxX = Math.max(minX, screenW - width - MARGIN)
      const lockedStartX = posRef.current.x
      const lockedTargetX = clamp(posRef.current.x + offset.x - Math.sign(offset.x) * 40, minX, maxX)

      cancelIdleAndOneShot()
      playOneShot('crouchpounce', () => {
        isChasingRef.current = false
        chaseFlippedRef.current = null
        poseRef.current = 'idle'
        setPose('idle')
        onTriggerRemark?.('pounce')
      })

      // Frame 4 is the leap (roughly 400-500ms into the animation)
      // Smoothly move window towards cursor position using rAF tween over ~400ms with ease-out
      chaseStartTimeoutRef.current = setTimeout(() => {
        chaseStartTimeoutRef.current = null
        const startTime = performance.now()
        const duration = 400
        const easeOut = (t) => 1 - Math.pow(1 - t, 3)

        const step = (tNow) => {
          if (draggingRef.current || dragPointerDownRef.current) {
            chaseRafRef.current = null
            return
          }
          const elapsed = tNow - startTime
          const t = Math.min(1, elapsed / duration)
          const eased = easeOut(t)
          const currentX = lockedStartX + (lockedTargetX - lockedStartX) * eased
          posRef.current = { x: currentX, y: posRef.current.y }
          setX(currentX)
          window.api?.moveWindow?.(Math.round(currentX), Math.round(posRef.current.y))

          if (t < 1) {
            chaseRafRef.current = requestAnimationFrame(step)
          } else {
            chaseRafRef.current = null
            window.api?.persistPosition?.(Math.round(lockedTargetX), Math.round(posRef.current.y))
          }
        }

        chaseRafRef.current = requestAnimationFrame(step)
      }, 450)
    })

    return () => {
      unsub?.()
    }
  }, [mouseReaction, reduceResourceUsage, paused, isRoamBlocked, cancelIdleAndOneShot, playOneShot, onTriggerRemark, measure, hungerState, chatState, isReminder, isEating])

  // ── Part 4: Call Cat Listener ─────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.api?.on?.('mascot:call', (payload) => {
      moodHandleShortcutCall()
      // Ignore if dragging, eating, or in reminder / chat
      if (
        draggingRef.current ||
        dragPointerDownRef.current ||
        poseRef.current === 'eat' ||
        isReminder ||
        chatState !== 'idle'
      ) {
        return
      }

      // If sleeping, play wakeup first
      const wasSleeping = poseRef.current === 'sleep'
      if (wasSleeping) {
        cancelIdleAndOneShot()
        poseRef.current = 'idle'
        setPose('idle')
        playOneShot('wakeup', () => {
          proceedCallWalk(payload?.x)
        })
      } else {
        cancelIdleAndOneShot()
        proceedCallWalk(payload?.x)
      }
    })

    const proceedCallWalk = (destX) => {
      const screenW = window.screen.availWidth || window.screen.width || 1920
      const minX = NORMAL_CAT_CX
      const maxX = Math.max(minX, screenW - 160 + NORMAL_CAT_CX)
      const targetX = clamp(typeof destX === 'number' ? destX : posRef.current.x, minX, maxX)

      const dist = Math.abs(targetX - posRef.current.x)
      if (dist < 40) {
        triggerAccentRef.current('is-squash')
        onCallMeow?.()
        return
      }

      const dir = targetX < posRef.current.x ? 'left' : 'right'
      facingRef.current = dir
      const duration = clamp(dist * 5, 1200, 5000)

      // Compute playback rate proportional to real speed so one full leg cycle covers WALK_PX_PER_CYCLE (70px)
      const speedPxPerSec = dist / (duration / 1000)
      const targetFps = (speedPxPerSec / WALK_PX_PER_CYCLE) * 8
      const walkRate = clamp(targetFps / 12, 0.4, 1.5)
      setWalkSpeedRate(walkRate)

      walkTweenRef.current = null
      setWalkMs(duration)
      poseRef.current = dir === 'left' ? 'walk-left' : 'walk-right'
      setPose(poseRef.current)
      triggerAccentRef.current('is-stretch')

      walkTweenRef.current = {
        startX: posRef.current.x,
        targetX,
        startTime: performance.now(),
        duration,
      }
      dragTargetRef.current = { x: targetX, y: posRef.current.y }

      if (callWalkTimeoutRef.current) clearTimeout(callWalkTimeoutRef.current)
      callWalkTimeoutRef.current = setTimeout(() => {
        callWalkTimeoutRef.current = null
        walkTweenRef.current = null
        setWalkMs(0)
        setWalkSpeedRate(1)
        if (poseRef.current.startsWith('walk')) {
          poseRef.current = 'idle'
          setPose('idle')
        }
        triggerAccentRef.current('is-squash')
        onCallMeow?.()
      }, duration + 40)
    }

    return () => {
      unsub?.()
      if (callWalkTimeoutRef.current) {
        clearTimeout(callWalkTimeoutRef.current)
        callWalkTimeoutRef.current = null
      }
    }
  }, [isReminder, chatState, cancelIdleAndOneShot, playOneShot, onCallMeow, moodHandleShortcutCall])

  // ── Part 5: Launch Greeting ───────────────────────────────────────────────
  useEffect(() => {
    if (hasLaunchedRef.current) return
    hasLaunchedRef.current = true

    // Small delay after mount before playing launch greeting
    const timer = setTimeout(() => {
      playOneShot('wakeup', () => {
        poseRef.current = 'idle'
        setPose('idle')
      })
      onLaunchMeow?.()
      onTriggerRemark?.('launch')
    }, 400)

    return () => clearTimeout(timer)
  }, [playOneShot, onLaunchMeow, onTriggerRemark])

  // ── Part 6: Low Battery Monitoring ────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getBattery !== 'function') {
      return
    }

    let batteryInstance = null

    const handleBatteryUpdate = (battery) => {
      const isLow = battery.level < 0.20 && !battery.charging
      isLowBatteryRef.current = isLow

      if (isLow) {
        const now = Date.now()
        // Remark once per 30 minutes
        if (now - lastLowBatteryRemarkRef.current > 30 * 60 * 1000) {
          lastLowBatteryRemarkRef.current = now
          onTriggerRemark?.('lowBattery')
        }
      }
    }

    navigator.getBattery().then((battery) => {
      batteryInstance = battery
      handleBatteryUpdate(battery)

      battery.addEventListener('levelchange', () => handleBatteryUpdate(battery))
      battery.addEventListener('chargingchange', () => handleBatteryUpdate(battery))
    }).catch((err) => {
      console.warn('[Mascot] navigator.getBattery failed:', err)
    })

    return () => {
      if (batteryInstance) {
        batteryInstance.removeEventListener('levelchange', () => handleBatteryUpdate(batteryInstance))
        batteryInstance.removeEventListener('chargingchange', () => handleBatteryUpdate(batteryInstance))
      }
    }
  }, [onTriggerRemark])

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
    wakingUpRef.current = false
    wakeTargetPoseRef.current = null
    wakeCallbackRef.current = null
    cancelIdleAndOneShot()
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
    poseRef.current = 'drag'
    setPose('drag')
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
      poseRef.current = 'idle'
      setPose('idle')
      return
    }

    if (!dragResizeApplied) {
      unbindDragPointerListeners()
      draggingRef.current = false
      setDragging(false)
      poseRef.current = 'idle'
      setPose('idle')
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
    if (!dragPointerDownRef.current && !draggingRef.current) {
      if (dragPointerIdRef.current != null && event.pointerId === dragPointerIdRef.current) {
        dragPointerIdRef.current = null
      }
      return
    }
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
      if (dragPointerIdRef.current != null) {
        try {
          containerRef.current?.releasePointerCapture(dragPointerIdRef.current)
        } catch (_) {
          // ignore
        }
        dragPointerIdRef.current = null
      }
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
      poseRef.current = 'idle'
      setPose('idle')
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
      if (isDebugRef.current) {
        console.log('[drag] released before threshold (click)')
      }
      if (dragPointerIdRef.current != null) {
        try {
          containerRef.current?.releasePointerCapture(dragPointerIdRef.current)
        } catch (_) {
          // ignore
        }
        dragPointerIdRef.current = null
      }
    }

    if (
      !buttonPointersRef.current[0] &&
      !buttonPointersRef.current[1] &&
      !buttonPointersRef.current[2] &&
      !draggingRef.current &&
      !dragExpandingRef.current &&
      !isStartingDragRef.current
    ) {
      unbindDragPointerListeners()
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

    moodHandleBodyClick()

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
      if (dist > DRAG_START_THRESHOLD_PX) {
        if (isDebugRef.current) {
          console.log('[drag] threshold crossed -> start')
        }
        clearTimeout(leftClickTimerRef.current)
        clearTimeout(rightClickTimerRef.current)
        leftClickTimerRef.current = null
        rightClickTimerRef.current = null
        dragOffsetRef.current = {
          x: event.clientX - (window.innerWidth / 2),
          y: event.clientY - NORMAL_CAT_CY,
        }
        lastDragPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
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
    if (dragPointerIdRef.current != null) {
      try {
        containerRef.current?.releasePointerCapture(dragPointerIdRef.current)
      } catch (_) {
        // ignore
      }
      dragPointerIdRef.current = null
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

    cancelActiveLifeChainRef.current?.('pointerdown')

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
      if (isDebugRef.current) {
        console.log('[drag] press')
      }
      isStartingDragRef.current = false
      dragStartedRef.current = false
      dragPointerIdRef.current = event.pointerId
      try {
        containerRef.current?.setPointerCapture(event.pointerId)
      } catch (_) {
        // ignore
      }
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
      cancelIdleAndOneShot()
      poseRef.current = 'idle'
      setPose('idle')
      setIsHoveringHead(true)
      onPetStart?.()
      moodHandlePetStart()
      moodHandlePetStateChange(true)
    }
  }

  const handleHeadPointerLeave = () => {
    if (poseRef.current === 'sleep') return
    clearTimeout(petLeaveTimeoutRef.current)
    if (isHoveringHead) {
      petLeaveTimeoutRef.current = setTimeout(() => {
        setIsHoveringHead(false)
        moodHandlePetStateChange(false)
        calmUntilRef.current = Date.now() + 2000
        setTimeout(() => {
          setRoamEpoch((n) => n + 1)
        }, 2000)
      }, 400)
    }
    strokeTrackingRef.current = { currentDir: 0, apexX: 0, reversals: [] }
  }

  const handleMouseEnter = () => {}
  const handleMouseLeave = () => {}

  useEffect(() => {
    return () => {
      // Clean up document-level drag listeners if component unmounts mid-drag
      cancelActiveLifeChainRef.current?.('unmount')
      unbindDragPointerListeners()
      clearTimeout(leftClickTimerRef.current)
      clearTimeout(rightClickTimerRef.current)
      clearTimeout(petLeaveTimeoutRef.current)
      clearTimeout(eatTimeoutRef.current)
      if (standSafetyTimeoutRef.current) {
        clearTimeout(standSafetyTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isDebug) {
      if (typeof window !== 'undefined' && window.__sbLife) {
        delete window.__sbLife
      }
      return undefined
    }

    window.__sbLife = {
      list: () => LIFE_CHAINS.map((c) => c.id),
      run: (id, opts = {}) => {
        if (!startLifeChainRef.current) return Promise.resolve(false)

        if (poseRef.current === 'sleep' || wakingUpRef.current) {
          if (isDebugRef.current) {
            console.log(`[life] debug run: cat is sleeping, waking up first for chain ${id}`)
          }
          suppressWakeStretchRef.current = true
          return new Promise((resolve) => {
            wakeToRef.current?.('idle', () => {
              setTimeout(() => {
                suppressWakeStretchRef.current = false
                if (startLifeChainRef.current) {
                  const started = startLifeChainRef.current(id, true)
                  resolve(!!started)
                } else {
                  resolve(false)
                }
              }, 600)
            })
          })
        }

        const isTyping = poseRef.current === 'typing' || poseRef.current === 'typingfast'
        if (opts.force) {
          if (isTyping || postureRef.current !== 'sit' || poseRef.current !== 'idle') {
            poseRef.current = 'idle'
            setPose('idle')
            postureRef.current = 'sit'
          }
          const started = startLifeChainRef.current(id, true)
          return Promise.resolve(!!started)
        }

        const isSeatedIdle =
          poseRef.current === 'idle' &&
          postureRef.current === 'sit' &&
          !isChainActiveRef.current &&
          !draggingRef.current &&
          !oneShotPoseRef.current

        if (isSeatedIdle) {
          const started = startLifeChainRef.current(id, true)
          return Promise.resolve(!!started)
        }

        console.log(`[life] debug run queued: pose=${poseRef.current}`)
        return new Promise((resolve) => {
          const startTime = Date.now()
          const pollInterval = setInterval(() => {
            if (Date.now() - startTime > 25000) {
              clearInterval(pollInterval)
              if (isDebugRef.current) {
                console.log(`[life] debug run queued timeout after 25s for chain ${id}`)
              }
              resolve(false)
              return
            }
            const ready =
              poseRef.current === 'idle' &&
              postureRef.current === 'sit' &&
              !isChainActiveRef.current &&
              !draggingRef.current &&
              !oneShotPoseRef.current &&
              !mediaPlayingRef.current
            if (ready) {
              clearInterval(pollInterval)
              const started = startLifeChainRef.current?.(id, true)
              resolve(!!started)
            }
          }, 250)
        })
      },
      stride: () => {
        const currentStrides = {
          walk: {
            defaultPx: WALK_PX_PER_CYCLE,
            effectivePx: getStrideForAnimRef.current?.('walk'),
            overridePx: strideOverridesRef.current.walk
          },
          stalk: {
            defaultPx: STALK_PX_PER_CYCLE,
            effectivePx: getStrideForAnimRef.current?.('stalk'),
            overridePx: strideOverridesRef.current.stalk
          },
          run: {
            defaultPx: RUN_PX_PER_CYCLE,
            effectivePx: getStrideForAnimRef.current?.('run'),
            overridePx: strideOverridesRef.current.run
          }
        }
        console.log('[life] current stride configuration:', currentStrides)
        if (moveHistoryRef.current.length === 0) {
          console.log('[life] no moves recorded yet')
        } else {
          console.log('[life] last moves (up to 5):')
          console.table(moveHistoryRef.current)
        }
        return {
          strides: currentStrides,
          history: [...moveHistoryRef.current]
        }
      },
      setStride: (name, px) => {
        if (!['walk', 'stalk', 'run'].includes(name)) {
          console.warn(`[life] setStride: invalid anim '${name}'. Expected walk|stalk|run`)
          return false
        }
        const val = typeof px === 'number' && px > 0 ? px : null
        strideOverridesRef.current[name] = val
        console.log(`[life] stride override: ${name}=${val ?? 'default'}`)
        return true
      },
      moveTest: (name = 'walk', px = 150) => {
        if (isChainActiveRef.current || draggingRef.current) {
          console.warn('[life] moveTest abort: chain active or dragging')
          return false
        }
        const anim = ['walk', 'stalk', 'run'].includes(name) ? name : 'walk'
        const dist = typeof px === 'number' ? px : 150
        console.log(`[life] moveTest starting: anim=${anim}, px=${dist}`)
        ensureStandingRef.current?.(null, () => {
          poseRef.current = 'standidle'
          setPose('standidle')
          performMovementRef.current?.({
            anim,
            distanceOrTarget: dist,
            onArrive: () => {
              poseRef.current = 'standidle'
              setPose('standidle')
              setTimeout(() => {
                ensureSittingRef.current?.(null, () => {
                  poseRef.current = 'idle'
                  setPose('idle')
                  console.log(`[life] moveTest complete: anim=${anim}`)
                })
              }, 800)
            },
            onAbort: (reason) => {
              console.warn(`[life] moveTest aborted: ${reason}`)
              ensureSittingRef.current?.(null, () => {
                poseRef.current = 'idle'
                setPose('idle')
              })
            }
          })
        })
        return true
      },
    }

    return () => {
      if (typeof window !== 'undefined' && window.__sbLife) {
        delete window.__sbLife
      }
    }
  }, [isDebug])

  let currentPose = oneShotPose || pose
  if (currentPose === 'drag' && !dragging && !draggingRef.current) {
    currentPose = 'idle'
    if (pose === 'drag') {
      poseRef.current = 'idle'
      setPose('idle')
    }
  }
  if (currentPose === 'fall' && !falling && !fallRafRef.current) {
    currentPose = 'idle'
    if (pose === 'fall') {
      poseRef.current = 'idle'
      setPose('idle')
    }
  }
  if (isHoveringHead && !dragging && !isReminder && !pomodoroCelebrating && pose !== 'sleep') {
    currentPose = 'purr'
  }

  const displayPose = (isReminder && reminderCatAnimation !== false) ? 'alert' : pomodoroCelebrating ? 'jump' : currentPose
  const moving = walkMs > 0 && !dragging && (displayPose.startsWith('walk') || displayPose.startsWith('run') || displayPose.startsWith('stalk'))

  // ── Idle Variant Alternating (old 2-frame vs new 6-frame) ──────────────────
  useEffect(() => {
    let timer = null

    const scheduleNextVariant = (current) => {
      if (timer) clearTimeout(timer)
      const isOld = current === 'old'
      const delay = isOld
        ? randBetween(8000, 20000)
        : (Math.random() < 0.5 ? 2400 : 4800)

      timer = setTimeout(() => {
        if (isChainActiveRef.current) {
          scheduleNextVariant(current)
          return
        }
        const next = isOld ? 'new' : 'old'
        if (isDebugRef.current) {
          console.log(`[Mascot] idleVariant -> ${next}`)
        }
        setIdleVariant(next)
        scheduleNextVariant(next)
      }, delay)
    }

    restartIdleVariantTimerRef.current = (forcedVariant = 'new') => {
      if (timer) clearTimeout(timer)
      setIdleVariant(forcedVariant)
      scheduleNextVariant(forcedVariant)
    }

    scheduleNextVariant('old')

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

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
  } else if (displayPose === 'run-left') {
    animationName = 'run'
    flipped = true
  } else if (displayPose === 'run-right') {
    animationName = 'run'
    flipped = false
  } else if (displayPose === 'stalk-left') {
    animationName = 'stalk'
    flipped = true
  } else if (displayPose === 'stalk-right') {
    animationName = 'stalk'
    flipped = false
  } else if (displayPose === 'standidle') {
    animationName = 'standidle'
    flipped = standingFacingRef.current === 'left'
  } else if (displayPose === 'stretch') {
    animationName = 'stretch'
    flipped = standingFacingRef.current === 'left'
  } else if (displayPose === 'standup') {
    animationName = 'standup'
    flipped = false
  } else if (displayPose === 'sitdown') {
    animationName = 'sitdown'
    flipped = false
  } else if (displayPose === 'run') {
    animationName = 'run'
    flipped = standingFacingRef.current === 'left'
  } else if (displayPose === 'stalk') {
    animationName = 'stalk'
    flipped = standingFacingRef.current === 'left'
  } else if (displayPose === 'lookaround') {
    animationName = 'lookaround'
    flipped = false
  } else if (displayPose === 'tailflick') {
    animationName = 'tailflick'
    flipped = false
  } else if (displayPose === 'sleep') {
    animationName = 'sleep'
    flipped = false
  } else if (displayPose === 'eat') {
    animationName = 'eat'
    flipped = false
  } else if (displayPose === 'pet' || displayPose === 'purr') {
    animationName = 'purr'
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
  } else if (displayPose === 'crouch' || displayPose === 'pounce' || displayPose === 'crouchpounce') {
    animationName = 'crouchpounce'
    flipped = chaseFlippedRef.current ?? (facingRef.current === 'left')
  } else if (displayPose === 'knockoff') {
    animationName = 'knockoff'
    flipped = false
  } else if (displayPose === 'idle') {
    animationName = idleVariant === 'new' ? 'idle' : 'idle-old'
    flipped = false
  } else if (animsManifest?.animations && displayPose in animsManifest.animations) {
    animationName = displayPose
    flipped = false
  } else if (['groom', 'yawn', 'proud', 'wakeup'].includes(displayPose)) {
    animationName = displayPose
    flipped = false
  } else {
    animationName = idleVariant === 'new' ? 'idle' : 'idle-old'
    flipped = false
  }

  // Debug warnings with stack trace if pose/animation ever becomes drag or fall unexpectedly
  if ((pose === 'drag' || poseRef.current === 'drag') && !dragging && !draggingRef.current) {
    console.warn('[Mascot] Spurious drag pose detected while not dragging!', new Error().stack)
  }
  if ((pose === 'fall' || poseRef.current === 'fall') && !falling && !fallRafRef.current) {
    console.warn('[Mascot] Spurious fall pose detected while not falling!', new Error().stack)
  }
  if (animationName === 'drag' && !dragging && !draggingRef.current) {
    console.warn('[Mascot] Spurious drag animationName detected while not dragging!', new Error().stack)
    animationName = idleVariant === 'new' ? 'idle' : 'idle-old'
  }
  if (animationName === 'fall' && !falling && !fallRafRef.current) {
    console.warn('[Mascot] Spurious fall animationName detected while not falling!', new Error().stack)
    animationName = idleVariant === 'new' ? 'idle' : 'idle-old'
  }

  const isEyeTrackingEligible = Boolean(
    !reduceResourceUsage &&
    mouseReaction &&
    !paused &&
    (animationName === 'idle' || animationName === 'idle-old') &&
    !dragging &&
    !falling &&
    !pomodoroCelebrating &&
    !isChainActiveRef.current &&
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
      if (DEBUG_MOVE_WINDOW) {
        console.log(`[Renderer] calling moveWindow(${targetX}, ${targetY}) draggingRef=${draggingRef.current} walkTween=${!!walkTweenRef.current}`)
      }
      window.api.moveWindow(targetX, targetY)
    }
  }, [targetX, targetY])

  const isOverlayShowing = Boolean(
    chatState !== 'idle' ||
    notificationVisible ||
    (isReminder && reminderCatAnimation !== false) ||
    hungerState === 'ACTIVE' ||
    displayPose === 'typing' ||
    displayPose === 'typingfast'
  )

  const isCursorNear = Boolean(
    (cursorOffset && Math.hypot(cursorOffset.x, cursorOffset.y) <= 120) ||
    isHoveringHead
  )

  const isIndicatorVisible = Boolean(
    moodEnabled &&
    mood &&
    !isOverlayShowing &&
    (moodIndicator === 'always' || (moodIndicator === 'hover' && (isCursorNear || recentMoodChange)))
  )

  const indicatorRef = useRef(null)
  const lastIndicatorDecisionRef = useRef('')

  useEffect(() => {
    let logMsg = ''
    if (!moodEnabled) {
      logMsg = '[mood-indicator] hide reason=disabled'
    } else if (!mood) {
      logMsg = '[mood-indicator] hide reason=no_mood'
    } else if (isOverlayShowing) {
      logMsg = '[mood-indicator] hide reason=overlay_showing'
    } else if (!isIndicatorVisible) {
      logMsg = `[mood-indicator] hide reason=condition_not_met indicator=${moodIndicator} isCursorNear=${isCursorNear} recentChange=${recentMoodChange}`
    } else {
      const el = indicatorRef.current
      const rect = el ? el.getBoundingClientRect() : null
      const bounds = rect ? {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null
      const win = { w: window.innerWidth, h: window.innerHeight }
      logMsg = `[mood-indicator] show emoji=${MOOD_EMOJIS[mood]} bounds=${JSON.stringify(bounds)} win=${JSON.stringify(win)}`
    }
    if (logMsg && logMsg !== lastIndicatorDecisionRef.current) {
      lastIndicatorDecisionRef.current = logMsg
      console.log(logMsg)
    }
  })

  const emojiSize = Math.max(16, Math.min(26, Math.round(22 * ((catSize || 100) / 100))))

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
            loop={!ONE_SHOT_ANIMATIONS.has(animationName) && animsManifest?.animations?.[animationName]?.mode !== 'once'}
            onAnimationEnd={handleAnimationEnd}
            onShown={handleSpriteShown}
            manifest={useListening ? listeningManifest : undefined}
            spritesheet={useListening ? listeningSheetSrc : undefined}
            catAnimationSpeed={displayPose.startsWith('walk') || displayPose.startsWith('run') || displayPose.startsWith('stalk') ? walkSpeedRate : catAnimationSpeed}
            eyeTracking={isEyeTrackingEligible}
            cursorOffset={cursorOffset}
            fpsCap={effectiveFps}
          />
        </div>
      </div>

      {/* Mood indicator emoji - placed directly inside .mascot-container at top-right beside her head */}
      {moodEnabled && mood && MOOD_EMOJIS[mood] && (
        <div
          ref={indicatorRef}
          className="mascot-mood-indicator"
          style={{
            position: 'absolute',
            top: '66px',
            right: '-9px',
            width: `${emojiSize}px`,
            height: `${emojiSize}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${emojiSize}px`,
            lineHeight: 1,
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 12,
            transition: 'opacity 0.25s ease-in-out',
            opacity: isIndicatorVisible ? 1 : 0,
            filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4))',
          }}
          aria-hidden="true"
        >
          {MOOD_EMOJIS[mood]}
        </div>
      )}

    </div>
  )
}
