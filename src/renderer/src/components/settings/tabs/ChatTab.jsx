import React, { useState, useEffect } from 'react'
import { Card, TextInput, Button, StatusLine } from '../ui'
import { Sparkles, Cpu, Key, Eye, EyeOff, Loader2, ExternalLink } from 'lucide-react'

export default function ChatTab({ settings, saveSettingsPatch }) {
  const [modelInput, setModelInput] = useState(settings.geminiModel || 'gemini-3.5-flash-lite')
  const [apiKeyInput, setApiKeyInput] = useState(settings.geminiApiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | { ok: boolean, error?: string }

  useEffect(() => {
    setModelInput(settings.geminiModel || 'gemini-3.5-flash-lite')
  }, [settings.geminiModel])

  useEffect(() => {
    setApiKeyInput(settings.geminiApiKey || '')
  }, [settings.geminiApiKey])

  const handleModelSave = () => {
    const trimmed = modelInput.trim()
    if (!trimmed) {
      setModelInput(settings.geminiModel || 'gemini-3.5-flash-lite')
      return
    }
    if (trimmed !== settings.geminiModel) {
      saveSettingsPatch({ geminiModel: trimmed })
    }
  }

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

      <Card title="Model" icon={Cpu}>
        <div className="sb-form-group">
          <label className="sb-form-label" htmlFor="gemini-model-input">
            Model name
          </label>
          <TextInput
            id="gemini-model-input"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onBlur={handleModelSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            placeholder="gemini-3.5-flash-lite"
            maxLength={100}
          />
          <span className="sb-form-hint">Recommended: gemini-3.5-flash-lite</span>
        </div>
      </Card>

      <Card title="API Key" icon={Key}>
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
    </>
  )
}
