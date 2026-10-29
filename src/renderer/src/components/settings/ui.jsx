import React, { useState, useEffect, useRef } from 'react'

export function IconTile({ icon: Icon, size = 18, className = '' }) {
  if (!Icon) return null
  return (
    <div className={`sb-icon-tile ${className}`} aria-hidden="true">
      <Icon size={size} className="sb-icon-tile__svg" />
    </div>
  )
}

export function Card({ title, icon: Icon, children, className = '', headerRight = null }) {
  return (
    <section className={`sb-card ${className}`}>
      {(title || Icon || headerRight) && (
        <header className="sb-card__header">
          <div className="sb-card__title-group">
            {Icon && <Icon size={18} className="sb-card__icon" aria-hidden="true" />}
            {title && <h3 className="sb-card__title">{title}</h3>}
          </div>
          {headerRight && <div className="sb-card__header-right">{headerRight}</div>}
        </header>
      )}
      <div className="sb-card__content">{children}</div>
    </section>
  )
}

export function Row({ icon: Icon, label, hint, soon = false, children, className = '' }) {
  return (
    <div className={`sb-row ${soon ? 'sb-row--soon' : ''} ${className}`}>
      <div className="sb-row__info">
        {Icon && <IconTile icon={Icon} />}
        <div className="sb-row__text">
          <div className="sb-row__label-group">
            <span className="sb-row__label">{label}</span>
            {soon && <span className="sb-soon-pill">Soon</span>}
          </div>
          {hint && <span className="sb-row__hint">{hint}</span>}
        </div>
      </div>
      {children && <div className="sb-row__control">{children}</div>}
    </div>
  )
}

export function Select({ value, onChange, options = [], disabled = false, className = '', id, ariaLabel }) {
  return (
    <div className={`sb-select-wrap ${className}`}>
      <select
        id={id}
        className="sb-select"
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = '',
  disabled = false,
  ariaLabel,
}) {
  const [draftValue, setDraftValue] = useState(value ?? min ?? 0)
  const isDraggingRef = useRef(false)
  const prevValueRef = useRef(value)

  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value
      setDraftValue(value ?? min ?? 0)
    }
  }, [value, min])

  const handleInput = (e) => {
    isDraggingRef.current = true
    setDraftValue(Number(e.target.value))
  }

  const commitValue = () => {
    if (!isDraggingRef.current && draftValue === value) return
    isDraggingRef.current = false
    if (onChange && draftValue !== value) {
      onChange({ target: { value: draftValue } })
    }
  }

  return (
    <div className="sb-slider-group">
      <input
        type="range"
        className="sb-slider"
        min={min}
        max={max}
        step={step}
        value={draftValue}
        onChange={handleInput}
        onPointerUp={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className="sb-slider-value">
        {draftValue}
        {unit}
      </span>
    </div>
  )
}

export function Toggle({ checked, onChange, disabled = false, ariaLabel }) {
  return (
    <label className={`sb-toggle ${disabled ? 'sb-toggle--disabled' : ''}`}>
      <input
        type="checkbox"
        className="sb-toggle__input"
        checked={Boolean(checked)}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className="sb-toggle__track" aria-hidden="true">
        <span className="sb-toggle__thumb" />
      </span>
    </label>
  )
}

export function Button({
  variant = 'secondary',
  size = 'normal',
  children,
  onClick,
  disabled = false,
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`sb-btn sb-btn--${variant} sb-btn--${size} ${className}`}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

export function TextInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  type = 'text',
  disabled = false,
  maxLength,
  className = '',
  ...props
}) {
  return (
    <input
      type={type}
      className={`sb-input ${className}`}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      {...props}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  min,
  max,
  disabled = false,
  className = '',
  ...props
}) {
  return (
    <input
      type="number"
      className={`sb-input sb-input--number ${className}`}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      min={min}
      max={max}
      disabled={disabled}
      {...props}
    />
  )
}

export function Kbd({ children, className = '' }) {
  return <kbd className={`sb-kbd ${className}`}>{children}</kbd>
}

export function StatusLine({ status = 'ok', message, children, className = '' }) {
  return (
    <div className={`sb-status-line sb-status-line--${status} ${className}`}>
      <span className="sb-status-line__dot" aria-hidden="true" />
      <span className="sb-status-line__text">{message || children}</span>
    </div>
  )
}
