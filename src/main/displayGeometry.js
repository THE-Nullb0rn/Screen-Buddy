/**
 * screen-buddy — Display Geometry Layer
 *
 * Pure functions for multi-monitor display geometry, DIP coordinate calculations,
 * floor and edge bounding, and window placement.
 * Pure and decoupled from Electron classes for easy unit testing.
 */

'use strict'

// Sizing constants (DIP)
const NORMAL_WIN_W = 160
const NORMAL_WIN_H = 128
const NORMAL_CAT_CX = 80
const NORMAL_BOTTOM_INSET_PX = 8
const SPRITE_HEIGHT = 180
// NORMAL_CAT_CY = 128 - 8 - 90 = 30
const NORMAL_CAT_CY = NORMAL_WIN_H - NORMAL_BOTTOM_INSET_PX - SPRITE_HEIGHT / 2
const FLOOR_GAP_PX = 24
const FOOT_PAD_PX = 5

const TREATMENT_WIN_W = 350
const TREATMENT_WIN_H = 380
const TREATMENT_CAT_CX = 175
const TREATMENT_CAT_CY = 192

const NORMAL_VISIBLE_TOP_IN_WIN = 29 // 128 - 8 - 180 + 89

/**
 * Find the display that contains a given (x, y) point (in DIP).
 * If the point is outside all displays, returns the nearest display (by distance to workArea center).
 * If displays array is empty, returns null.
 *
 * @param {Array<object>} displays List of Electron Display objects
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
function getDisplayForPoint(displays, x, y) {
  if (!Array.isArray(displays) || displays.length === 0) return null

  // 1. Check if point is inside any display bounds
  for (const d of displays) {
    const { bounds } = d
    if (
      x >= bounds.x &&
      x < bounds.x + bounds.width &&
      y >= bounds.y &&
      y < bounds.y + bounds.height
    ) {
      return d
    }
  }

  // 2. Fall back to nearest display work area center
  let nearest = displays[0]
  let minDistSq = Infinity

  for (const d of displays) {
    const wa = d.workArea || d.bounds
    const centerX = wa.x + wa.width / 2
    const centerY = wa.y + wa.height / 2
    const distSq = (x - centerX) ** 2 + (y - centerY) ** 2
    if (distSq < minDistSq) {
      minDistSq = distSq
      nearest = d
    }
  }

  return nearest
}

/**
 * Compute the geometry bounds for a cat on a given display.
 * Returns both window top-left limits and renderer cat-center coordinates (in DIP).
 *
 * @param {object} display Electron Display object
 * @returns {object} Geometry metrics
 */
function getDisplayCatGeometry(display) {
  if (!display) {
    return {
      displayId: null,
      scaleFactor: 1.0,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      floorY: 971,
      minX: 80,
      maxX: 1840,
      minY: 30,
      maxY: 971,
      minCatX: 80,
      maxCatX: 1840,
      minCatY: 30,
      minWinX: 0,
      maxWinX: 1760,
      floorWinY: 941,
    }
  }

  const scaleFactor = display.scaleFactor || 1.0
  const bounds = display.bounds || { x: 0, y: 0, width: 1920, height: 1080 }
  const wa = display.workArea || bounds

  // Floor Y in cat-center coordinates:
  // bottom of workArea - (SPRITE_HEIGHT / 2) - FLOOR_GAP_PX + FOOT_PAD_PX
  // wa.y + wa.height - 90 - 24 + 5 = wa.y + wa.height - 109
  const floorY = Math.round(wa.y + wa.height - (SPRITE_HEIGHT / 2) - FLOOR_GAP_PX + FOOT_PAD_PX)
  const minY = Math.round(wa.y + NORMAL_CAT_CY)
  const maxY = Math.max(minY, floorY)

  // Left and Right edges for cat center:
  const minX = Math.round(wa.x + NORMAL_CAT_CX)
  const maxX = Math.max(minX, Math.round(wa.x + wa.width - NORMAL_WIN_W + NORMAL_CAT_CX))

  // Corresponding window top-left bounds:
  const minWinX = Math.round(wa.x)
  const maxWinX = Math.max(minWinX, Math.round(wa.x + wa.width - NORMAL_WIN_W))
  const floorWinY = Math.round(maxY - NORMAL_CAT_CY)

  return {
    displayId: display.id,
    scaleFactor,
    bounds: { ...bounds },
    workArea: { ...wa },
    floorY: maxY,
    minX,
    maxX,
    minY,
    maxY,
    minCatX: minX,
    maxCatX: maxX,
    minCatY: minY,
    minWinX,
    maxWinX,
    floorWinY,
  }
}

