/**
 * screen-buddy — Mascot placeholder component
 *
 * This is a stub for the future character. Right now it renders a coloured
 * rounded square with the entrance/exit CSS animation classes applied.
 *
 * When the mascot art is ready, replace the inner <div> content; keep the
 * wrapper logic (mouse handlers, animation class switching) the same.
 *
 * Props:
 *   reminderState   — current state machine value from App
 *   REMINDER_STATE  — the state machine constant map (avoids prop-drilling the import)
 *   onDismiss       — called when the user clicks the dismiss button
 */

import React, { useEffect, useRef } from 'react'
import './Mascot.css'

export default function Mascot({ reminderState, REMINDER_STATE, onDismiss }) {
  const containerRef = useRef(null)

  // ── Animation class ───────────────────────────────────────────────────────
  /**
   * Map the current state to a CSS animation class.
   * The classes are defined in index.css as @keyframe animations.
   *
   *   ENTRANCE → anim-fade-in   (mascot fades + slides into view)
   *   ACTIVE   → (no extra class, steady state)
   *   EXIT     → anim-slide-up  (mascot slides upward and fades out)
   */
  const animClass =
    reminderState === REMINDER_STATE.ENTRANCE
      ? 'anim-fade-in'
      : reminderState === REMINDER_STATE.EXIT
      ? 'anim-slide-up'
      : ''

  // ── Mouse hit-region: notify main process ─────────────────────────────────
  /**
   * When the pointer enters the mascot area, tell the main process to stop
   * treating the window as click-through so the user can interact with it.
   * When the pointer leaves, restore click-through behaviour.
   */
  const handleMouseEnter = () => window.api.mouseEnterInteractive()
  const handleMouseLeave = () => window.api.mouseLeaveInteractive()

  // Restore click-through when this component unmounts (e.g. after EXIT)
  useEffect(() => {
    return () => {
      window.api.mouseLeaveInteractive()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`mascot-container ${animClass}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="dialog"
      aria-label="screen-buddy reminder"
    >
      {/* ── Placeholder mascot art ─────────────────────────────────────── */}
      {/* Replace this div with the actual mascot image/SVG/canvas later  */}
      <div className="mascot-placeholder">
        <span className="mascot-placeholder__emoji" aria-hidden="true">🟢</span>
        <p className="mascot-placeholder__label">screen-buddy</p>
        <p className="mascot-placeholder__hint">
          {/* Reminder content will go here in a future iteration */}
          ✨ Take a break!
        </p>
      </div>

      {/* ── Dismiss button ─────────────────────────────────────────────── */}
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
