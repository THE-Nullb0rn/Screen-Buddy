import React, { useEffect, useRef } from 'react'

const WIDTH = 220
const HEIGHT = 148
const BODY = '#111111'
const EYE = '#f5f5f0'

function roundedBody(ctx, breathing, lean) {
  ctx.beginPath()
  ctx.moveTo(62 + lean, 112 + breathing)
  ctx.bezierCurveTo(50 + lean, 105, 47 + lean, 91, 50 + lean, 74)
  ctx.bezierCurveTo(52 + lean, 58, 62 + lean, 47, 76 + lean, 43)
  ctx.bezierCurveTo(88 + lean, 39, 111 + lean, 39, 124 + lean, 43)
  ctx.bezierCurveTo(141 + lean, 48, 150 + lean, 62, 151 + lean, 81)
  ctx.bezierCurveTo(153 + lean, 101, 143 + lean, 114, 128 + lean, 119)
  ctx.bezierCurveTo(109 + lean, 125, 78 + lean, 123, 62 + lean, 112 + breathing)
  ctx.closePath()
  ctx.fill()
}

function drawCat(ctx, pose, time, pointer) {
  const breathing = Math.sin(time / 520) * 1.6
  const lean = pose === 'walk-left' ? -3 : pose === 'walk-right' ? 3 : 0
  const tailSway = Math.sin(time / 780) * 3

  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  ctx.fillStyle = BODY

  // The curled tail sits behind the rounded body, like the reference silhouette.
  ctx.beginPath()
  ctx.moveTo(133 + lean, 106)
  ctx.bezierCurveTo(159 + tailSway, 119, 188 + tailSway, 116, 188 + tailSway, 95)
  ctx.bezierCurveTo(188 + tailSway, 79, 173 + tailSway, 75, 166 + tailSway, 87)
  ctx.bezierCurveTo(161 + tailSway, 94, 169 + tailSway, 99, 175 + tailSway, 95)
  ctx.bezierCurveTo(179 + tailSway, 92, 177 + tailSway, 88, 173 + tailSway, 88)
  ctx.bezierCurveTo(184 + tailSway, 81, 195 + tailSway, 90, 194 + tailSway, 103)
  ctx.bezierCurveTo(193 + tailSway, 126, 162 + tailSway, 133, 134 + lean, 119)
  ctx.closePath()
  ctx.fill()

  // Small, upright triangular ears with a broad rounded head between them.
  ctx.beginPath()
  ctx.moveTo(59 + lean, 62)
  ctx.lineTo(62 + lean, 25)
  ctx.quadraticCurveTo(63 + lean, 20, 67 + lean, 24)
  ctx.lineTo(82 + lean, 39)
  ctx.quadraticCurveTo(99 + lean, 35, 119 + lean, 39)
  ctx.lineTo(135 + lean, 24)
  ctx.quadraticCurveTo(139 + lean, 20, 140 + lean, 26)
  ctx.lineTo(144 + lean, 63)
  ctx.closePath()
  ctx.fill()

  roundedBody(ctx, breathing, lean)

  // The reference uses two tiny, evenly spaced dot eyes that follow the cursor.
  if (pose !== 'sleep') {
    const eyeY = 67 + breathing
    const eyeOffsetX = Math.max(-2.5, Math.min(2.5, pointer.x * 2.5))
    const eyeOffsetY = Math.max(-1.5, Math.min(1.5, pointer.y * 1.5))
    ctx.fillStyle = EYE
    ctx.beginPath()
    ctx.arc(78 + lean + eyeOffsetX, eyeY + eyeOffsetY, pose === 'alert' ? 3.2 : 2.6, 0, Math.PI * 2)
    ctx.arc(119 + lean + eyeOffsetX, eyeY + eyeOffsetY, pose === 'alert' ? 3.2 : 2.6, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.strokeStyle = EYE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(72 + lean, 68)
    ctx.quadraticCurveTo(78 + lean, 72, 84 + lean, 68)
    ctx.moveTo(113 + lean, 68)
    ctx.quadraticCurveTo(119 + lean, 72, 125 + lean, 68)
    ctx.stroke()
  }
}

export default function CatCanvas({ pose = 'idle' }) {
  const canvasRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    const ratio = window.devicePixelRatio || 1
    canvas.width = WIDTH * ratio
    canvas.height = HEIGHT * ratio
    context.scale(ratio, ratio)

    let frame
    const animate = (time) => {
      drawCat(context, pose, time, pointerRef.current)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [pose])

  useEffect(() => {
    const onPointerMove = (event) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = {
        x: Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / rect.width)),
        y: Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / rect.height)),
      }
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])

  return <canvas ref={canvasRef} className="mascot-sprite" width={WIDTH} height={HEIGHT} aria-hidden="true" />
}
