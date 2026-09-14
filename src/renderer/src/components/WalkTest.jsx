import React from 'react'
import './WalkTest.css'

export default function WalkTest() {
  return (
    <div className="walk-test-container">
      <svg viewBox="0 0 300 300" className="cat-svg">
        <g className="cat-bounce">
          
          {/* ── TAIL ── */}
          <g className="tail-1" style={{ transformOrigin: '95px 145px' }}>
            <path d="M 95 145 Q 75 125 60 120" className="path-outline" />
            <g className="tail-2" style={{ transformOrigin: '60px 120px' }}>
              <path d="M 60 120 Q 45 115 35 125" className="path-outline" />
              <path d="M 60 120 Q 45 115 35 125" className="path-fill fill-near" />
            </g>
            <path d="M 95 145 Q 75 125 60 120" className="path-fill fill-near" />
          </g>

          {/* ── FAR HIND LEG (Cycle B) ── */}
          <g className="leg-upper cycle-b" style={{ transformOrigin: '115px 160px' }}>
            <g className="leg-lower cycle-b-lower" style={{ transformOrigin: '100px 205px' }}>
              <path d="M 100 205 L 115 240 L 125 240" className="path-outline" />
              <path d="M 100 205 L 115 240 L 125 240" className="path-fill fill-far" />
            </g>
            <path d="M 115 160 L 100 205" className="path-outline" />
            <path d="M 115 160 L 100 205" className="path-fill fill-far" />
          </g>

          {/* ── FAR FORE LEG (Cycle A) ── */}
          <g className="leg-upper cycle-a" style={{ transformOrigin: '185px 160px' }}>
            <g className="leg-lower cycle-a-lower" style={{ transformOrigin: '185px 200px' }}>
              <path d="M 185 200 L 180 240 L 190 240" className="path-outline" />
              <path d="M 185 200 L 180 240 L 190 240" className="path-fill fill-far" />
            </g>
            <path d="M 185 160 L 185 200" className="path-outline" />
            <path d="M 185 160 L 185 200" className="path-fill fill-far" />
          </g>

          {/* ── BODY ── */}
          <ellipse cx="150" cy="150" rx="60" ry="40" className="shape-outline" />
          <ellipse cx="150" cy="150" rx="60" ry="40" className="shape-fill fill-near" />
          <path d="M 105 170 Q 150 200 195 170 Q 150 185 105 170 Z" fill="#FFF3D8" />

          {/* ── HEAD ── */}
          <g className="head-group" style={{ transformOrigin: '215px 120px' }}>
            {/* Back Ear */}
            <path d="M 220 85 L 240 55 L 245 95 Z" className="shape-outline" />
            <path d="M 220 85 L 240 55 L 245 95 Z" className="shape-fill fill-far" />

            {/* Head Base */}
            <circle cx="215" cy="120" r="35" className="shape-outline" />
            <circle cx="215" cy="120" r="35" className="shape-fill fill-near" />

            {/* Front Ear */}
            <path d="M 200 90 L 210 50 L 230 88 Z" className="shape-outline" />
            <path d="M 200 90 L 210 50 L 230 88 Z" className="shape-fill fill-near" />

            {/* Face Patch (Cream) */}
            <path d="M 185 125 Q 215 155 245 130 Q 215 115 185 125 Z" fill="#FFF3D8" />

            {/* Eyes */}
            <circle cx="225" cy="115" r="4" fill="#1F1A17" />
            <circle cx="240" cy="115" r="4" fill="#1F1A17" />
            {/* Nose */}
            <polygon points="232,122 238,122 235,126" fill="#F08080" />
          </g>

          {/* ── NEAR HIND LEG (Cycle A) ── */}
          <g className="leg-upper cycle-a" style={{ transformOrigin: '105px 165px' }}>
            <g className="leg-lower cycle-a-lower" style={{ transformOrigin: '90px 210px' }}>
              <path d="M 90 210 L 105 245 L 115 245" className="path-outline" />
              <path d="M 90 210 L 105 245 L 115 245" className="path-fill fill-near" />
            </g>
            <path d="M 105 165 L 90 210" className="path-outline" />
            <path d="M 105 165 L 90 210" className="path-fill fill-near" />
          </g>

          {/* ── NEAR FORE LEG (Cycle B) ── */}
          <g className="leg-upper cycle-b" style={{ transformOrigin: '195px 165px' }}>
            <g className="leg-lower cycle-b-lower" style={{ transformOrigin: '195px 205px' }}>
              <path d="M 195 205 L 190 245 L 200 245" className="path-outline" />
              <path d="M 195 205 L 190 245 L 200 245" className="path-fill fill-near" />
            </g>
            <path d="M 195 165 L 195 205" className="path-outline" />
            <path d="M 195 165 L 195 205" className="path-fill fill-near" />
          </g>

        </g>
      </svg>
    </div>
  )
}
