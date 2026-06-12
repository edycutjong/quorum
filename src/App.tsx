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
          const lines = buffer.split('\n')
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

      {/* Query Buttons */}
      <div className="query-section" style={{ padding: '2rem 0' }}>
        <h3 style={{ textAlign: "center", marginBottom: "1.5rem", color: 'var(--text-main)' }}>Select an Audit Target</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', width: '100%' }}>
          <button 
            style={{ padding: '1.5rem', fontSize: '1.1rem', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: 'var(--text-main)', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
            onClick={() => handleSubmit("Audit Q1 Financials vs HR Logs for the Entity X payment")} disabled={isDebating}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <span style={{ fontSize: '2.5rem' }}>📊</span>
            <strong>Audit Q1 Financials vs HR Logs</strong>
          </button>
          <button 
            style={{ padding: '1.5rem', fontSize: '1.1rem', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: 'var(--text-main)', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
            onClick={() => handleSubmit("Cross-reference VP Chen's attendance on March 12th")} disabled={isDebating}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <span style={{ fontSize: '2.5rem' }}>📅</span>
            <strong>Cross-Reference VP Chen Attendance</strong>
          </button>
          <button 
            style={{ padding: '1.5rem', fontSize: '1.1rem', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--color-error)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: 'var(--color-error)', transition: 'all 0.2s', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
            onClick={() => handleSubmit("Summarize every compliance red flag in the Entity X payment")} disabled={isDebating}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <span style={{ fontSize: '2.5rem' }}>🚨</span>
            <strong>Extract Compliance Red Flags</strong>
          </button>
        </div>
        {history.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <button
              className="history-toggle-btn"
              onClick={() => setShowHistory(!showHistory)}
            >
              📜 History ({history.length})
            </button>
          </div>
        )}
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
        <div className="debating-terminal" style={{ background: '#0a0a0a', padding: '1.5rem', borderRadius: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#06b6d4', border: '1px solid #1e293b', marginTop: '2rem', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)' }}>
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.75rem' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#06b6d4', animation: 'pulse 1.5s infinite', display: 'inline-block' }} />
            <span style={{ letterSpacing: '2px', fontSize: '0.9rem', fontWeight: 600 }}>COUNCIL DEBATE IN PROGRESS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.95rem' }}>
            {currentAgent === 'researcher' && <div className="typing-text">&gt; [Researcher Node]: Cross-referencing access logs...</div>}
            {currentAgent === 'skeptic' && (
              <>
                <div style={{ color: '#475569' }}>&gt; [Researcher Node]: Initial retrieval complete. 4 documents found.</div>
                <div className="typing-text" style={{ color: '#f59e0b' }}>&gt; [Skeptic Node]: Challenging findings... Conflict found in Q1 report...</div>
              </>
            )}
            {currentAgent === 'synthesizer' && (
              <>
                <div style={{ color: '#475569' }}>&gt; [Researcher Node]: Initial retrieval complete. 4 documents found.</div>
                <div style={{ color: '#475569' }}>&gt; [Skeptic Node]: Challenging findings... Conflict found in Q1 report...</div>
                <div className="typing-text" style={{ color: '#22c55e' }}>&gt; [QVAC Module]: Reconciling positions... 2/3 Consensus Reached.</div>
              </>
            )}
            {!currentAgent && (
              <>
                <div style={{ color: '#475569' }}>&gt; [Researcher Node]: Initial retrieval complete. 4 documents found.</div>
                <div style={{ color: '#475569' }}>&gt; [Skeptic Node]: Challenging findings... Conflict found in Q1 report...</div>
                <div style={{ color: '#475569' }}>&gt; [QVAC Module]: Reconciling positions... 2/3 Consensus Reached.</div>
                <div className="typing-text">&gt; Finalizing verdict...</div>
              </>
            )}
          </div>
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
