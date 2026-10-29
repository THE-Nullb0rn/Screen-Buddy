import React from 'react'
import { Card, Row, Slider } from '../ui'
import { Cat, Maximize2, Eye, Gauge } from 'lucide-react'

export default function AppearanceTab({ settings, saveSettingsPatch }) {
  const currentStyle = settings.catStyle || 'black-cat'
  const currentSize = settings.catSize ?? 100
  const currentOpacity = settings.catOpacity ?? 100
  const currentSpeed = settings.catAnimationSpeed || 'normal'

  const sizeOptions = [50, 75, 100, 125, 150]
  const speedOptions = [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
  ]

  return (
    <>
      <Card title="Cat Style" subtitle="Choose your buddy's look." icon={Cat}>
        <Row
          icon={Cat}
          label="Companion"
          hint="Choose your active desktop companion"
          soon={true}
        >
          <div className="sb-char-selector">
            <div className={`sb-char-card ${currentStyle === 'black-cat' ? 'sb-char-card--selected' : ''}`}>
              <div className="sb-char-avatar">
                <Cat size={22} />
              </div>
              <div className="sb-char-info">
                <span className="sb-char-name">Midnight Cat</span>
                <span className="sb-char-desc">Default cozy pixel companion</span>
              </div>
            </div>
          </div>
        </Row>
      </Card>

      <Card title="Size & Opacity" icon={Maximize2}>
        <Row
          icon={Maximize2}
          label="Size"
          hint="Scale factor for the mascot overlay window"
          soon={true}
        >
          <div className="sb-segmented-group">
            {sizeOptions.map((sz) => (
              <button
                key={sz}
                type="button"
                className={`sb-segmented-btn ${currentSize === sz ? 'sb-segmented-btn--active' : ''}`}
                onClick={() => saveSettingsPatch({ catSize: sz })}
              >
                {sz}%
              </button>
            ))}
          </div>
        </Row>

        <Row
          icon={Eye}
          label="Opacity"
          hint="Adjust how transparent the cat appears on screen"
        >
          <Slider
            value={currentOpacity}
            min={20}
            max={100}
            step={5}
            unit="%"
            onChange={(e) => saveSettingsPatch({ catOpacity: Number(e.target.value) })}
            ariaLabel="Cat Opacity"
          />
        </Row>
      </Card>

      <Card title="Animation Speed" subtitle="Control how fast the animations play." icon={Gauge}>
        <Row
          icon={Gauge}
          label="Animation speed"
          hint="Control how fast sprite animations and transitions play"
        >
          <div className="sb-segmented-group">
            {speedOptions.map((sp) => (
              <button
                key={sp.value}
                type="button"
                className={`sb-segmented-btn ${currentSpeed === sp.value ? 'sb-segmented-btn--active' : ''}`}
                onClick={() => saveSettingsPatch({ catAnimationSpeed: sp.value })}
              >
                {sp.label}
              </button>
            ))}
          </div>
        </Row>
      </Card>
    </>
  )
}
