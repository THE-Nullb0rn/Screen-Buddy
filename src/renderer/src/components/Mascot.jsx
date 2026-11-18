import React, { useCallback, useEffect, useRef, useState } from 'react'
import './Mascot.css'
import SpriteAnimator, { SPEED_FACTORS } from './SpriteAnimator'
import animsManifest from '../assets/cat-sprite/anims/anims.json'
import { useMood, moodModifiers, MOOD_EMOJIS } from '../hooks/useMood'
// Replace this file to change the meow.
import meowUrl from '../assets/sounds/meow.wav'

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
export const WALK_PX_PER_CYCLE = 84

export const RUN_SPEED_MIN_PX_S = 240
export const RUN_SPEED_MAX_PX_S = 320
export const RUN_PX_PER_CYCLE = 219

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

// Reaction cooldown constants
export const REACTION_COOLDOWN_EVENT_MS = 60000
export const REACTION_COOLDOWN_IDLE_MS = 180000

const FALLBACK_WIDTH = SPRITE_WIDTH
const FALLBACK_HEIGHT = SPRITE_HEIGHT
const SLEEP_AFTER_MS = 2 * 60 * 1000
const SLEEP_CHANCE = 0.4

export const ONE_SHOT_ANIMATIONS = new Set(['yawn', 'pounce', 'crouch', 'crouchpounce', 'wakeup', 'gift', 'knockoff', 'annoyed', 'sad', 'standup', 'sitdown', 'stretch', 'lookaround', 'tailflick', 'eat', 'drink'])

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
  let sadWeight = mood === 'Lonely' ? 14 : 0
  let annoyedWeight = mood === 'Annoyed' ? 14 : 0

  // Base chain items
  let lookaroundWeight = 10
  let tailflickWeight = 8
  let stretchWeight = 8
  let wakeStretchWeight = 0
  let patrolWeight = 8
  let walkThenActWeight = 10
  let runBurstWeight = 6
  let napElsewhereWeight = 5

  // ── Energy modifiers ──
  if (energy >= 65) {
    runBurstWeight *= 1.6
    yawnWeight *= 0.6
    napElsewhereWeight = 0
  } else if (energy <= 35) {
    runBurstWeight *= 0.2
    yawnWeight *= 1.8
    napElsewhereWeight *= 2.5
  }

  // ── Mood modifiers ──
  if (mood === 'Sleepy') {
    napElsewhereWeight *= 2
    runBurstWeight = 0
  } else if (mood === 'Hungry') {
    runBurstWeight *= 0.3
  } else if (mood === 'Lonely' || mood === 'Annoyed') {
    runBurstWeight = 0
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
  }

  // ── Requirement gates ──
  const canNap = energy < 40 || mood === 'Sleepy' || period === 'night'
  if (!canNap) napElsewhereWeight = 0

  const canRun = energy >= 45 && mood !== 'Sleepy' && mood !== 'Lonely' && mood !== 'Annoyed'
  if (!canRun) runBurstWeight = 0

  const base = [
    { pose: 'groom', type: 'loop', duration: getAnimationDuration('groom'), weight: groomWeight },
    { pose: 'yawn', type: 'oneshot', duration: getAnimationDuration('yawn'), weight: yawnWeight },
    { pose: 'proud', type: 'loop', duration: getAnimationDuration('proud'), weight: proudWeight },
    { pose: 'play', type: 'loop', duration: getAnimationDuration('play'), weight: playWeight },
    { pose: 'toyplay', type: 'loop', duration: getAnimationDuration('toyplay'), weight: toyplayWeight },
    { pose: 'curious', type: 'loop', duration: getAnimationDuration('curious'), weight: curiousWeight },
    { pose: 'sad', type: 'oneshot', duration: getAnimationDuration('sad'), weight: sadWeight },
    { pose: 'annoyed', type: 'oneshot', duration: getAnimationDuration('annoyed'), weight: annoyedWeight },
    // Life chains
    { id: 'lookaround', pose: 'lookaround', type: 'oneshot', isChain: true, weight: lookaroundWeight },
    { id: 'tailflick', pose: 'tailflick', type: 'oneshot', isChain: true, weight: tailflickWeight },
    { id: 'stretch_in_place', pose: 'stretch_in_place', isChain: true, weight: stretchWeight },
    { id: 'wake_stretch', pose: 'wake_stretch', isChain: true, weight: wakeStretchWeight },
    { id: 'patrol', pose: 'patrol', isChain: true, weight: patrolWeight },
    { id: 'walk_then_act', pose: 'walk_then_act', isChain: true, weight: walkThenActWeight },
    { id: 'run_burst', pose: 'run_burst', isChain: true, weight: runBurstWeight },
    { id: 'nap_elsewhere', pose: 'nap_elsewhere', isChain: true, weight: napElsewhereWeight },
  ]
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

if (typeof window !== 'undefined') {
  window.__sbPerfCounters = window.__sbPerfCounters || {
    mascotRenders: 0,
    rafTicks: 0,
    canvasDraws: 0,
    timerTicks: 0,
  }
}