/**
 * Calculate the default position for the mascot (standing on floor, bottom-right).
 *
 * @param {object} primaryDisplay Electron Display object
 * @returns {{ x: number, y: number, catX: number, catY: number }}
 */
function getDefaultMascotPosition(primaryDisplay) {
  const geom = getDisplayCatGeometry(primaryDisplay)
  // Bottom-right with comfortable margin (48px from right edge if space permits)
  const rightMargin = 48
  const winX = Math.max(geom.minWinX, geom.maxWinX - rightMargin)
  const winY = geom.floorWinY

  return {
    x: Math.round(winX),
    y: Math.round(winY),
    catX: Math.round(winX + NORMAL_CAT_CX),
    catY: Math.round(winY + NORMAL_CAT_CY),
  }
}

/**
 * Validate and clamp a window position ({ x, y } in DIP) across connected displays.
 * If position is outside all displays, clamps it to the nearest display workArea.
 *
 * @param {Array<object>} displays
 * @param {number} x
 * @param {number} y
 * @param {number} winW
 * @param {number} winH
 * @returns {{ x: number, y: number, display: object }}
 */
function clampWindowPosition(displays, x, y, winW = NORMAL_WIN_W, winH = NORMAL_WIN_H) {
  const safeX = Number.isFinite(x) ? x : 0
  const safeY = Number.isFinite(y) ? y : 0
  if (!Array.isArray(displays) || displays.length === 0) {
    return { x: Math.round(safeX), y: Math.round(safeY), display: null }
  }

  // Determine which display contains or is closest to this window position
  const targetDisplay = getDisplayForPoint(displays, safeX + winW / 2, safeY + winH / 2) || displays[0]
  const wa = targetDisplay.workArea || targetDisplay.bounds

  const minX = wa.x
  const maxX = Math.max(minX, wa.x + wa.width - winW)
  const minY = wa.y
  const maxY = Math.max(minY, wa.y + wa.height - winH)

  const clampedX = Math.round(Math.max(minX, Math.min(safeX, maxX)))
  const clampedY = Math.round(Math.max(minY, Math.min(safeY, maxY)))

  return {
    x: clampedX,
    y: clampedY,
    display: targetDisplay,
  }
}

/**
 * Validate and clamp a cat center position ({ x, y } in DIP) across connected displays.
 *
 * @param {Array<object>} displays
 * @param {number} catX
 * @param {number} catY
 * @param {number} [winW=NORMAL_WIN_W]
 * @param {number} [winH=NORMAL_WIN_H]
 * @param {number} [catCx=NORMAL_CAT_CX]
 * @param {number} [catCy=NORMAL_CAT_CY]
 * @returns {{ x: number, y: number, winX: number, winY: number, display: object, geometry: object }}
 */
