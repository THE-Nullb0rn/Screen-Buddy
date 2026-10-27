import React from 'react'

function isValidHttpUrl(string) {
  try {
    const url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_) {
    return false
  }
}

/**
 * Tokenize inline formatting:
 * - inline code `code`
 * - links [text](url)
 * - bold **text** or __text__
 * - italic *text* or _text_
 */
function parseInline(text, keyPrefix = 'inline') {
  if (!text) return null

  const elements = []
  let remaining = text
  let index = 0

  const TOKEN_REGEX = /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n\s]+\))|(\*\*[^*]+?\*\*)|((?<![A-Za-z0-9])__[^_]+?__(?![A-Za-z0-9]))|(\*[^*]+?\*)|((?<![A-Za-z0-9])_[^_\s]+?_(?![A-Za-z0-9]))/

  while (remaining.length > 0) {
    const match = remaining.match(TOKEN_REGEX)
    if (!match) {
      elements.push(remaining)
      break
    }

    const matchStart = match.index
    if (matchStart > 0) {
      elements.push(remaining.slice(0, matchStart))
    }

    const matchedStr = match[0]
    const currentKey = `${keyPrefix}-${index++}`

    if (match[1]) {
      // Inline code
      const codeContent = matchedStr.slice(1, -1)
      elements.push(
        <code key={currentKey} className="chat-md-inline-code">
          {codeContent}
        </code>
      )
    } else if (match[2]) {
      // Link [text](url)
      const linkMatch = matchedStr.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        const linkText = linkMatch[1]
        const rawUrl = linkMatch[2]
        if (isValidHttpUrl(rawUrl)) {
          elements.push(
            <a
              key={currentKey}
              href={rawUrl}
              className="chat-md-link"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (window.api?.openExternal) {
                  window.api.openExternal(rawUrl)
                }
              }}
              rel="noreferrer"
            >
              {parseInline(linkText, `${currentKey}-link`)}
            </a>
          )
        } else {
          // If not http/https, render as inert text
          elements.push(matchedStr)
        }
      } else {
        elements.push(matchedStr)
      }
    } else if (match[3] || match[4]) {
      // Bold
      const boldContent = matchedStr.slice(2, -2)
      elements.push(
        <strong key={currentKey} className="chat-md-bold">
          {parseInline(boldContent, `${currentKey}-b`)}
        </strong>
      )
    } else if (match[5] || match[6]) {
      // Italic
      const italicContent = matchedStr.slice(1, -1)
      elements.push(
        <em key={currentKey} className="chat-md-italic">
          {parseInline(italicContent, `${currentKey}-i`)}
        </em>
      )
    }

    remaining = remaining.slice(matchStart + matchedStr.length)
  }

  return elements
}

/**
 * ChatMarkdown component parses basic Markdown formatting without
 * dangerouslySetInnerHTML or any external dependencies.
 */
export default function ChatMarkdown({ text }) {
  if (!text) return null

  const lines = text.split(/\r?\n/)
  const blocks = []
  let inCodeBlock = false
  let codeLang = ''
  let codeLines = []
  let currentList = null
  let currentParagraphLines = []

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: currentParagraphLines.join('\n'),
      })
      currentParagraphLines = []
    }
  }

  const flushList = () => {
    if (currentList) {
      blocks.push(currentList)
      currentList = null
    }
  }

  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (inCodeBlock) {
      if (line.trim().startsWith('```')) {
        blocks.push({
          type: 'code_block',
          code: codeLines.join('\n'),
          lang: codeLang,
        })
        inCodeBlock = false
        codeLines = []
        codeLang = ''
      } else {
        codeLines.push(line)
      }
      continue
    }

    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      flushAll()
      inCodeBlock = true
      codeLang = fenceMatch[1] || ''
      codeLines = []
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushAll()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      })
      continue
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      if (!currentList || currentList.type !== 'bullet_list') {
        flushList()
        currentList = { type: 'bullet_list', items: [] }
      }
      currentList.items.push(bulletMatch[1])
      continue
    }

    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/)
    if (numberedMatch) {
      flushParagraph()
      if (!currentList || currentList.type !== 'numbered_list') {
        flushList()
        currentList = { type: 'numbered_list', items: [] }
      }
      currentList.items.push(numberedMatch[2])
      continue
    }

    if (!line.trim()) {
      flushAll()
      continue
    }

    flushList()
    currentParagraphLines.push(line)
  }

  if (inCodeBlock) {
    blocks.push({
      type: 'code_block',
      code: codeLines.join('\n'),
      lang: codeLang,
    })
  }
  flushAll()

  return (
    <div className="chat-markdown">
      {blocks.map((block, idx) => {
        const key = `block-${idx}`
        if (block.type === 'code_block') {
          return (
            <pre key={key} className="chat-md-code-block">
              <code>{block.code}</code>
            </pre>
          )
        }
        if (block.type === 'heading') {
          return (
            <div key={key} className="chat-md-heading">
              <strong>{parseInline(block.text, `heading-${idx}`)}</strong>
            </div>
          )
        }
        if (block.type === 'bullet_list') {
          return (
            <ul key={key} className="chat-md-list chat-md-list--bullet">
              {block.items.map((item, itemIdx) => (
                <li key={`item-${itemIdx}`} className="chat-md-list-item">
                  {parseInline(item, `b-${idx}-${itemIdx}`)}
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === 'numbered_list') {
          return (
            <ol key={key} className="chat-md-list chat-md-list--numbered">
              {block.items.map((item, itemIdx) => (
                <li key={`item-${itemIdx}`} className="chat-md-list-item">
                  {parseInline(item, `n-${idx}-${itemIdx}`)}
                </li>
              ))}
            </ol>
          )
        }
        if (block.type === 'paragraph') {
          return (
            <p key={key} className="chat-md-paragraph">
              {parseInline(block.text, `p-${idx}`)}
            </p>
          )
        }
        return null
      })}
    </div>
  )
}
