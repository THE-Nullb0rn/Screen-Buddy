import React from 'react'

/**
 * PixelIcon — Crisp inline pixel-art SVG icons drawn on 12x12 or 16x16 grids
 * with <rect> elements and shapeRendering="crispEdges".
 *
 * Icons supported:
 * - cat-head (mint eyes)
 * - gear (General)
 * - clock (Reminders)
 * - bell (Notifications)
 * - speech-bubble (Chat)
 * - paw (About)
 * - check
 * - cross
 * - arrow
 * - refresh
 * - external-link
 */
export default function PixelIcon({ name, size = 16, color = 'currentColor', className = '' }) {
  const p = (x, y, w = 1, h = 1, fill = color) => (
    <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  )

  switch (name) {
    case 'cat-head':
      // 16x16 grid with mint eyes
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {/* Ears */}
          {p(2, 2, 3, 4)}
          {p(11, 2, 3, 4)}
          {/* Head base */}
          {p(2, 5, 12, 8)}
          {p(3, 13, 10, 1)}
          {/* Ear inner pink / dark */}
          {p(3, 3, 1, 2, 'var(--panel, #262030)')}
          {p(12, 3, 1, 2, 'var(--panel, #262030)')}
          {/* Eyes (mint) */}
          {p(4, 7, 2, 2, 'var(--ok, #7ed99a)')}
          {p(10, 7, 2, 2, 'var(--ok, #7ed99a)')}
          {/* Pupils */}
          {p(5, 7, 1, 2, 'var(--outline, #0f0c14)')}
          {p(11, 7, 1, 2, 'var(--outline, #0f0c14)')}
          {/* Nose */}
          {p(7, 9, 2, 1, 'var(--accent, #f5b942)')}
          {/* Mouth */}
          {p(6, 11, 1, 1)}
          {p(9, 11, 1, 1)}
          {p(7, 11, 2, 1, 'transparent')}
        </svg>
      )

    case 'gear':
      // 16x16 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {/* Teeth */}
          {p(7, 1, 2, 2)}
          {p(7, 13, 2, 2)}
          {p(1, 7, 2, 2)}
          {p(13, 7, 2, 2)}
          {p(3, 3, 2, 2)}
          {p(11, 3, 2, 2)}
          {p(3, 11, 2, 2)}
          {p(11, 11, 2, 2)}
          {/* Outer body */}
          {p(5, 3, 6, 10)}
          {p(3, 5, 10, 6)}
          {/* Center hole */}
          {p(6, 6, 4, 4, 'var(--panel, #262030)')}
        </svg>
      )

    case 'clock':
      // 16x16 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {/* Circle border */}
          {p(5, 1, 6, 1)}
          {p(3, 2, 2, 1)}
          {p(11, 2, 2, 1)}
          {p(2, 3, 1, 2)}
          {p(13, 3, 1, 2)}
          {p(1, 5, 1, 6)}
          {p(14, 5, 1, 6)}
          {p(2, 11, 1, 2)}
          {p(13, 11, 1, 2)}
          {p(3, 13, 2, 1)}
          {p(11, 13, 2, 1)}
          {p(5, 14, 6, 1)}
          {/* Hands */}
          {p(7, 4, 2, 5)}
          {p(8, 7, 4, 2)}
        </svg>
      )

    case 'bell':
      // 16x16 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {/* Top handle */}
          {p(7, 1, 2, 2)}
          {/* Body */}
          {p(6, 3, 4, 2)}
          {p(5, 5, 6, 4)}
          {p(4, 9, 8, 3)}
          {p(2, 12, 12, 2)}
          {/* Clapper */}
          {p(7, 14, 2, 2, 'var(--accent, #f5b942)')}
        </svg>
      )

    case 'speech-bubble':
      // 16x16 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {/* Main rectangle */}
          {p(2, 2, 12, 9)}
          {p(1, 3, 14, 7)}
          {/* Tail */}
          {p(3, 11, 4, 2)}
          {p(2, 13, 3, 1)}
          {p(1, 14, 2, 1)}
          {/* Inner dots */}
          {p(4, 6, 2, 2, 'var(--panel, #262030)')}
          {p(7, 6, 2, 2, 'var(--panel, #262030)')}
          {p(10, 6, 2, 2, 'var(--panel, #262030)')}
        </svg>
      )

    case 'paw':
      // 16x16 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {/* 4 Toe pads */}
          {p(2, 4, 2, 3)}
          {p(5, 2, 2, 3)}
          {p(9, 2, 2, 3)}
          {p(12, 4, 2, 3)}
          {/* Main pad */}
          {p(5, 7, 6, 5)}
          {p(4, 8, 8, 3)}
          {p(5, 12, 6, 2)}
          {p(6, 14, 4, 1)}
        </svg>
      )

    case 'check':
      // 12x12 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 12 12"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {p(9, 2, 2, 2)}
          {p(8, 4, 2, 2)}
          {p(7, 6, 2, 2)}
          {p(2, 5, 2, 2)}
          {p(4, 7, 2, 2)}
          {p(6, 8, 2, 2)}
        </svg>
      )

    case 'cross':
      // 12x12 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 12 12"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {p(2, 2, 2, 2)}
          {p(8, 2, 2, 2)}
          {p(4, 4, 4, 4)}
          {p(2, 8, 2, 2)}
          {p(8, 8, 2, 2)}
        </svg>
      )

    case 'arrow':
      // 12x12 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 12 12"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {p(2, 5, 6, 2)}
          {p(6, 3, 2, 2)}
          {p(8, 5, 2, 2)}
          {p(6, 7, 2, 2)}
        </svg>
      )

    case 'refresh':
      // 12x12 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 12 12"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {p(4, 1, 5, 2)}
          {p(9, 2, 2, 3)}
          {p(8, 4, 3, 2)}
          {p(1, 5, 2, 3)}
          {p(2, 7, 2, 2)}
          {p(3, 9, 5, 2)}
          {p(1, 4, 3, 2)}
        </svg>
      )

    case 'external-link':
      // 12x12 grid
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 12 12"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {p(1, 4, 2, 7)}
          {p(1, 9, 7, 2)}
          {p(6, 1, 5, 2)}
          {p(9, 1, 2, 5)}
          {p(7, 3, 2, 2)}
          {p(5, 5, 2, 2)}
          {p(3, 7, 2, 2)}
        </svg>
      )

    case 'dot':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 8 8"
          shapeRendering="crispEdges"
          className={className}
          aria-hidden="true"
        >
          {p(2, 2, 4, 4)}
        </svg>
      )

    default:
      return null
  }
}
