import React, { useState, useEffect } from 'react'
import { Card, Row, Toggle, Slider, Select, TextInput, Button, StatusLine } from '../ui'
import {
  Sparkles,
  Bot,
  Cpu,
  Key,
  Sliders,
  SlidersHorizontal,
  MessageSquare,
  Smile,
  Clock,
  Languages,
  Layers,
  Eye,
  EyeOff,
  Loader2,
  ExternalLink,
} from 'lucide-react'

const MODEL_OPTIONS = [
  { value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (Default)' },
  { value: 'custom', label: 'Custom model…' },
]

const RESPONSE_LENGTH_OPTIONS = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
]

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
]

const WINDOW_STYLE_OPTIONS = [
  { value: 'bubble', label: 'Speech Bubble' },
  { value: 'compact', label: 'Compact Card' },
  { value: 'expanded', label: 'Expanded Panel' },
]

export default function ChatTab({ settings, saveSettingsPatch }) {
  const currentSavedModel = settings.geminiModel || 'gemini-3.5-flash-lite'
  const isCustomModel = currentSavedModel !== 'gemini-3.5-flash-lite'

  const [selectedModelOption, setSelectedModelOption] = useState(
    isCustomModel ? 'custom' : 'gemini-3.5-flash-lite'
  )
  const [customModelInput, setCustomModelInput] = useState(
    isCustomModel ? currentSavedModel : ''
  )
  const [apiKeyInput, setApiKeyInput] = useState(settings.geminiApiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | { ok: boolean, error?: string }

  useEffect(() => {
    const model = settings.geminiModel || 'gemini-3.5-flash-lite'
    if (model !== 'gemini-3.5-flash-lite') {
      setSelectedModelOption('custom')
      setCustomModelInput(model)
    } else {
      setSelectedModelOption('gemini-3.5-flash-lite')
    }
  }, [settings.geminiModel])

  const handleModelSelectChange = (e) => {
    const val = e.target.value
    setSelectedModelOption(val)
    if (val === 'gemini-3.5-flash-lite') {
      saveSettingsPatch({ geminiModel: 'gemini-3.5-flash-lite' })
    } else if (customModelInput.trim()) {
      saveSettingsPatch({ geminiModel: customModelInput.trim() })
    }
  }

  const handleCustomModelChange = (e) => {
    const sanitized = e.target.value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
    setCustomModelInput(sanitized)
  }

  const handleCustomModelSave = () => {
    const trimmed = customModelInput.trim()
    if (trimmed) {
      saveSettingsPatch({ geminiModel: trimmed })
    } else {
      saveSettingsPatch({ geminiModel: 'gemini-3.5-flash-lite' })
      setSelectedModelOption('gemini-3.5-flash-lite')
    }
  }

  useEffect(() => {
    setApiKeyInput(settings.geminiApiKey || '')
  }, [settings.geminiApiKey])

  const handleApiKeySave = () => {
    const trimmed = apiKeyInput.trim()
    if (trimmed !== (settings.geminiApiKey || '')) {
      saveSettingsPatch({ geminiApiKey: trimmed })
    }
  }

  const handleTestConnection = async () => {
    if (!window.api?.testChatConnection) return
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.testChatConnection()
      setTestResult(res)
    } catch (err) {
      setTestResult({ ok: false, error: err.message || 'Connection test failed' })
    } finally {
      setIsTesting(false)
    }
  }

  const handleOpenAiStudio = () => {
    if (window.api?.openExternal) {
      window.api.openExternal('https://aistudio.google.com/app/apikey')
    }
  }

  // Determine provider status pill text & variant
  let providerStatusText = 'Not configured'
  let providerStatusVariant = 'muted'
  if (testResult) {
    if (testResult.ok) {
      providerStatusText = 'Connected'
      providerStatusVariant = 'ok'
    } else {
      providerStatusText = 'Connection failed'
      providerStatusVariant = 'danger'
    }
  } else if (settings.geminiApiKey && settings.geminiApiKey.trim()) {
    providerStatusText = 'Key saved'
    providerStatusVariant = 'accent'
  }

  return (
    <>
      <Card
        title="AI Provider"
        subtitle="Choose the AI provider and configure it."
        icon={Sparkles}
        headerRight={
          <span className={`sb-status-pill sb-status-pill--${providerStatusVariant}`}>
            {providerStatusText}
          </span>
        }
      >
        <div className="sb-form-group">
          <label className="sb-form-label" htmlFor="ai-provider-select">
            Provider
          </label>
          <div className="sb-select-wrapper">
            <select id="ai-provider-select" className="sb-select" disabled value="gemini">
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>
          <span className="sb-form-hint">
            Direct client connection to Google Generative AI API
          </span>
        </div>
      </Card>

      <Card
        title="Chat Features"
        subtitle="Configure AI chat features and companion integration."
        icon={Bot}
      >
        <Row
          icon={Bot}
          label="Enable Chat & AI"
          hint="Talk with Screen Buddy using Gemini AI"
        >
          <Toggle
            checked={settings.chatEnabled !== false}
            onChange={(e) => saveSettingsPatch({ chatEnabled: e.target.checked })}
            ariaLabel="Enable Chat & AI"
          />
        </Row>
        <Row
          icon={Languages}
          label="Multi-language support"
          hint="Automatically detect and reply in your language"
          soon={true}
        >
          <Toggle
            checked={Boolean(settings.chatMultiLanguage)}
            onChange={(e) => saveSettingsPatch({ chatMultiLanguage: e.target.checked })}
            disabled={true}
            ariaLabel="Multi-language support"
          />
        </Row>
      </Card>

      <Card
        title="Model Settings"
        subtitle="Configure the AI model and generation parameters."
        icon={Cpu}
      >
        <Row
          icon={Cpu}
          label="Model"
          hint="Gemini 3.5 Flash Lite is fast, responsive, and cost-effective"
        >
          <Select
            value={selectedModelOption}
            onChange={handleModelSelectChange}
            options={MODEL_OPTIONS}
            ariaLabel="Gemini Model"
          />
        </Row>
        {selectedModelOption === 'custom' && (
          <Row
            icon={Cpu}
            label="Custom model name"
            hint="Plain text, max 80 chars (letters, digits, dots, underscores, hyphens)"
          >
            <TextInput
              value={customModelInput}
              onChange={handleCustomModelChange}
              onBlur={handleCustomModelSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder="e.g. gemini-2.0-flash-exp"
              maxLength={80}
              ariaLabel="Custom model name"
            />
          </Row>
        )}
        <Row
          icon={Sliders}
          label="Temperature"
          hint="Higher values make output more creative, lower values more focused"
        >
          <Slider
            value={settings.geminiTemperature ?? 0.7}
            min={0}
            max={2}
            step={0.1}
            onChange={(e) => saveSettingsPatch({ geminiTemperature: Number(e.target.value) })}
            ariaLabel="Temperature"
          />
        </Row>
        <Row
          icon={SlidersHorizontal}
          label="Max Tokens"
          hint="Maximum length of the generated response"
        >
          <Slider
            value={settings.geminiMaxTokens ?? 1024}
            min={128}
            max={2048}
            step={64}
            onChange={(e) => saveSettingsPatch({ geminiMaxTokens: Number(e.target.value) })}
            ariaLabel="Max Tokens"
          />
        </Row>
      </Card>

      <Card
        title="API Configuration"
        subtitle="Set up your API keys and endpoints."
        icon={Key}
      >
        <div className="sb-form-group">
          <label className="sb-form-label" htmlFor="gemini-api-key-input">
            Gemini API key
          </label>
          <div className="sb-input-action-group">
            <TextInput
              id="gemini-api-key-input"
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onBlur={handleApiKeySave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder="Paste Gemini API key"
              maxLength={300}
              autoComplete="off"
              spellCheck="false"
            />
            <Button
              variant="secondary"
              className="sb-input-icon-btn"
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
          <span className="sb-form-hint">
            Stored in plain text in your settings file.
          </span>
        </div>

        <div className="sb-btn-row">
          <Button
            variant="primary"
            onClick={handleTestConnection}
            disabled={isTesting || !apiKeyInput.trim()}
          >
            {isTesting ? (
              <>
                <Loader2 size={15} className="sb-spinner" />
                <span>Testing…</span>
              </>
            ) : (
              'Test connection'
            )}
          </Button>

          <Button variant="secondary" onClick={handleOpenAiStudio}>
            <ExternalLink size={14} />
            <span>Open API key page</span>
          </Button>
        </div>

        {testResult && (
          <div className="sb-test-result">
            {testResult.ok ? (
              <StatusLine status="ok" message="Connected successfully to Gemini!" />
            ) : (
              <StatusLine
                status="danger"
                message={testResult.error || 'Connection failed'}
              />
            )}
          </div>
        )}
      </Card>

      <Card
        title="Response Style"
        subtitle="Customize how Screen Buddy responds in chat."
        icon={MessageSquare}
      >
        <Row
          icon={Clock}
          label="Response length"
          hint="Choose how concise or thorough replies should be"
        >
          <Select
            value={settings.chatResponseLength || 'medium'}
            onChange={(e) => saveSettingsPatch({ chatResponseLength: e.target.value })}
            options={RESPONSE_LENGTH_OPTIONS}
            ariaLabel="Response length"
          />
        </Row>
        <Row
          icon={Smile}
          label="Tone"
          hint="The conversational tone used in responses"
        >
          <Select
            value={settings.chatTone || 'casual'}
            onChange={(e) => saveSettingsPatch({ chatTone: e.target.value })}
            options={TONE_OPTIONS}
            ariaLabel="Tone"
          />
        </Row>
        <Row
          icon={Smile}
          label="Include emojis"
          hint="Allow playful emojis in companion replies"
        >
          <Toggle
            checked={settings.chatUseEmojis !== false}
            onChange={(e) => saveSettingsPatch({ chatUseEmojis: e.target.checked })}
            ariaLabel="Include emojis"
          />
        </Row>
        <Row
          icon={Sparkles}
          label="Cat personality"
          hint="Add light feline mannerisms to conversations"
        >
          <Toggle
            checked={settings.chatUseCatPersonality !== false}
            onChange={(e) => saveSettingsPatch({ chatUseCatPersonality: e.target.checked })}
            ariaLabel="Cat personality"
          />
        </Row>
        <Row
          icon={Clock}
          label="Thinking indicator"
          hint="Show animated dots while waiting for AI response"
        >
          <Toggle
            checked={settings.chatThinkingIndicator !== false}
            onChange={(e) => saveSettingsPatch({ chatThinkingIndicator: e.target.checked })}
            ariaLabel="Thinking indicator"
          />
        </Row>
        <Row
          icon={Bot}
          label="Cat animations during chat"
          hint="Play companion gestures and reactions while chatting"
          soon={true}
        >
          <Toggle
            checked={settings.chatCatAnimations !== false}
            onChange={(e) => saveSettingsPatch({ chatCatAnimations: e.target.checked })}
            disabled={true}
            ariaLabel="Cat animations during chat"
          />
        </Row>
      </Card>

      <Card
        title="Chat Window"
        subtitle="Configure the appearance and behavior of chat bubbles."
        icon={Layers}
      >
        <Row
          icon={Clock}
          label="Auto-hide chat"
          hint="Automatically dismiss chat bubbles after inactivity"
        >
          <Toggle
            checked={settings.chatAutoHide !== false}
            onChange={(e) => saveSettingsPatch({ chatAutoHide: e.target.checked })}
            ariaLabel="Auto-hide chat"
          />
        </Row>
        <Row
          icon={Layers}
          label="Window style"
          hint="Visual style of the chat interface"
          soon={true}
        >
          <Select
            value={settings.chatWindowStyle || 'bubble'}
            onChange={(e) => saveSettingsPatch({ chatWindowStyle: e.target.value })}
            options={WINDOW_STYLE_OPTIONS}
            disabled={true}
            ariaLabel="Window style"
          />
        </Row>
        <Row
          icon={Layers}
          label="Transparency"
          hint="Adjust chat bubble background opacity (40-100%)"
        >
          <Slider
            value={settings.chatWindowTransparency ?? 85}
            min={40}
            max={100}
            step={1}
            unit="%"
            onChange={(e) => saveSettingsPatch({ chatWindowTransparency: Number(e.target.value) })}
            ariaLabel="Transparency"
          />
        </Row>
        <Row
          icon={Layers}
          label="Blur background"
          hint="Apply backdrop blur to chat elements"
        >
          <Toggle
            checked={settings.chatBlurBackground !== false}
            onChange={(e) => saveSettingsPatch({ chatBlurBackground: e.target.checked })}
            ariaLabel="Blur background"
          />
        </Row>
      </Card>
    </>
  )
}
