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

// ── Mock Council ────────────────────────────────────────────────────────────

function mockCouncilDebate(query: string): CouncilResult {
  const lower = query.toLowerCase()
  const aboutPayment = lower.includes('payment') || lower.includes('entity x') || lower.includes('$2.4m') || lower.includes('authorization')
  const aboutChen = lower.includes('chen') || lower.includes('vp') || lower.includes('march 12')

  if (aboutPayment || aboutChen) {
    return {
      query,
      turns: [
        {
          agent: 'researcher',
          content: 'Internal memo REF-4821 states that VP Operations Sarah Chen authorized a $2.4M payment to Entity X (Northwind Consultants LLC) on March 12, 2024 for "strategic advisory services." The payment was processed through Account 7742-A and cleared within 24 hours.',
          citations: [
            { id: 'r1', content: 'VP Chen authorized $2.4M payment on March 12', source: 'memo_ref_4821.txt' },
            { id: 'r2', content: 'Payment category: Professional Services, Account 7742-A', source: 'q1_financial_report.txt' },
          ],
        },
        {
          agent: 'skeptic',
          content: '🚨 CONTRADICTION DETECTED: Board minutes from March 10 show VP Chen was approved for PTO from March 11-15. HR access logs confirm NO badge swipe and NO VPN login on March 12. She was physically incapable of authorizing this payment. Furthermore, the $2.4M exceeds the $1M threshold requiring written board approval per governance charter Section 4.2 — but NO board discussion of Entity X occurred.',
          citations: [
            { id: 's1', content: 'VP Chen approved PTO March 11-15', source: 'board_minutes_march.txt' },
            { id: 's2', content: 'March 12: NO badge swipe, no VPN login', source: 'hr_access_logs.txt' },
            { id: 's3', content: '>$1M requires board resolution per Section 4.2', source: 'governance_charter.txt' },
            { id: 's4', content: 'Internal audit: no SOW, no deliverables documented', source: 'q1_financial_report.txt' },
          ],
        },
        {
          agent: 'synthesizer',
          content: 'The council finds IRRECONCILABLE CONTRADICTIONS in this dossier. Memo REF-4821 claims VP Chen authorized the payment on March 12, but three independent sources (board minutes, HR logs, and governance charter) prove she was on PTO, had no system access, and lacked the authority to solo-authorize a $2.4M payment. Internal audit has already flagged the payment for missing SOW and deliverables. Confidence: LOW due to evidence of potential fraud or document forgery.',
          citations: [
            { id: 'y1', content: 'Memo vs PTO: irreconcilable', source: 'board_minutes_march.txt' },
            { id: 'y2', content: 'No system access March 12', source: 'hr_access_logs.txt' },
            { id: 'y3', content: 'Governance breach: Section 4.2 + 4.3', source: 'governance_charter.txt' },
          ],
        },
      ],
      confidence: 'low',
      contradictions: [
        'Memo REF-4821 claims Chen authorized payment on March 12, but she was on PTO March 11-15',
        'HR logs show NO badge/VPN access on March 12 — memo timestamp is March 12 14:23 EST',
        'Payment exceeds $1M threshold requiring board resolution (Section 4.2) — no board discussion found',
        'No SOW, no deliverables, no vendor due diligence per Section 4.3',
      ],
      finalAnswer: 'The $2.4M payment to Entity X appears to have been authorized through a fraudulent or forged memo. VP Chen could not have approved it — she had no physical or digital access to company systems on March 12. The payment also violates governance charter Sections 4.2 and 4.3. Recommend immediate investigation by the Audit Committee.',
    }
  }

  // For any other query, the council still debates using available Northwind dossier documents
  return {
    query,
    turns: [
      {
        agent: 'researcher',
        content: `Searching the Northwind dossier corpus for documents relevant to: "${query}"\n\nThe available corpus contains financial records, board minutes, HR logs, and internal memos from Northwind Ltd. The most pertinent finding: Internal memo REF-4821 references a $2.4M payment to Entity X (Northwind Consultants LLC), authorized by VP Operations Sarah Chen on March 12. The Q1 financial report flags this as an unaudited line item under "Professional Services."`,
        citations: [
          { id: 'g1', content: 'VP Chen authorized $2.4M payment to Entity X on March 12', source: 'memo_ref_4821.txt' },
          { id: 'g2', content: 'Unaudited line item: Professional Services $2.4M', source: 'q1_financial_report.txt' },
        ],
      },
      {
        agent: 'skeptic',
        content: `⚠️ While this query doesn't directly ask about the Entity X payment, the Skeptic finds material inconsistencies in the corpus that may be relevant:\n\n1. Board minutes from March 10 show VP Chen was approved for PTO from March 11-15\n2. HR access logs show NO badge swipe and NO VPN login for Chen on March 12\n3. The $2.4M exceeds the $1M board-approval threshold (Governance Charter Section 4.2)\n4. No Statement of Work or deliverables were documented for Entity X\n\nThese contradictions suggest systemic governance issues in the Northwind dossier that may affect the reliability of any document in this corpus.`,
        citations: [
          { id: 'g3', content: 'VP Chen approved PTO March 11-15', source: 'board_minutes_march.txt' },
          { id: 'g4', content: 'March 12: NO badge swipe, no VPN login for Chen', source: 'hr_access_logs.txt' },
          { id: 'g5', content: '>$1M requires board resolution per Section 4.2', source: 'governance_charter.txt' },
        ],
      },
      {
        agent: 'synthesizer',
        content: `The council has reviewed the available Northwind dossier for your query: "${query}"\n\nWhile the corpus has limited direct coverage of this specific topic, the council has identified a critical pattern: key documents in this corpus contain planted contradictions (the VP Chen authorization vs PTO records). This affects the overall trustworthiness of the dossier.\n\nRecommendation: Cross-reference any findings with the flagged contradictions above. The Audit Committee should be notified before relying on any single document from this corpus.`,
        citations: [
          { id: 'g6', content: 'Corpus integrity compromised by memo/PTO contradiction', source: 'board_minutes_march.txt' },
        ],
      },
    ],
    confidence: 'medium',
    contradictions: [
      'Memo REF-4821 claims Chen authorized payment March 12, but she was on PTO March 11-15',
      'No SOW or deliverables documented for Entity X despite $2.4M payment',
    ],
    finalAnswer: `The Northwind dossier has limited direct evidence for this query. However, the council has surfaced material contradictions in the corpus — particularly around the Entity X payment and VP Chen's authorization — that cast doubt on document integrity. Try asking specifically about "Who authorized the Entity X payment?" for a full three-agent investigation.`,
  }
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
  const [connectionMode, setConnectionMode] = useState<'checking' | 'live' | 'demo'>(() => {
    if (
      typeof window !== 'undefined' &&
      (navigator.webdriver ||
        window.location.search.includes('demo=true') ||
        window.location.port === '4173')
    ) {
      return 'demo'
    }
    return 'checking'
  })
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
    if (
      navigator.webdriver ||
      window.location.search.includes('demo=true') ||
      window.location.port === '4173'
    ) {
      return
    }
    fetch('/api/health')
      .then((r) => r.ok ? setConnectionMode('live') : setConnectionMode('demo'))
      .catch(() => setConnectionMode('demo'))
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
    if (connectionMode === 'live') {
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
        }
      } catch {
        console.warn('[Quorum] Streaming failed, falling back to demo mode')
        setConnectionMode('demo')
      }
    }

    // Fallback: mock council debate
    setCurrentAgent('researcher')
    setTimeout(() => {
      const debateResult = mockCouncilDebate(q)
      setResult(debateResult)
      saveToHistory(debateResult)
      setCurrentAgent(null)
      setIsDebating(false)
    }, 1500)
  }, [query, connectionMode, saveToHistory])

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
          {connectionMode === 'live' ? 'LIVE · QVAC' : connectionMode === 'checking' ? 'CHECKING...' : 'DEMO · OFFLINE'}
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