function clampCatCenterPosition(
  displays,
  catX,
  catY,
  winW = NORMAL_WIN_W,
  winH = NORMAL_WIN_H,
  catCx = NORMAL_CAT_CX,
  catCy = NORMAL_CAT_CY
) {
  const safeCatX = Number.isFinite(catX) ? catX : catCx
  const safeCatY = Number.isFinite(catY) ? catY : catCy
  const targetDisplay = getDisplayForPoint(displays, safeCatX, safeCatY) || (displays && displays[0])
  const geom = getDisplayCatGeometry(targetDisplay)
  const wa = (targetDisplay && (targetDisplay.workArea || targetDisplay.bounds)) || { x: 0, y: 0, width: 1920, height: 1080 }

  let minCatX
  let maxCatX
  let minCatY
  let maxCatY

  if (winW === NORMAL_WIN_W && winH === NORMAL_WIN_H && catCx === NORMAL_CAT_CX && catCy === NORMAL_CAT_CY) {
    minCatX = geom.minX
    maxCatX = geom.maxX
    minCatY = geom.minY
    maxCatY = geom.maxY
  } else {
    const minWinX = Math.round(wa.x)
    const maxWinX = Math.max(minWinX, Math.round(wa.x + wa.width - winW))
    const minWinY = Math.round(wa.y)
    const maxWinY = Math.max(minWinY, Math.round(wa.y + wa.height - winH))
    minCatX = Math.round(minWinX + catCx)
    maxCatX = Math.max(minCatX, Math.round(maxWinX + catCx))
    minCatY = Math.round(minWinY + catCy)
    maxCatY = Math.max(minCatY, Math.round(maxWinY + catCy))
  }

  const clampedX = Math.round(Math.max(minCatX, Math.min(safeCatX, maxCatX)))
  const clampedY = Math.round(Math.max(minCatY, Math.min(safeCatY, maxCatY)))
  const winX = Math.round(clampedX - catCx)
  const winY = Math.round(clampedY - catCy)

  return {
    x: clampedX,
    y: clampedY,
    winX,
    winY,
    display: targetDisplay,
    geometry: geom,
  }
}

/**
 * Compute bubble window coordinates (DIP) relative to the cat window,
 * staying fully within the workArea of the cat's display.
 *
 * @param {object} display Electron Display object
 * @param {number} catWinX
 * @param {number} catWinY
 * @param {number} bubbleW
 * @param {number} bubbleH
 * @param {string} mode 'mascot' | 'treatment'
 * @returns {{ x: number, y: number }}
 */
function computeBubblePosition(display, catWinX, catWinY, bubbleW, bubbleH, mode = 'mascot') {
  const wa = display?.workArea || display?.bounds || { x: 0, y: 0, width: 1920, height: 1080 }

  const safeCatWinX = Number.isFinite(catWinX) ? catWinX : wa.x
  const safeCatWinY = Number.isFinite(catWinY) ? catWinY : wa.y
  const safeBubbleW = Number.isFinite(bubbleW) ? Math.max(1, bubbleW) : 320
  const safeBubbleH = Number.isFinite(bubbleH) ? Math.max(1, bubbleH) : 200

  const isTreatment = mode === 'treatment'
  const cx = isTreatment ? TREATMENT_CAT_CX : NORMAL_CAT_CX
  const cy = isTreatment ? TREATMENT_CAT_CY : NORMAL_CAT_CY
  const halfHeight = isTreatment ? 180 : 90

  const spriteTop = safeCatWinY + cy - halfHeight
  const spriteBottom = safeCatWinY + cy + halfHeight

  const anchorTop = isTreatment ? spriteTop : safeCatWinY + NORMAL_VISIBLE_TOP_IN_WIN

  // Position bubble above sprite; fall back below if it goes outside work area top
  let targetY = anchorTop - 8 - safeBubbleH
  if (targetY < wa.y) {
    targetY = Math.min(spriteBottom + 8, wa.y + wa.height - safeBubbleH)
  }

  // Horizontally center aligned with mascot center
  let targetX = safeCatWinX + cx - Math.round(safeBubbleW / 2)
  targetX = Math.max(wa.x, Math.min(targetX, wa.x + wa.width - safeBubbleW))

  return {
    x: Math.round(targetX),
    y: Math.round(targetY),
  }
}

module.exports = {
  NORMAL_WIN_W,
  NORMAL_WIN_H,
  NORMAL_CAT_CX,
  NORMAL_CAT_CY,
  NORMAL_BOTTOM_INSET_PX,
  SPRITE_HEIGHT,
  FLOOR_GAP_PX,
  FOOT_PAD_PX,
  TREATMENT_WIN_W,
  TREATMENT_WIN_H,
  TREATMENT_CAT_CX,
  TREATMENT_CAT_CY,
  NORMAL_VISIBLE_TOP_IN_WIN,
  getDisplayForPoint,
  getDisplayCatGeometry,
  getDefaultMascotPosition,
  clampWindowPosition,
  clampCatCenterPosition,
  computeBubblePosition,
}