export default function Mascot({
  settings = null,
  reminderState,
  reminderType = 'water',
  hungerState = 'IDLE',
  onFeed,
  feedSignal = 0,
  drinkSignal = 0,
  hungerLaterSignal = 0,
  hungerBehavior = 'search-food',
  pomodoroCelebrating = false,
  REMINDER_STATE,
  mediaPlaying = false,
  chatState = 'idle',
  chatReply = '',
  chatAnimPhase = 'done',
  chatCatAnimations = true,
  isSystemIdle = false,
  pauseAnimationIdle = false,
  limitBackgroundCpu = false,
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
  eyeTracking = false,
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
  if (typeof window !== 'undefined' && window.__sbPerfCounters) {
    window.__sbPerfCounters.mascotRenders++
  }

  const isDebug = Boolean(developerMode) || process.env.NODE_ENV === 'development' || (typeof process !== 'undefined' && process.env?.SCREEN_BUDDY_DEBUG === '1')
  const isDebugRef = useRef(isDebug)
  isDebugRef.current = isDebug

  const perfIntervalRef = useRef(null)

  const chatPropsRef = useRef({ chatReply, onChatSend, onChatDismiss, onChatActivity, onChatOpen })
  chatPropsRef.current = { chatReply, onChatSend, onChatDismiss, onChatActivity, onChatOpen }

  const [debugIdlePauseOverride, setDebugIdlePauseOverride] = useState(null)
  const rawIdlePaused = debugIdlePauseOverride !== null ? debugIdlePauseOverride : Boolean(pauseAnimationIdle && isSystemIdle)

  const [headphonesOverride, setHeadphonesOverride] = useState(null)
  const headphonesOverrideRef = useRef(null)
  headphonesOverrideRef.current = headphonesOverride
  const effectiveHeadphones = headphonesOverride !== null ? headphonesOverride : Boolean(mediaPlaying)
  

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
  
  // Hover state for petting and mood indicator
  const [isHoveringHead, setIsHoveringHead] = useState(false)
  const [isHoveringCat, setIsHoveringCat] = useState(false)

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
    run: null
  })
  const isCareActionRef = useRef(false)
  const careTokenRef = useRef(0)
  const performCareActionRef = useRef(null)
  const lastDrinkAffectionTimeRef = useRef(0)
  const runBurstDebugTrackingRef = useRef(false)
  const moveHistoryRef = useRef([])
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const lastMeowTimeRef = useRef(0)
  const meowAudioRef = useRef(null)
  const isReactionActiveRef = useRef(false)
  const reactionTokenRef = useRef(0)
  const reactionTimeoutRef = useRef(null)
  const lastReactionTimesRef = useRef({ sad: 0, annoyed: 0 })
  const isKnockoffActiveRef = useRef(false)
  const pendingKnockoffAnnoyedRef = useRef(false)
  const lastLongNoInteractSadTimeRef = useRef(0)
  const performReactionRef = useRef(null)
  const playMeowRef = useRef(null)

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

  const [displayGeometry, setDisplayGeometry] = useState(null)
  const displayGeometryRef = useRef(null)
  displayGeometryRef.current = displayGeometry

  useEffect(() => {
    let active = true
    if (window.api?.getDisplayGeometry) {
      window.api.getDisplayGeometry().then((geom) => {
        if (active && geom) {
          setDisplayGeometry(geom)
        }
      }).catch((err) => {
        console.warn('[Mascot] getDisplayGeometry failed:', err?.message)
      })
    }
    const unsub = window.api?.on?.('display:changed', (geom) => {
      if (active && geom) {
        setDisplayGeometry(geom)
      }
    })
    return () => {
      active = false
      unsub?.()
    }
  }, [])

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

  const isCareActive = pose === 'eat' || pose === 'drink' || isCareActionRef.current
  const effectiveIdlePaused = Boolean(
    rawIdlePaused &&
    !isReminder &&
    hungerState !== 'ACTIVE' &&
    !pomodoroCelebrating &&
    !dragging &&
    !isCareActive
  )
  const isRoamBlocked = Boolean(
    isReminder ||
    pomodoroCelebrating ||
    chatState !== 'idle' ||
    notificationVisible ||
    (hungerState === 'ACTIVE' && hungerBehavior === 'sit') ||
    isCareActive ||
    effectiveIdlePaused
  )
  const roamBlockedRef = useRef(isRoamBlocked)
  roamBlockedRef.current = isRoamBlocked

  const effectiveIdlePausedRef = useRef(effectiveIdlePaused)
  effectiveIdlePausedRef.current = effectiveIdlePaused

  const prevEffectiveIdlePausedRef = useRef(false)
  useEffect(() => {
    if (effectiveIdlePaused && !prevEffectiveIdlePausedRef.current) {
      if (isDebugRef.current) {
        console.log('[power] Mascot entering idle pause')
      }
      clearTimeout(roamTimeoutRef.current)
      cancelActiveLifeChainRef.current?.('idle_paused')
    } else if (!effectiveIdlePaused && prevEffectiveIdlePausedRef.current) {
      if (isDebugRef.current) {
        console.log('[power] Mascot waking from idle pause')
      }
      setRoamEpoch((e) => e + 1)
      restartIdleVariantTimerRef.current?.('old')
      window.api?.reportActivity?.()
    }
    prevEffectiveIdlePausedRef.current = effectiveIdlePaused
  }, [effectiveIdlePaused])

  const measure = useCallback(() => ({
    width: SPRITE_WIDTH,    // always the sprite, never the container
    height: SPRITE_HEIGHT,  // bubbles must not affect floor math
  }), [])

  const clampToViewport = useCallback(
    (nx, ny) => {
      const geom = displayGeometryRef.current
      const minX = geom?.minCatX ?? NORMAL_CAT_CX
      const maxX = geom?.maxCatX ?? Math.max(minX, (window.screen.availWidth || window.screen.width || 1920) - 160 + NORMAL_CAT_CX)
      const minY = geom?.minCatY ?? NORMAL_CAT_CY
      const maxY = geom?.floorY ?? Math.max(minY, (window.screen.availHeight || window.screen.height || 1080) - (SPRITE_HEIGHT / 2) - FLOOR_GAP_PX + FOOT_PAD_PX)
      return {
        x: clamp(nx, minX, maxX),
        y: clamp(ny, minY, maxY),
      }
    },
    []
  )

  const prevPausedStateRef = useRef(paused)
  useEffect(() => {
    const wasPaused = prevPausedStateRef.current
    prevPausedStateRef.current = paused

    if (paused && !wasPaused) {
      if (isDebugRef.current) console.log('[life] pause: pausing mascot')
      clearTimeout(roamTimeoutRef.current)
      walkTweenRef.current = null
      cancelActiveLifeChainRef.current?.('paused')
      if (poseRef.current !== 'sleep' && !wakingUpRef.current) {
        postureRef.current = 'sit'
        lastSeatedTimeRef.current = Date.now()
        poseRef.current = 'idle'
        setPose('idle')
      }
    } else if (!paused && wasPaused) {
      if (isDebugRef.current) console.log('[life] resume: resuming mascot')
      const { y: floorY } = clampToViewport(posRef.current.x, 999999)
      posRef.current.y = floorY
      setY(floorY)
      dragTargetRef.current = { ...posRef.current }

      if (poseRef.current !== 'sleep' && !wakingUpRef.current) {
        postureRef.current = 'sit'
        lastSeatedTimeRef.current = Date.now()
        poseRef.current = 'idle'
        setPose('idle')
      }

      setRoamEpoch((e) => e + 1)
      restartIdleVariantTimerRef.current?.('new')
      lastInteractRef.current = Date.now()
      lastActivityEndRef.current = Date.now()
    }
  }, [paused, clampToViewport])

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
    const isCareInterrupt = reason.startsWith('care_') || reason === 'pointerdown' || reason === 'unmount'
    const isReactionInterrupt = reason.startsWith('react_') || reason === 'pointerdown' || reason === 'unmount' || reason.startsWith('care_')
    if (!isChainActiveRef.current && (!isCareActionRef.current || !isCareInterrupt) && (!isReactionActiveRef.current || !isReactionInterrupt)) return
    if (isDebugRef.current) {
      if (isChainActiveRef.current) {
        console.log(`[life] chain ${activeChainIdRef.current || 'unknown'} abort ${reason}`)
      }
      if (isCareActionRef.current && isCareInterrupt) {
        console.log(`[life] care abort ${reason}`)
      }
      if (isReactionActiveRef.current && isReactionInterrupt) {
        console.log(`[life] react abort ${reason}`)
      }
    }
    if (isKnockoffActiveRef.current) {
      isKnockoffActiveRef.current = false
      if (Math.random() < 0.60) {
        pendingKnockoffAnnoyedRef.current = true
      }
    }
    if (isCareInterrupt && isCareActionRef.current) {
      careTokenRef.current += 1
      isCareActionRef.current = false
      if (eatTimeoutRef.current) {
        clearTimeout(eatTimeoutRef.current)
        eatTimeoutRef.current = null
      }
    }
    if (isReactionInterrupt && isReactionActiveRef.current) {
      reactionTokenRef.current += 1
      isReactionActiveRef.current = false
      if (reactionTimeoutRef.current) {
        clearTimeout(reactionTimeoutRef.current)
        reactionTimeoutRef.current = null
      }
    }
    if (isChainActiveRef.current) {
      chainTokenRef.current += 1
      isChainActiveRef.current = false
      activeChainIdRef.current = null
      runBurstDebugTrackingRef.current = false
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
    }
  }, [])
  cancelActiveLifeChainRef.current = cancelActiveLifeChain

  const cancelIdleAndOneShot = useCallback(() => {
    cancelActiveLifeChainRef.current?.('cancelIdleAndOneShot')
    if (isKnockoffActiveRef.current) {
      isKnockoffActiveRef.current = false
      if (Math.random() < 0.60) {
        pendingKnockoffAnnoyedRef.current = true
      }
    }
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
  const cancelIdleAndOneShotRef = useRef(cancelIdleAndOneShot)
  cancelIdleAndOneShotRef.current = cancelIdleAndOneShot

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

    if (animName === 'curious' && (chatAnimPhaseRef.current === 'sending' || chatAnimPhaseRef.current === 'thinking')) {
      if (chatCatAnimationsRef.current && !isChatAnimBlockedRef.current?.()) {
        setPose('purr')
        postureRef.current = 'sit'
      }
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
    addAffection: moodAddAffection,
  } = useMood({
    moodEnabled,
    hungerState,
    isSleeping: pose === 'sleep',
    catRemarks,
    onTriggerRemark,
    playOneShot,
    developerMode,
    isIdleForRemarks,
    limitBackgroundCpu,
    idlePaused: effectiveIdlePaused,
  })

  // Log mood changes and initial state on mount (guarded against spam)
  const lastLoggedMoodRef = useRef('')
  useEffect(() => {
    const statsStr = JSON.stringify(stats)
    const logKey = `${moodEnabled}|${moodIndicator}|${mood}|${statsStr}`
    if (lastLoggedMoodRef.current !== logKey) {
      lastLoggedMoodRef.current = logKey
      console.log(`[mood] enabled=${moodEnabled} indicator=${moodIndicator} mood=${mood} stats=${statsStr}`)
    }
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
    const base = anim === 'run' ? RUN_PX_PER_CYCLE : WALK_PX_PER_CYCLE
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
    holdPose = false,
    skipStartAccent = false,
    onArrive,
    onAbort
  }) => {
    if (token && chainTokenRef.current !== token) return
    if (gen && gen !== roamGenRef.current) return

    const geom = displayGeometryRef.current
    const screenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
    const catW = measure().width
    const minX = geom ? geom.minCatX : edgeMargin
    const maxX = geom ? geom.maxCatX : Math.max(minX, screenW - catW - edgeMargin)
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
      anim === 'run'
        ? [RUN_SPEED_MIN_PX_S, RUN_SPEED_MAX_PX_S]
        : [WALK_SPEED_MIN_PX_S, WALK_SPEED_MAX_PX_S]
    )

    const speedMult = getMovementSpeedMultiplier(statsRef.current?.energy ?? 100, new Date())
    const nominalSpeed = randBetween(effectiveSpeedRange[0], effectiveSpeedRange[1]) * speedMult

    const duration = (realDist / nominalSpeed) * 1000
    const groundSpeed = realDist / (duration / 1000)

    const baseFps = anim === 'run' ? 14 : 12
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
      if (holdPose) {
        // Continuous movement across legs: keep playing run animation
      } else {
        setWalkSpeedRate(1)
        if (postureRef.current === 'stand') {
          poseRef.current = 'standidle'
          setPose('standidle')
        }
        triggerAccentRef.current('is-squash')
      }
      lastActivityEndRef.current = Date.now()
      if (reason === 'blocked') {
        onAbort?.('blocked during move')
      } else {
        onArrive?.()
      }
    }

    const startMoving = () => {
      if (moveEnded) return
      if (token && chainTokenRef.current !== token) return
      if (gen && (gen !== roamGenRef.current || roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current)) {
        scheduleStandSafetyNetRef.current?.()
        return
      }

      setWalkMs(duration)
      if (!skipStartAccent) {
        triggerAccentRef.current('is-stretch')
      }

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
    }

    if (currentDrawnAnimRef.current === anim) {
      startMoving()
    } else {
      const cancelShown = waitForAnimShownRef.current?.(anim, () => {
        startMoving()
      })
      if (cancelShown && token) {
        chainTimeoutsRef.current.push(cancelShown)
      }
    }
  }
  performMovementRef.current = performMovement

  const executeChainMove = (
    token,
    anim,
    distanceOrTarget,
    pxPerCycle,
    speedRange,
    edgeMargin,
    onArrive,
    onAbort,
    options = {}
  ) => {
    performMovement({
      anim,
      distanceOrTarget,
      speedRange,
      edgeMargin,
      token,
      onArrive,
      onAbort,
      ...options
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
      poseRef.current === 'drink' ||
      poseRef.current === 'sad' ||
      poseRef.current === 'annoyed' ||
      isCareActionRef.current ||
      isReactionActiveRef.current ||
      eatTimeoutRef.current ||
      reactionTimeoutRef.current
    ) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort not seated idle (pose=${poseRef.current}, posture=${postureRef.current})`)
      return false
    }
    if (mediaPlayingRef.current && (chainId === 'nap_elsewhere' || chainId === 'sleep')) {
      if (isDebugRef.current) console.log(`[life] chain ${chainId} abort sleep chain blocked during music`)
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
      const isPlayful = chainId === 'run_burst' || (chainId === 'walk_then_act' && forcedActionX === 'toyplay')
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
    } else if (chainId === 'run_burst') {
      advanceStep(1, () => {
        if (isDebugRef.current) console.log('[life] chain run_burst step 1 standup')
        ensureStandingRef.current?.(token, () => {
          const totalLegs = Math.floor(randBetween(1, 3.99))
          let currentLeg = 0
          runBurstDebugTrackingRef.current = true
          const runNextLeg = () => {
            if (chainTokenRef.current !== token) {
              runBurstDebugTrackingRef.current = false
              return
            }
            currentLeg += 1
            const isLastLeg = currentLeg === totalLegs
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
                  runNextLeg()
                } else {
                  advanceStep(3, () => {
                    if (isDebugRef.current) console.log('[life] chain run_burst step 3 standidle')
                    runBurstDebugTrackingRef.current = false
                    setWalkSpeedRate(1)
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
                runBurstDebugTrackingRef.current = false
                endChain(abortReason)
              },
              {
                holdPose: !isLastLeg,
                skipStartAccent: currentLeg > 1
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
        ensureStandingRef.current?.(token, () => {
          const geom = displayGeometryRef.current
          const catW = measure().width
          const screenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
          const minX = geom ? geom.minCatX : 40
          const maxX = geom ? geom.maxCatX : Math.max(minX, screenW - catW - 40)
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

  const performCareAction = useCallback((actionType, isDebugOverride = false) => {
    if (!['eat', 'drink'].includes(actionType)) {
      console.warn(`[life] care: unknown actionType '${actionType}'`)
      return
    }

    if (!isDebugOverride) {
      if (isCareActionRef.current) {
        console.log(`[life] care ${actionType} ignored: care action already in progress`)
        return
      }
      if (draggingRef.current || dragPointerDownRef.current) {
        console.log(`[life] care ${actionType} ignored: dragging active`)
        return
      }
    }

    // Interrupt whatever she was doing
    cancelActiveLifeChainRef.current?.(`care_${actionType}`)
    const token = ++chainTokenRef.current
    careTokenRef.current = token
    isCareActionRef.current = true
    console.log(`[life] care ${actionType} start (token=${token})`)

    walkTweenRef.current = null
    setWalkMs(0)
    setWalkSpeedRate(1)
    clearTimeout(roamTimeoutRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)
    clearTimeout(eatTimeoutRef.current)
    if (oneShotTimeoutRef.current) {
      clearTimeout(oneShotTimeoutRef.current)
      oneShotTimeoutRef.current = null
    }
    oneShotPoseRef.current = null
    setOneShotPose(null)
    setIsHoveringHead(false)

    let isFinished = false

    const finishCare = (reason) => {
      if (isFinished || careTokenRef.current !== token || chainTokenRef.current !== token) return
      isFinished = true
      if (eatTimeoutRef.current) {
        clearTimeout(eatTimeoutRef.current)
        eatTimeoutRef.current = null
      }

      isCareActionRef.current = false
      postureRef.current = 'sit'
      lastSeatedTimeRef.current = Date.now()
      poseRef.current = 'idle'
      setPose('idle')
      restartIdleVariantTimerRef.current?.('new')
      lastActivityEndRef.current = Date.now()

      if (actionType === 'eat') {
        onFeedComplete?.()
      }

      console.log(`[life] care ${actionType} end (${reason})`)
    }

    const runCareAnimation = () => {
      if (careTokenRef.current !== token || chainTokenRef.current !== token) return
      console.log(`[life] care ${actionType} posture: sitting ready`)

      // Wait for strip first frame to be shown
      waitForAnimShownRef.current?.(actionType, () => {
        if (careTokenRef.current !== token || chainTokenRef.current !== token) return
        console.log(`[life] care ${actionType} strip shown: ${actionType}`)
      })

      // Audio & speech bubble
      if (actionType === 'eat') {
        onEatStart?.()
        onTriggerRemark?.('Yum!')
        moodAddAffection?.(3)
      } else if (actionType === 'drink') {
        const now = Date.now()
        if (now - lastDrinkAffectionTimeRef.current >= 3 * 60 * 1000) {
          lastDrinkAffectionTimeRef.current = now
          moodAddAffection?.(2)
        }
        onTriggerRemark?.('Cheers!')
      }

      // Safety net timeout
      const animDuration = getAnimationDuration(actionType, catAnimationSpeed) || 2670
      clearTimeout(eatTimeoutRef.current)
      eatTimeoutRef.current = setTimeout(() => {
        eatTimeoutRef.current = null
        finishCare('timeout_safety')
      }, animDuration + 1500)

      playOnceAnimationRef.current?.(token, actionType, () => {
        if (eatTimeoutRef.current) {
          clearTimeout(eatTimeoutRef.current)
          eatTimeoutRef.current = null
        }
        finishCare('complete')
      })
    }

    const prepareAndRun = () => {
      if (careTokenRef.current !== token || chainTokenRef.current !== token) return
      ensureSittingRef.current?.(token, runCareAnimation)
    }

    if (poseRef.current === 'sleep') {
      suppressWakeStretchRef.current = true
      wakeTo('idle', () => {
        suppressWakeStretchRef.current = false
        prepareAndRun()
      })
    } else {
      prepareAndRun()
    }
  }, [wakeTo, onEatStart, onFeedComplete, onTriggerRemark, moodAddAffection, catAnimationSpeed])
  performCareActionRef.current = performCareAction

  const playMeow = useCallback((reason, isOverride = false) => {
    if (!isOverride) {
      if (poseRef.current === 'sleep') return
      if (draggingRef.current || dragPointerDownRef.current) return
      if (poseRef.current === 'typing' || poseRef.current === 'typingfast') return

      const cooldown = (reason === 'reminder' || reason === 'hunger') ? 4000 : 12000
      if (Date.now() - lastMeowTimeRef.current < cooldown) return

      if (paused) return
      if (!settingsRef.current?.soundEffects) return
    }

    try {
      if (!meowAudioRef.current) {
        meowAudioRef.current = new Audio(meowUrl)
      }
      const audio = meowAudioRef.current.cloneNode()
      const vol = typeof settingsRef.current?.soundVolume === 'number' ? settingsRef.current.soundVolume : 70
      audio.volume = Math.max(0, Math.min(1, vol / 100))
      const p = audio.play()
      if (p && typeof p.catch === 'function') {
        p.catch(() => {})
      }
      lastMeowTimeRef.current = Date.now()
      if (isDebugRef.current) {
        console.log(`[life] meow ${reason}`)
      }
    } catch (_err) {
      // silent
    }
  }, [paused])
  playMeowRef.current = playMeow

  const performReaction = useCallback((reactionType, reason, isOverride = false) => {
    if (!['sad', 'annoyed'].includes(reactionType)) {
      console.warn(`[life] react: unknown reaction '${reactionType}'`)
      return false
    }

    if (!isOverride) {
      if (isCareActionRef.current) return false
      if (isReactionActiveRef.current) return false
      if (draggingRef.current || dragPointerDownRef.current) return false
      if (poseRef.current === 'sleep') return false
      if (poseRef.current === 'typing' || poseRef.current === 'typingfast') return false
      if (isReminder) return false

      const isExplicitTrigger = reason === 'hunger_later' || reason === 'no_interaction' || reason === 'wake_click' || reason === 'knockoff_aborted'
      if (isChainActiveRef.current && !isExplicitTrigger) return false

      const now = Date.now()
      const lastTime = lastReactionTimesRef.current[reactionType] || 0
      const cooldown = isExplicitTrigger ? REACTION_COOLDOWN_EVENT_MS : REACTION_COOLDOWN_IDLE_MS
      if (now - lastTime < cooldown) return false
    } else {
      if (isCareActionRef.current || isReactionActiveRef.current || draggingRef.current || dragPointerDownRef.current || poseRef.current === 'sleep' || poseRef.current === 'typing' || poseRef.current === 'typingfast' || isReminder) {
        return false
      }
    }

    cancelActiveLifeChainRef.current?.(`react_${reactionType}`)
    const token = ++chainTokenRef.current
    reactionTokenRef.current = token
    isReactionActiveRef.current = true
    lastReactionTimesRef.current[reactionType] = Date.now()

    console.log(`[life] react ${reactionType} (${reason})`)
    console.log(`[life] react ${reactionType} start (reason=${reason}, token=${token})`)

    walkTweenRef.current = null
    setWalkMs(0)
    setWalkSpeedRate(1)
    clearTimeout(roamTimeoutRef.current)
    clearTimeout(idleBehaviorTimeoutRef.current)
    clearTimeout(eatTimeoutRef.current)
    if (oneShotTimeoutRef.current) {
      clearTimeout(oneShotTimeoutRef.current)
      oneShotTimeoutRef.current = null
    }
    oneShotPoseRef.current = null
    setOneShotPose(null)
    setIsHoveringHead(false)

    let isFinished = false

    const finishReaction = (finishReason) => {
      if (isFinished || reactionTokenRef.current !== token || chainTokenRef.current !== token) return
      isFinished = true
      if (reactionTimeoutRef.current) {
        clearTimeout(reactionTimeoutRef.current)
        reactionTimeoutRef.current = null
      }

      isReactionActiveRef.current = false
      postureRef.current = 'sit'
      lastSeatedTimeRef.current = Date.now()
      poseRef.current = 'idle'
      setPose('idle')
      restartIdleVariantTimerRef.current?.('new')
      lastActivityEndRef.current = Date.now()

      console.log(`[life] react ${reactionType} end (${finishReason})`)
    }

    const runReactionAnimation = () => {
      if (reactionTokenRef.current !== token || chainTokenRef.current !== token) return
      console.log(`[life] react ${reactionType} posture: sitting ready`)

      waitForAnimShownRef.current?.(reactionType, () => {
        if (reactionTokenRef.current !== token || chainTokenRef.current !== token) return
        console.log(`[life] react ${reactionType} strip shown: ${reactionType}`)
      })

      const animDuration = getAnimationDuration(reactionType, catAnimationSpeed) || 2670
      clearTimeout(reactionTimeoutRef.current)
      reactionTimeoutRef.current = setTimeout(() => {
        reactionTimeoutRef.current = null
        finishReaction('timeout_safety')
      }, animDuration + 1500)

      playOnceAnimationRef.current?.(token, reactionType, () => {
        if (reactionTimeoutRef.current) {
          clearTimeout(reactionTimeoutRef.current)
          reactionTimeoutRef.current = null
        }
        finishReaction('complete')
      })
    }

    ensureSittingRef.current?.(token, runReactionAnimation)
    return true
  }, [isReminder, catAnimationSpeed])
  performReactionRef.current = performReaction

  const handleFeedTrigger = useCallback(() => {
    if (hungerState === 'ACTIVE') {
      if (onFeed) onFeed()
      performCareAction('eat')
    }
  }, [hungerState, onFeed, performCareAction])

  const executeAction = useCallback((action) => {
    lastInteractRef.current = Date.now()
    switch (action) {
      case 'react':
        if (poseRef.current === 'sleep') {
          const rollAnnoyed = Math.random() < 0.50
          if (rollAnnoyed) {
            suppressWakeStretchRef.current = true
            wakeTo('idle', () => {
              suppressWakeStretchRef.current = false
              setRoamEpoch((n) => n + 1)
              performReactionRef.current?.('annoyed', 'wake_click')
            })
          } else {
            wakeTo('idle', () => {
              setRoamEpoch((n) => n + 1)
            })
          }
          onWakeUpClick?.()
        } else if (hungerState === 'ACTIVE') {
          handleFeedTrigger()
        } else {
          triggerAccentRef.current('is-stretch')
          onLeftClickReact?.()
          if (Math.random() < 0.40) {
            playMeowRef.current?.('click')
          }
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
      performCareAction('eat')
    }
  }, [feedSignal, performCareAction])

  const pendingDrinkRef = useRef(false)
  const pendingDrinkTimerRef = useRef(null)

  const prevDrinkSignalRef = useRef(drinkSignal)
  useEffect(() => {
    if (prevDrinkSignalRef.current !== drinkSignal) {
      prevDrinkSignalRef.current = drinkSignal
      if (isReminder) {
        pendingDrinkRef.current = true
        if (pendingDrinkTimerRef.current) clearTimeout(pendingDrinkTimerRef.current)
        pendingDrinkTimerRef.current = setTimeout(() => {
          if (pendingDrinkRef.current) {
            pendingDrinkRef.current = false
            performCareAction('drink')
          }
        }, 350)
      } else {
        performCareAction('drink')
      }
    }
  }, [drinkSignal, isReminder, performCareAction])

  useEffect(() => {
    if (!isReminder && pendingDrinkRef.current) {
      pendingDrinkRef.current = false
      if (pendingDrinkTimerRef.current) {
        clearTimeout(pendingDrinkTimerRef.current)
        pendingDrinkTimerRef.current = null
      }
      performCareAction('drink')
    }
  }, [isReminder, performCareAction])

  useEffect(() => {
    return () => {
      if (pendingDrinkTimerRef.current) {
        clearTimeout(pendingDrinkTimerRef.current)
      }
    }
  }, [])

  const prevReminderStateRef = useRef(reminderState)
  useEffect(() => {
    if (prevReminderStateRef.current !== reminderState) {
      if (reminderState === REMINDER_STATE?.ACTIVE) {
        playMeowRef.current?.('reminder')
      }
      prevReminderStateRef.current = reminderState
    }
  }, [reminderState, REMINDER_STATE])

  const prevHungerStateRef = useRef(hungerState)
  useEffect(() => {
    if (prevHungerStateRef.current !== hungerState) {
      if (hungerState === 'ACTIVE') {
        playMeowRef.current?.('hunger')
      }
      prevHungerStateRef.current = hungerState
    }
  }, [hungerState])

  const prevHungerLaterSignalRef = useRef(hungerLaterSignal)
  useEffect(() => {
    if (prevHungerLaterSignalRef.current !== hungerLaterSignal) {
      prevHungerLaterSignalRef.current = hungerLaterSignal
      if (hungerLaterSignal > 0) {
        if (Math.random() < 0.60) {
          setTimeout(() => {
            performReactionRef.current?.('sad', 'hunger_later')
          }, 400)
        }
      }
    }
  }, [hungerLaterSignal])

  useEffect(() => {
    const checkInterval = limitBackgroundCpu ? 30000 : 15000
    const interval = setInterval(() => {
      const now = Date.now()
      const idleTime = now - lastInteractRef.current
      const sinceLastSad = now - lastLongNoInteractSadTimeRef.current
      if (idleTime >= 20 * 60 * 1000 && sinceLastSad >= 20 * 60 * 1000) {
        const started = performReactionRef.current?.('sad', 'no_interaction')
        if (started) {
          lastLongNoInteractSadTimeRef.current = now
        }
      }
    }, checkInterval)
    return () => clearInterval(interval)
  }, [limitBackgroundCpu])

  // ── Chat animations ────────────────────────────────────────────────────────
  const chatCatAnimationsRef = useRef(chatCatAnimations)
  chatCatAnimationsRef.current = chatCatAnimations
  const chatAnimPhaseRef = useRef(chatAnimPhase)
  chatAnimPhaseRef.current = chatAnimPhase
  const chatAnimTokenRef = useRef(0)
  const chatDoneTimerRef = useRef(null)

  const isChatAnimBlocked = useCallback(() => {
    return (
      !chatCatAnimationsRef.current ||
      isReminder ||
      isCareActionRef.current ||
      poseRef.current === 'eat' ||
      poseRef.current === 'drink' ||
      draggingRef.current ||
      poseRef.current === 'sleep' ||
      wakingUpRef.current ||
      poseRef.current === 'typing' ||
      poseRef.current === 'typingfast'
    )
  }, [isReminder])
  const isChatAnimBlockedRef = useRef(isChatAnimBlocked)
  isChatAnimBlockedRef.current = isChatAnimBlocked

  const triggerChatAnimPhase = useCallback((phase) => {
    if (isDebugRef.current) {
      console.log(`[chat-anim] phase: ${phase}`)
    }
    chatAnimPhaseRef.current = phase
    if (chatDoneTimerRef.current) {
      clearTimeout(chatDoneTimerRef.current)
      chatDoneTimerRef.current = null
    }

    if (phase === 'done') {
      chatAnimTokenRef.current += 1
      chatDoneTimerRef.current = setTimeout(() => {
        chatDoneTimerRef.current = null
        if (poseRef.current === 'curious' || poseRef.current === 'purr' || poseRef.current === 'talk') {
          setPose('idle')
          postureRef.current = 'sit'
        }
      }, 200)
      return
    }

    if (isChatAnimBlocked()) {
      if (isDebugRef.current) {
        console.log('[chat-anim] blocked by active state or pose')
      }
      return
    }

    cancelActiveLifeChainRef.current?.('chat_anim')
    const token = ++chatAnimTokenRef.current

    if (phase === 'sending') {
      ensureSittingRef.current?.(null, () => {
        if (token !== chatAnimTokenRef.current || isChatAnimBlocked()) return
        setPose('curious')
        postureRef.current = 'sit'
      })
    } else if (phase === 'thinking') {
      if (poseRef.current !== 'curious') {
        ensureSittingRef.current?.(null, () => {
          if (token !== chatAnimTokenRef.current || isChatAnimBlocked()) return
          setPose('purr')
          postureRef.current = 'sit'
        })
      }
    } else if (phase === 'replying') {
      ensureSittingRef.current?.(null, () => {
        if (token !== chatAnimTokenRef.current || isChatAnimBlocked()) return
        setPose('talk')
        postureRef.current = 'sit'
      })
    }
  }, [isChatAnimBlocked])

  const triggerChatAnimPhaseRef = useRef(triggerChatAnimPhase)
  triggerChatAnimPhaseRef.current = triggerChatAnimPhase

  useEffect(() => {
    if (!chatCatAnimations && chatAnimPhase !== 'done') return
    triggerChatAnimPhase(chatAnimPhase)
  }, [chatAnimPhase, chatCatAnimations, triggerChatAnimPhase])

  useEffect(() => {
    if (pendingKnockoffAnnoyedRef.current && pose === 'idle' && postureRef.current === 'sit' && !dragging && !isCareActionRef.current && !isReactionActiveRef.current) {
      const timer = setTimeout(() => {
        if (pendingKnockoffAnnoyedRef.current && poseRef.current === 'idle' && postureRef.current === 'sit' && !draggingRef.current && !isCareActionRef.current && !isReactionActiveRef.current) {
          pendingKnockoffAnnoyedRef.current = false
          performReactionRef.current?.('annoyed', 'knockoff_aborted')
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [pose, dragging])

  // Wake cat from sleep when music starts playing and manage sleep timer
  const prevMediaPlayingStateRef = useRef(mediaPlaying)
  useEffect(() => {
    const wasPlaying = prevMediaPlayingStateRef.current
    prevMediaPlayingStateRef.current = mediaPlaying

    if (mediaPlaying) {
      lastInteractRef.current = Date.now()
      if (poseRef.current === 'sleep' || pose === 'sleep' || wakingUpRef.current) {
        suppressWakeStretchRef.current = true
        wakeTo('idle', () => {
          suppressWakeStretchRef.current = false
        })
      }
    } else if (wasPlaying && !mediaPlaying) {
      // Music stopped: restart sleep timer counting from this moment
      lastInteractRef.current = Date.now()
    }
  }, [mediaPlaying, pose, wakeTo])

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
      if (['eat', 'drink', 'pet', 'purr', 'play', 'toyplay'].includes(poseRef.current)) {
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
        if (poseRef.current.startsWith('walk') || poseRef.current.startsWith('run')) {
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
          if (onComplete) {
            onComplete()
          } else {
            setWalkMs(0)
            setWalkSpeedRate(1)
            if (postureRef.current === 'stand') {
              poseRef.current = 'standidle'
              setPose('standidle')
            } else if (poseRef.current.startsWith('walk') || poseRef.current.startsWith('run')) {
              poseRef.current = 'idle'
              setPose('idle')
            }
            triggerAccentRef.current('is-squash')
            lastActivityEndRef.current = Date.now()
          }
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
        const geom = displayGeometryRef.current
        const screenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
        const screenH = geom?.workArea?.height ?? (window.screen.availHeight || window.screen.height || 1080)
        const waX = geom?.workArea?.x ?? 0
        const waY = geom?.workArea?.y ?? 0
        const cX = Math.round(waX + screenW / 2)
        const cY = Math.round(waY + screenH / 2)
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
        postureRef.current = 'sit'
        lastSeatedTimeRef.current = Date.now()
        restartIdleVariantTimerRef.current?.('new')
        lastActivityEndRef.current = Date.now()
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
      if (!isCareActive) {
        clearTimeout(idleBehaviorTimeoutRef.current)
      }
      setWalkMs(0)
      if (isCareActive) {
        // preserve care action (eat / drink)
      } else if (isReminder) {
        lastInteractRef.current = Date.now()
        poseRef.current = 'alert'
        setPose('alert')
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
        if (!isCareActive) {
          clearTimeout(idleBehaviorTimeoutRef.current)
        }
      }
    }

    if (poseRef.current === 'alert' && !isCareActive) {
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
      if (effectiveIdlePausedRef.current) {
        if (isDebugRef.current) {
          console.log('[Mascot] Roam outcome: blocked by guard (idle paused), next attempt in 5000ms')
        }
        later(walkOnce, 5000)
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
      const geom = displayGeometryRef.current
      const { width } = measure()
      const minX = geom ? geom.minCatX : MARGIN
      const screenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
      const maxX = geom ? geom.maxCatX : Math.max(minX, screenW - width - MARGIN)
      const currentX = posRef.current.x
      let dir
      let targetX
      let realDist

      // Edge walk roll: 15% chance to intentionally pick an edge-zone destination
      const trueRightEdge = geom ? geom.maxCatX : Math.max(NORMAL_CAT_CX, screenW - 160 + NORMAL_CAT_CX)
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
                isKnockoffActiveRef.current = true
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
                    playOneShotRef.current?.('knockoff', () => {
                      isKnockoffActiveRef.current = false
                    })
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
                          playOneShotRef.current?.('knockoff', () => {
                            isKnockoffActiveRef.current = false
                          })
                        })
                      }, randBetween(600, 1000))
                    },
                    onAbort: () => {
                      scheduleStandSafetyNetRef.current?.()
                      if (isKnockoffActiveRef.current) {
                        isKnockoffActiveRef.current = false
                        if (Math.random() < 0.60) {
                          pendingKnockoffAnnoyedRef.current = true
                        }
                      }
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
      if (!isCareActive) {
        clearTimeout(idleBehaviorTimeoutRef.current)
      }
    }
  }, [isReminder, roamEpoch, measure, pomodoroCelebrating, chatState, notificationVisible, wakeUp, isRoamBlocked, isCareActive])

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
      const geom = displayGeometryRef.current
      const currentScreenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
      const trueRightEdge = geom ? geom.maxCatX : Math.max(NORMAL_CAT_CX, currentScreenW - 160 + NORMAL_CAT_CX)
      const inEdgeZone = posRef.current.x >= trueRightEdge - KNOCKOFF_EDGE_DIST_PX
      const canKnockoff = now - lastKnockoffRef.current >= KNOCKOFF_COOLDOWN_MS
      if (inEdgeZone && canKnockoff && Math.random() < KNOCKOFF_IDLE_CHANCE) {
        lastKnockoffRef.current = now
        lastIdleBehaviorRef.current = 'knockoff'
        isKnockoffActiveRef.current = true
        const remainingDist = trueRightEdge - posRef.current.x
        if (remainingDist <= 3) {
          facingRef.current = 'right'
          if (isDebugRef.current) {
            console.log(`[Mascot] Idle-life outcome: started knockoff at edge zone, next attempt in ${Math.round(nextDelay)}ms`)
          }
          playOneShotRef.current?.('knockoff', () => {
            isKnockoffActiveRef.current = false
          })
          return nextDelay
        } else if (!roamBlockedRef.current) {
          ensureStandingRef.current?.(null, () => {
            if (roamBlockedRef.current || draggingRef.current || dragPointerDownRef.current) {
              scheduleStandSafetyNetRef.current?.()
              if (isKnockoffActiveRef.current) {
                isKnockoffActiveRef.current = false
                if (Math.random() < 0.60) {
                  pendingKnockoffAnnoyedRef.current = true
                }
              }
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
                    playOneShotRef.current?.('knockoff', () => {
                      isKnockoffActiveRef.current = false
                    })
                  })
                }, randBetween(600, 1000))
              },
              onAbort: () => {
                scheduleStandSafetyNetRef.current?.()
                if (isKnockoffActiveRef.current) {
                  isKnockoffActiveRef.current = false
                  if (Math.random() < 0.60) {
                    pendingKnockoffAnnoyedRef.current = true
                  }
                }
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
            if (selected.pose === 'sad' || selected.pose === 'annoyed') {
              performReactionRef.current?.(selected.pose, 'idle_life')
            } else {
              playOneShotRef.current?.(selected.pose)
            }
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
  const processChaseCursorOffset = useCallback((offset) => {
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
      isCareActive
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
    const geom = displayGeometryRef.current
    const { width } = measure()
    const screenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
    const minX = geom ? geom.minCatX : MARGIN
    const maxX = geom ? geom.maxCatX : Math.max(minX, screenW - width - MARGIN)
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
  }, [
    isRoamBlocked,
    hungerState,
    chatState,
    isReminder,
    isCareActive,
    measure,
    cancelIdleAndOneShot,
    playOneShot,
    onTriggerRemark,
  ])

  // On-demand chase sampling when eyeTracking is OFF
  const activeChaseCheckRef = useRef(false)
  const isChaseEligible = useCallback(() => {
    return Boolean(
      mouseReaction &&
      !reduceResourceUsage &&
      !paused &&
      !isChainActiveRef.current &&
      poseRef.current === 'idle' &&
      !oneShotPoseRef.current &&
      !walkTweenRef.current &&
      !chaseRafRef.current &&
      !draggingRef.current &&
      !dragPointerDownRef.current &&
      !isRoamBlocked &&
      !isChasingRef.current &&
      Date.now() >= calmUntilRef.current &&
      Date.now() - lastChaseTimeRef.current >= 30000 &&
      !mediaPlayingRef.current &&
      hungerState !== 'ACTIVE' &&
      chatState === 'idle' &&
      !isReminder &&
      !isCareActive
    )
  }, [mouseReaction, reduceResourceUsage, paused, isRoamBlocked, hungerState, chatState, isReminder, isCareActive])

  const handlePointerNearForChase = useCallback(async () => {
    if (eyeTracking || !mouseReaction || activeChaseCheckRef.current || !isChaseEligible()) return
    activeChaseCheckRef.current = true
    let ticks = 0
    const checkInterval = setInterval(async () => {
      ticks++
      if (ticks > 4 || !isChaseEligible() || !window.api?.getCursorOffset) {
        clearInterval(checkInterval)
        activeChaseCheckRef.current = false
        return
      }
      const offset = await window.api.getCursorOffset()
      if (offset) {
        processChaseCursorOffset(offset)
      }
    }, 300)
  }, [eyeTracking, mouseReaction, isChaseEligible, processChaseCursorOffset])

  useEffect(() => {
    if (!mouseReaction || reduceResourceUsage || paused) {
      cursorHistoryRef.current = []
      return undefined
    }

    if (!eyeTracking) {
      return undefined
    }

    const unsub = window.api?.on?.('mascot:cursor-offset', (offset) => {
      processChaseCursorOffset(offset)
    })

    return () => {
      unsub?.()
    }
  }, [mouseReaction, reduceResourceUsage, paused, eyeTracking, processChaseCursorOffset])

  // ── Part 4: Call Cat Listener ─────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.api?.on?.('mascot:call', (payload) => {
      moodHandleShortcutCall()
      // Ignore if dragging, eating/drinking, or in reminder / chat
      if (
        draggingRef.current ||
        dragPointerDownRef.current ||
        isCareActionRef.current ||
        poseRef.current === 'eat' ||
        poseRef.current === 'drink' ||
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
      const geom = displayGeometryRef.current
      const screenW = geom?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
      const minX = geom ? geom.minCatX : NORMAL_CAT_CX
      const maxX = geom ? geom.maxCatX : Math.max(minX, screenW - 160 + NORMAL_CAT_CX)
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
    try { containerRef.current?.setPointerCapture(event.pointerId) } catch (err) { void err }

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
    window.api?.reportActivity?.()
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
      lastInteractRef.current = Date.now()
      onPetStart?.()
      if (Math.random() < 0.40) {
        playMeowRef.current?.('pet')
      }
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

  const handleMouseEnter = () => {
    setIsHoveringCat(true)
    handlePointerNearForChase?.()
  }
  const handleMouseLeave = () => {
    setIsHoveringCat(false)
  }

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
              !(mediaPlayingRef.current && (id === 'nap_elsewhere' || id === 'sleep'))
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
        if (!['walk', 'run'].includes(name)) {
          console.warn(`[life] setStride: invalid anim '${name}'. Expected walk|run`)
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
        const anim = ['walk', 'run'].includes(name) ? name : 'walk'
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
      care: (action) => {
        if (!['eat', 'drink'].includes(action)) {
          console.warn(`[life] care: unknown action '${action}'. Expected eat|drink`)
          return false
        }
        performCareActionRef.current?.(action, true)
        return true
      },
      meow: () => {
        playMeowRef.current?.('debug', true)
        return true
      },
      react: (reaction) => {
        if (!['sad', 'annoyed'].includes(reaction)) {
          console.warn(`[life] react: unknown reaction '${reaction}'. Expected sad|annoyed`)
          return false
        }
        return performReactionRef.current?.(reaction, 'debug', true) ?? false
      },
      idlePause: (val) => {
        setDebugIdlePauseOverride(Boolean(val))
        return Boolean(val)
      },
      chatState: (state) => {
        if (!['sending', 'thinking', 'replying', 'done'].includes(state)) {
          console.warn(`[life] chatState: unknown state '${state}'. Expected sending|thinking|replying|done`)
          return false
        }
        triggerChatAnimPhaseRef.current?.(state)
        return true
      },
      perf: (enable) => {
        if (!enable) {
          if (perfIntervalRef.current) {
            clearInterval(perfIntervalRef.current)
            perfIntervalRef.current = null
            console.log('[perf] Profiling stopped')
          }
          return false
        }
        if (perfIntervalRef.current) {
          clearInterval(perfIntervalRef.current)
        }
        console.log('[perf] Profiling started (reporting every 10s)')
        let lastReportTime = Date.now()
        let lastRenders = window.__sbPerfCounters?.mascotRenders || 0
        let lastRafs = window.__sbPerfCounters?.rafTicks || 0
        let lastDraws = window.__sbPerfCounters?.canvasDraws || 0
        let lastTimers = window.__sbPerfCounters?.timerTicks || 0
        let lastHyprctl = 0
        let lastIpcReceived = {}
        let lastIpcSent = {}

        const report = async () => {
          const now = Date.now()
          const elapsedSec = (now - lastReportTime) / 1000 || 10
          lastReportTime = now

          const curRenders = window.__sbPerfCounters?.mascotRenders || 0
          const curRafs = window.__sbPerfCounters?.rafTicks || 0
          const curDraws = window.__sbPerfCounters?.canvasDraws || 0
          const curTimers = window.__sbPerfCounters?.timerTicks || 0

          const diffRenders = ((curRenders - lastRenders) / elapsedSec).toFixed(1)
          const diffRafs = ((curRafs - lastRafs) / elapsedSec).toFixed(1)
          const diffDraws = ((curDraws - lastDraws) / elapsedSec).toFixed(1)
          const diffTimers = ((curTimers - lastTimers) / elapsedSec).toFixed(1)

          lastRenders = curRenders
          lastRafs = curRafs
          lastDraws = curDraws
          lastTimers = curTimers

          let diffHyprctl = '0.0'
          if (window.api?.getMainPerfStats) {
            try {
              const mainStats = await window.api.getMainPerfStats()
              if (mainStats) {
                const curHypr = mainStats.hyprctlSpawns || 0
                diffHyprctl = ((curHypr - lastHyprctl) / elapsedSec).toFixed(1)
                lastHyprctl = curHypr
              }
            } catch (err) {
              void err
            }
          }

          let topRxStr = 'none'
          let topTxStr = 'none'
          if (window.api?.getIpcStats) {
            try {
              const ipcStats = window.api.getIpcStats()
              const rxDiffs = []
              for (const [ch, cnt] of Object.entries(ipcStats.received || {})) {
                const delta = cnt - (lastIpcReceived[ch] || 0)
                if (delta > 0) rxDiffs.push({ ch, rate: (delta / elapsedSec).toFixed(1) })
              }
              rxDiffs.sort((a, b) => b.rate - a.rate)
              topRxStr = rxDiffs.slice(0, 5).map((x) => `${x.ch}: ${x.rate}/s`).join(', ') || 'none'
              lastIpcReceived = { ...ipcStats.received }

              const txDiffs = []
              for (const [ch, cnt] of Object.entries(ipcStats.sent || {})) {
                const delta = cnt - (lastIpcSent[ch] || 0)
                if (delta > 0) txDiffs.push({ ch, rate: (delta / elapsedSec).toFixed(1) })
              }
              txDiffs.sort((a, b) => b.rate - a.rate)
              topTxStr = txDiffs.slice(0, 5).map((x) => `${x.ch}: ${x.rate}/s`).join(', ') || 'none'
              lastIpcSent = { ...ipcStats.sent }
            } catch (err) {
              void err
            }
          }

          console.log(`[perf] Mascot renders/s: ${diffRenders} | rAF/s: ${diffRafs} | Draws/s: ${diffDraws} | hyprctl/s: ${diffHyprctl} | Timers/s: ${diffTimers}`)
          console.log(`[perf] Top IPC Rx: [${topRxStr}] | Tx: [${topTxStr}]`)
        }

        perfIntervalRef.current = setInterval(report, 10000)
        return true
      },
      headphones: (val) => {
        if (val === undefined) {
          const currentVal = headphonesOverrideRef.current ?? 'auto'
          console.log(`[headphones] override: current=${currentVal}`)
          return currentVal
        }
        if (val === 'auto') {
          headphonesOverrideRef.current = null
          setHeadphonesOverride(null)
          console.log('[headphones] override: auto (following mediaPlaying)')
          return 'auto'
        }
        const b = Boolean(val)
        headphonesOverrideRef.current = b
        setHeadphonesOverride(b)
        console.log(`[headphones] override: ${b}`)
        return b
      },
      anim: (name) => {
        if (!animsManifest?.animations?.[name]) {
          console.warn(`[life] anim: unknown animation '${name}'`)
          return false
        }
        console.log(`[life] anim ${name} start`)
        cancelActiveLifeChainRef.current?.('debug_anim')
        cancelIdleAndOneShotRef.current?.()
        if (poseRef.current === 'typing' || poseRef.current === 'typingfast' || postureRef.current !== 'sit' || poseRef.current === 'sleep') {
          poseRef.current = 'idle'
          setPose('idle')
          postureRef.current = 'sit'
        }
        playOnceAnimationRef.current?.(null, name, () => {
          poseRef.current = 'idle'
          setPose('idle')
          postureRef.current = 'sit'
          console.log(`[life] anim ${name} end`)
        })
        return true
      },
      mem: () => {
        const perfMem = window.performance?.memory
        const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB'
        const result = {
          performanceMemory: perfMem
            ? {
                jsHeapSizeLimit: mb(perfMem.jsHeapSizeLimit),
                totalJSHeapSize: mb(perfMem.totalJSHeapSize),
                usedJSHeapSize: mb(perfMem.usedJSHeapSize),
              }
            : 'not available',
          elements: {},
        }

        const images = Array.from(document.querySelectorAll('img'))
        const canvases = Array.from(document.querySelectorAll('canvas'))
        const domAudios = Array.from(document.querySelectorAll('audio'))

        let imgBytes = 0
        images.forEach((img) => {
          const w = img.naturalWidth || img.width || 0
          const h = img.naturalHeight || img.height || 0
          imgBytes += w * h * 4
        })

        let canvasBytes = 0
        canvases.forEach((c) => {
          canvasBytes += (c.width || 0) * (c.height || 0) * 4
        })

        let spriteCacheBytes = 0
        let spriteImgCount = 0
        let eyeShiftCanvases = 0
        let eyeShiftBytes = 0
        if (typeof window !== 'undefined' && window.__sbGetSpriteCacheStats) {
          const stats = window.__sbGetSpriteCacheStats()
          spriteCacheBytes = stats.totalBytes || 0
          spriteImgCount = stats.imageCount || 0
          eyeShiftCanvases = stats.eyeShiftCanvases || 0
          eyeShiftBytes = stats.eyeShiftCanvasBytes || 0
        }

        let audioCount = domAudios.length
        if (meowAudioRef.current) audioCount++

        const totalDecodedBytes = imgBytes + canvasBytes + spriteCacheBytes

        result.elements = {
          htmlImages: { count: images.length, approxDecoded: mb(imgBytes) },
          cachedSpriteImages: { count: spriteImgCount, approxDecoded: mb(spriteCacheBytes - eyeShiftBytes) },
          canvases: { count: canvases.length + eyeShiftCanvases, approxDecoded: mb(canvasBytes + eyeShiftBytes) },
          audioElements: { count: audioCount },
          totalDecodedSize: mb(totalDecodedBytes),
        }

        console.log('[life] memory report:', result)
        return result
      },
    }

    return () => {
      if (perfIntervalRef.current) {
        clearInterval(perfIntervalRef.current)
        perfIntervalRef.current = null
      }
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
  const isCareAction = currentPose === 'eat' || currentPose === 'drink' || isCareActionRef.current
  const isReactionAction = currentPose === 'sad' || currentPose === 'annoyed' || isReactionActiveRef.current
  if (isHoveringHead && !dragging && !isReminder && !pomodoroCelebrating && pose !== 'sleep' && !isCareAction && !isReactionAction) {
    currentPose = 'purr'
  }

  const displayPose = (isCareAction || isReactionAction)
    ? currentPose
    : (isReminder && reminderCatAnimation !== false)
      ? 'alert'
      : pomodoroCelebrating
        ? 'jump'
        : currentPose
  const moving = walkMs > 0 && !dragging && (displayPose.startsWith('walk') || displayPose.startsWith('run'))

  // ── Run Burst Pose Tracking Debug Check ──────────────────────────────────
  useEffect(() => {
    if (isDebugRef.current && runBurstDebugTrackingRef.current) {
      if (pose === 'standidle') {
        runBurstDebugTrackingRef.current = false
      } else {
        console.log(`[life] run_burst pose change: ${pose}`)
      }
    }
  }, [pose])

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
  } else if (displayPose === 'drink') {
    animationName = 'drink'
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
    eyeTracking &&
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
  const screenW = displayGeometry?.workArea?.width ?? (window.screen.availWidth || window.screen.width || 1920)
  const screenH = displayGeometry?.workArea?.height ?? (window.screen.availHeight || window.screen.height || 1080)
  const waX = displayGeometry?.workArea?.x ?? 0
  const waY = displayGeometry?.workArea?.y ?? 0
  const centerX = Math.round(waX + screenW / 2)
  const centerY = Math.round(waY + screenH / 2)

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
    isHoveringHead ||
    isHoveringCat
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
  }, [moodEnabled, mood, isOverlayShowing, isIndicatorVisible, moodIndicator, isCursorNear, recentMoodChange])

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
            top: '45.4%',
            left: '27.3%',
            width: '66%',
            height: '37%',
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
            loop={isBigTreatment || (!ONE_SHOT_ANIMATIONS.has(animationName) && animsManifest?.animations?.[animationName]?.mode !== 'once')}
            useHeadphones={effectiveHeadphones}
            isDebug={isDebug}
            onAnimationEnd={handleAnimationEnd}
            onShown={handleSpriteShown}
            catAnimationSpeed={displayPose.startsWith('walk') || displayPose.startsWith('run') ? walkSpeedRate : catAnimationSpeed}
            eyeTracking={isEyeTrackingEligible}
            cursorOffset={cursorOffset}
            fpsCap={limitBackgroundCpu && (displayPose === 'sleep' || pose === 'sleep') ? Math.round(effectiveFps / 2) : effectiveFps}
            idlePaused={effectiveIdlePaused}
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
