import React from 'react'

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

export function Row({ icon: Icon, label, hint, children, className = '' }) {
  return (
    <div className={`sb-row ${className}`}>
      <div className="sb-row__info">
        {Icon && <IconTile icon={Icon} />}
        <div className="sb-row__text">
          <span className="sb-row__label">{label}</span>
          {hint && <span className="sb-row__hint">{hint}</span>}
        </div>
      </div>
      {children && <div className="sb-row__control">{children}</div>}
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
