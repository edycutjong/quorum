import { useState, useCallback, useEffect, useRef } from 'react'
import './App.css'

// ── Types ───────────────────────────────────────────────────────────────────

interface Citation {
  id: string
  content: string
  source: string
}

interface AgentTurn {
  agent: 'researcher' | 'skeptic' | 'synthesizer'
  content: string
  citations: Citation[]
}

interface CouncilResult {
  query: string
  turns: AgentTurn[]
  confidence: 'high' | 'medium' | 'low'
  contradictions: string[]
  finalAnswer: string
  timestamp?: number
}

const HISTORY_KEY = 'quorum_history'
const MAX_HISTORY = 20

// ── Agent Colors ────────────────────────────────────────────────────────────

const AGENT_CONFIG = {
  researcher: { color: '#06b6d4', label: '🔍 Researcher', bgColor: 'rgba(6, 182, 212, 0.08)' },
  skeptic: { color: '#f59e0b', label: '⚡ Skeptic', bgColor: 'rgba(245, 158, 11, 0.08)' },
  synthesizer: { color: '#22c55e', label: '🧩 Synthesizer', bgColor: 'rgba(34, 197, 94, 0.08)' },
}

const CONFIDENCE_STYLES = {
  high: { color: '#22c55e', label: 'HIGH', icon: '🟢' },
  medium: { color: '#f59e0b', label: 'MEDIUM', icon: '🟡' },
  low: { color: '#ef4444', label: 'LOW', icon: '🔴' },
}

// ── Example questions (one-click demo queries over the Northwind dossier) ────
type Suggestion = { text: string; query: string; color: string }
const SUGGESTIONS: { group: string; items: Suggestion[] }[] = [
  {
    group: 'Try a question',
    items: [
      { text: 'Who authorized the Entity X payment?', query: 'Who authorized the Entity X payment and was it legitimate?', color: 'var(--color-error)' },
      { text: 'Was VP Chen in the office on March 12?', query: 'Was VP Operations Chen in the office on March 12th?', color: 'var(--primary)' },
      { text: 'Does the $2.4M payment comply with §4.2?', query: 'Does the $2.4M Entity X payment comply with governance Section 4.2?', color: 'var(--accent)' },
      { text: 'Who attended the March 10 board meeting?', query: 'Who attended the March 10 board meeting, and who was absent?', color: 'var(--primary)' },
      { text: 'Summarize the red flags in the payment', query: 'Summarize every red flag in the Entity X payment.', color: 'var(--color-error)' },
      { text: 'Total Q1 revenue?', query: 'What is the total revenue reported in the Q1 financial report?', color: 'var(--color-success)' },
    ],
  },
  {
    group: 'Edge cases',
    items: [
      { text: 'Out of scope: stock price', query: "What is Northwind's current stock price?", color: 'var(--color-info)' },
      { text: 'Leading question', query: 'Confirm the Entity X payment was fully authorized and compliant.', color: 'var(--accent)' },
      { text: 'Wrong entity name', query: 'Who approved the payment to Northwind Logistics?', color: 'var(--color-error)' },
      { text: 'Totally off-topic', query: "What's the best way to cook pasta?", color: 'var(--text-low)' },
    ],
  },
]

// ── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<CouncilResult | null>(null)
  const [isDebating, setIsDebating] = useState(false)
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null)
  const [connectionMode, setConnectionMode] = useState<'checking' | 'live' | 'offline'>('checking')
  const [history, setHistory] = useState<CouncilResult[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [showHistory, setShowHistory] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestRef = useRef<HTMLDivElement>(null)

  // Persist history to localStorage
  const saveToHistory = useCallback((entry: CouncilResult) => {
    setHistory(prev => {
      const updated = [{ ...entry, timestamp: Date.now() }, ...prev].slice(0, MAX_HISTORY)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)) } catch { /* quota */ }
      return updated
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    try { localStorage.removeItem(HISTORY_KEY) } catch { /* noop */ }
  }, [])

  const loadFromHistory = useCallback((entry: CouncilResult) => {
    setResult(entry)
    setQuery(entry.query)
    setExpandedTurn(null)
    setShowHistory(false)
  }, [])

  // Check backend connectivity on mount
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.ok ? setConnectionMode('live') : setConnectionMode('offline'))
      .catch(() => setConnectionMode('offline'))
  }, [])
  const [currentAgent, setCurrentAgent] = useState<string | null>(null)

  // Close the suggestions popover on outside-click or Escape
  useEffect(() => {
    if (!showSuggestions) return
    const onDown = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSuggestions(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showSuggestions])

  const handleSubmit = useCallback(async (override?: string) => {
    const q = (typeof override === 'string' ? override : query).trim()
    if (!q) return
    if (typeof override === 'string') setQuery(override)
    setIsDebating(true)
    setResult(null)
    setExpandedTurn(null)
    setCurrentAgent('researcher')

    // Try streaming SSE endpoint (progressive agent rendering)
    try {
      const res = await fetch('/api/council/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })

      if (res.ok && res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const streamedTurns: AgentTurn[] = []
        let finalData: { confidence?: 'high' | 'medium' | 'low'; finalAnswer?: string; contradictions?: string[] } = {}

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events from buffer
          const lines = buffer.split('\\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer

          let eventType = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ') && eventType) {
              try {
                const data = JSON.parse(line.slice(6))

                if (eventType === 'turn') {
                  streamedTurns.push(data)
                  // Update UI progressively — show turns as they arrive
                  const nextAgent = data.agent === 'researcher' ? 'skeptic'
                    : data.agent === 'skeptic' ? 'synthesizer' : null
                  setCurrentAgent(nextAgent)
                  setResult(prev => ({
                    query: q,
                    turns: [...streamedTurns],
                    confidence: prev?.confidence || 'medium',
                    contradictions: prev?.contradictions || [],
                    finalAnswer: prev?.finalAnswer || '',
                  }))
                } else if (eventType === 'result') {
                  finalData = data
                } else if (eventType === 'error') {
                  console.error('[Quorum] Stream error:', data.error)
                }
              } catch { /* malformed JSON, skip */ }
              eventType = ''
            }
          }
        }

        // Compose final result
        const liveResult: CouncilResult = {
          query: q,
          turns: streamedTurns,
          confidence: finalData.confidence || 'medium',
          contradictions: finalData.contradictions || [],
          finalAnswer: finalData.finalAnswer || '',
        }
        setResult(liveResult)
        saveToHistory(liveResult)
        setCurrentAgent(null)
        setIsDebating(false)
        return
      } else {
        throw new Error('Backend responded with an error status')
      }
    } catch (err) {
      console.error('[Quorum] Connection to backend failed:', err);
      setResult({
        query: q,
        turns: [],
        confidence: "low",
        contradictions: ["Fatal Error: Could not connect to the local Quorum backend."],
        finalAnswer: "The debate council is unreachable. Please ensure the local QVAC provider is running."
      });
      setCurrentAgent(null)
      setIsDebating(false)
    }
  }, [query, saveToHistory])

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <img className="logo" src="/icon.svg" alt="Quorum" />
          <div>
            <h1 className="title">Quorum</h1>
            <p className="subtitle">Multi-Agent Document Council</p>
          </div>
        </div>
        <div className={`network-pill ${connectionMode === 'live' ? 'network-live' : ''}`}>
          <span className={`network-dot ${connectionMode === 'live' ? 'dot-live' : ''}`} />
          {connectionMode === 'live' ? 'LIVE · QVAC' : connectionMode === 'checking' ? 'CHECKING...' : 'OFFLINE'}
        </div>
      </header>

      {/* Query Input */}
      <div className="query-section">
        <textarea
          className="query-input"
          placeholder="Ask a question about the Northwind dossier... e.g. 'Who authorized the Entity X payment?'"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }}}
          rows={2}
        />
        <div className="query-actions">
          <div className="suggest-popover-wrap" ref={suggestRef}>
            <button
              type="button"
              className="history-toggle-btn suggest-trigger"
              onClick={() => setShowSuggestions((v) => !v)}
              aria-expanded={showSuggestions}
              aria-haspopup="menu"
            >
              💡 Try
              <span className={`suggestions-chevron ${showSuggestions ? 'open' : ''}`}>▾</span>
            </button>
            {showSuggestions && (
              <div className="suggest-popover" role="menu" aria-label="Example questions">
                {SUGGESTIONS.map((g) => (
                  <div key={g.group} className="suggest-group">
                    <div className="suggest-group-label">{g.group}</div>
                    {g.items.map((s) => (
                      <button
                        key={s.text}
                        type="button"
                        role="menuitem"
                        className="suggest-item"
                        onClick={() => { setShowSuggestions(false); handleSubmit(s.query) }}
                        disabled={isDebating}
                        title={s.query}
                      >
                        <span className="suggest-dot" style={{ background: s.color, color: s.color }} />
                        {s.text}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="submit-btn"
            onClick={() => handleSubmit()}
            disabled={!query.trim() || isDebating}
          >
            {isDebating ? '⏳ Council is debating...' : '🏛️ Convene Council'}
          </button>
          {history.length > 0 && (
            <button
              className="history-toggle-btn"
              onClick={() => setShowHistory(!showHistory)}
            >
              📜 History ({history.length})
            </button>
          )}
        </div>
      </div>

      {/* History Panel */}
      {showHistory && history.length > 0 && (
        <div className="history-panel">
          <div className="history-header">
            <h3 className="section-title" style={{ margin: 0 }}>📜 Past Debates</h3>
            <button className="history-clear-btn" onClick={clearHistory}>Clear All</button>
          </div>
          <div className="history-list">
            {history.map((entry, i) => {
              const conf = CONFIDENCE_STYLES[entry.confidence]
              const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
              return (
                <button key={i} className="history-item" onClick={() => loadFromHistory(entry)}>
                  <div className="history-item-top">
                    <span className="history-query">{entry.query}</span>
                    <span className="history-time">{time}</span>
                  </div>
                  <div className="history-item-bottom">
                    <span className="history-confidence" style={{ color: conf.color }}>
                      {conf.icon} {conf.label}
                    </span>
                    {entry.contradictions.length > 0 && (
                      <span className="history-contras">🔴 {entry.contradictions.length}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {isDebating && (
        <div className="debating">
          <div className="debating-spinner" />
          {currentAgent ? (
            <p>
              {currentAgent === 'researcher' && '🔍 Researcher is retrieving documents...'}
              {currentAgent === 'skeptic' && '⚡ Skeptic is challenging the findings...'}
              {currentAgent === 'synthesizer' && '🧩 Synthesizer is reconciling positions...'}
            </p>
          ) : (
            <p>Finalizing council verdict...</p>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="results">
          {/* Confidence Badge */}
          <div className="confidence-row">
            <span className="confidence-badge" style={{ color: CONFIDENCE_STYLES[result.confidence].color }}>
              {CONFIDENCE_STYLES[result.confidence].icon} Confidence: {CONFIDENCE_STYLES[result.confidence].label}
            </span>
            {result.contradictions.length > 0 && (
              <span className="contradiction-count">
                🔴 {result.contradictions.length} contradiction{result.contradictions.length > 1 ? 's' : ''} found
              </span>
            )}
          </div>

          {/* Final Answer */}
          <div className="final-answer">
            <h3>📋 Final Answer</h3>
            <p>{result.finalAnswer}</p>
          </div>

          {/* Debate Transcript */}
          <h3 className="section-title">🗣️ Debate Transcript</h3>
          {result.turns.map((turn, i) => {
            const config = AGENT_CONFIG[turn.agent]
            const isExpanded = expandedTurn === i
            return (
              <div
                key={i}
                className="agent-turn"
                style={{ borderLeftColor: config.color, backgroundColor: config.bgColor }}
                onClick={() => setExpandedTurn(isExpanded ? null : i)}
              >
                <div className="agent-header">
                  <span className="agent-label" style={{ color: config.color }}>{config.label}</span>
                  <span className="citation-count">{turn.citations.length} citations</span>
                </div>
                <p className="agent-content">{turn.content}</p>
                {isExpanded && turn.citations.length > 0 && (
                  <div className="citations-panel">
                    {turn.citations.map((c) => (
                      <div key={c.id} className="citation-item">
                        <span className="citation-icon">📄</span>
                        <div>
                          <p className="citation-text">{c.content}</p>
                          <p className="citation-source">{c.source}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Contradictions */}
          {result.contradictions.length > 0 && (
            <>
              <h3 className="section-title">🔴 Contradictions Detected</h3>
              <div className="contradictions">
                {result.contradictions.map((c, i) => (
                  <div key={i} className="contradiction-item">
                    <span className="contra-num">{i + 1}</span>
                    <p>{c}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>Model: Llama 3.2 1B · RAG: GTE-Large-FP16 · 100% Offline · @qvac/sdk</p>
      </footer>
    </div>
  )
}

export default App
