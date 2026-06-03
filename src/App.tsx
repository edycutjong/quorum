import { useState, useCallback } from 'react'
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
}

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

  // Generic response for other queries
  return {
    query,
    turns: [
      { agent: 'researcher', content: 'Searching the corpus for relevant documents...', citations: [] },
      { agent: 'skeptic', content: 'No contradictions found in the available evidence for this query.', citations: [] },
      { agent: 'synthesizer', content: 'Based on available documents, I have limited information to address this query. Please try a more specific question about the Northwind dossier.', citations: [] },
    ],
    confidence: 'medium',
    contradictions: [],
    finalAnswer: 'Insufficient evidence in the corpus to provide a definitive answer. Try querying about the Entity X payment, VP Chen authorization, or governance compliance.',
  }
}

// ── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<CouncilResult | null>(null)
  const [isDebating, setIsDebating] = useState(false)
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null)

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return
    setIsDebating(true)
    setResult(null)
    setExpandedTurn(null)

    // Simulate council debate delay
    setTimeout(() => {
      const debateResult = mockCouncilDebate(query)
      setResult(debateResult)
      setIsDebating(false)
    }, 1500)
  }, [query])

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo">🏛️</span>
          <div>
            <h1 className="title">Quorum</h1>
            <p className="subtitle">Multi-Agent Document Council</p>
          </div>
        </div>
        <div className="network-pill">
          <span className="network-dot" />
          OFFLINE · QVAC
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
        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={!query.trim() || isDebating}
        >
          {isDebating ? '⏳ Council is debating...' : '🏛️ Convene Council'}
        </button>
      </div>

      {/* Loading State */}
      {isDebating && (
        <div className="debating">
          <div className="debating-spinner" />
          <p>Three agents are cross-examining the corpus...</p>
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
