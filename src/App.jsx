import { useState, useRef, useCallback } from 'react'
import './App.css'

const OWNER_NAME = "Harish Ravsaheb Pawar"
const OWNER_EMAIL = "pawarharish9403@gmail.com"

function ScoreRing({ score, label, color }) {
  const r = 30, cx = 38, cy = 38
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <div className="score-ring-wrap">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} style={{transition:'stroke-dasharray 1s ease'}} />
        <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle"
          fill="var(--text)" fontSize="13" fontFamily="DM Mono" fontWeight="500">{score}</text>
      </svg>
      <span className="score-ring-label">{label}</span>
    </div>
  )
}

function Section({ title, icon, items, type }) {
  if (!items || items.length === 0) return null
  return (
    <div className={`result-section ${type}`}>
      <h3 className="section-title">{icon} {title}</h3>
      <ul>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

function ScoreBadge({ score }) {
  const color = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)'
  const label = score >= 75 ? 'Strong' : score >= 50 ? 'Needs Work' : 'Weak'
  return <span className="score-badge" style={{color, borderColor: color}}>{score}/100 — {label}</span>
}

export default function App() {
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('')
  const inputRef = useRef()

  const handleFile = (f) => {
    if (!f) return
    const ok = f.type === 'application/pdf' ||
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      f.name.endsWith('.txt')
    if (!ok) { setError('Please upload a PDF, DOCX, or TXT file.'); return }
    if (f.size > 5 * 1024 * 1024) { setError('File must be under 5 MB.'); return }
    setFile(f); setError(null); setResult(null)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }, [])

  const extractText = async (f) => {
    if (f.type === 'text/plain' || f.name.endsWith('.txt')) {
      return await f.text()
    }
    if (f.name.endsWith('.docx') || f.type.includes('wordprocessingml')) {
      const mammoth = (await import('mammoth')).default
      const buf = await f.arrayBuffer()
      const res = await mammoth.extractRawText({ arrayBuffer: buf })
      return res.value
    }
    // PDF: read as base64
    return new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.onerror = rej
      reader.readAsDataURL(f)
    })
  }

  const analyze = async () => {
    if (!file) return
    setLoading(true); setError(null); setResult(null); setPhase('Reading file…')

    try {
      const isPdf = file.type === 'application/pdf'
      const extracted = await extractText(file)
      setPhase('Analyzing with AI…')

      const apiKey = import.meta.env.VITE_GEMINI_KEY
      if (!apiKey) throw new Error('NO_API_KEY')

      let parts
      if (isPdf) {
        parts = [
          { inlineData: { mimeType: 'application/pdf', data: extracted } },
          { text: PROMPT }
        ]
      } else {
        parts = [{ text: `${PROMPT}\n\n---RESUME TEXT---\n${extracted}` }]
      }

      // Try available modern models
      const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']
      let data = null
      let lastError = null

      for (const model of models) {
        setPhase(`Analyzing with AI (${model})…`)
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts }] })
          }
        )

        const json = await res.json()

        if (!res.ok) {
          const status = res.status
          const apiMsg = json?.error?.message || ''
          console.warn(`Model ${model} failed [${status}]:`, apiMsg)

          if (status === 429) { lastError = 'RATE_LIMIT'; continue }
          if (status === 400 && apiMsg.toLowerCase().includes('quota')) { lastError = 'QUOTA'; continue }
          if (status === 403) { lastError = 'FORBIDDEN'; continue }
          if (status === 401) { lastError = 'INVALID_KEY'; break }
          // For quota/billing errors (often 429 with specific message)
          if (apiMsg.toLowerCase().includes('quota') || apiMsg.toLowerCase().includes('billing') || apiMsg.toLowerCase().includes('exhausted')) {
            lastError = 'QUOTA'; continue
          }
          lastError = `API_ERROR:${status}:${apiMsg}`
          continue
        }

        data = json
        break
      }

      if (!data) {
        throw new Error(lastError || 'ALL_MODELS_FAILED')
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      if (!text) throw new Error('EMPTY_RESPONSE')

      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setResult(parsed)
    } catch (e) {
      const msg = e.message || ''
      if (msg === 'NO_API_KEY') {
        setError('❌ No API key configured. Add VITE_GEMINI_KEY to your Vercel environment variables.')
      } else if (msg === 'INVALID_KEY') {
        setError('❌ Invalid API key. Please update your VITE_GEMINI_KEY in Vercel settings.')
      } else if (msg === 'QUOTA' || msg.includes('quota') || msg.includes('billing') || msg.includes('exhausted')) {
        setError('❌ Gemini API quota exceeded or billing issue. Please get a new API key from aistudio.google.com and update it in Vercel.')
      } else if (msg === 'RATE_LIMIT') {
        setError('⏳ Rate limit reached on all models. Please wait a minute and try again.')
      } else if (msg === 'EMPTY_RESPONSE') {
        setError('⚠ AI returned an empty response. Please try again.')
      } else if (msg.startsWith('API_ERROR')) {
        const [, status, apiMsg] = msg.split(':')
        setError(`❌ API Error ${status}: ${apiMsg || 'Unknown error'}. Please check your API key.`)
      } else {
        setError(`❌ Analysis failed: ${msg || 'Unknown error'}. Please try again.`)
      }
      console.error('[ResumeAI Error]', e)
    } finally {
      setLoading(false); setPhase('')
    }
  }

  const reset = () => { setFile(null); setResult(null); setError(null) }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">ResumeAI</span>
          </div>
          <div className="owner-info">
            <span>{OWNER_NAME}</span>
            <a href={`mailto:${OWNER_EMAIL}`}>{OWNER_EMAIL}</a>
          </div>
        </div>
      </header>

      <main className="main">
        {!result ? (
          <div className="upload-view">
            <div className="hero">
              <div className="hero-eyebrow">AI-Powered Analysis</div>
              <h1 className="hero-title">Your resume,<br/><span className="gradient-text">honestly reviewed.</span></h1>
              <p className="hero-sub">Upload your resume and get instant, actionable feedback on structure, impact, ATS readiness, and more.</p>
            </div>

            <div
              className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !file && inputRef.current.click()}
            >
              <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" style={{display:'none'}}
                onChange={e => handleFile(e.target.files[0])} />
              {file ? (
                <div className="file-ready">
                  <span className="file-icon">📄</span>
                  <div>
                    <div className="file-name">{file.name}</div>
                    <div className="file-size">{(file.size/1024).toFixed(1)} KB</div>
                  </div>
                  <button className="clear-btn" onClick={(e) => { e.stopPropagation(); reset() }}>✕</button>
                </div>
              ) : (
                <div className="drop-prompt">
                  <div className="drop-icon">↑</div>
                  <div className="drop-text">Drop your resume here</div>
                  <div className="drop-sub">or click to browse — PDF, DOCX, TXT · Max 5 MB</div>
                </div>
              )}
            </div>

            {error && <div className="error-msg">⚠ {error}</div>}

            {file && (
              <button className="analyze-btn" onClick={analyze} disabled={loading}>
                {loading ? <><span className="spinner" />{phase}</> : 'Analyze Resume →'}
              </button>
            )}

            <div className="features">
              {['ATS Score', 'Impact Check', 'Section Feedback', 'Improvement Tips'].map(f => (
                <div key={f} className="feature-chip">{f}</div>
              ))}
            </div>
          </div>
        ) : (
          <div className="results-view">
            <div className="results-header">
              <div>
                <h2 className="results-title">Analysis Complete</h2>
                <p className="results-file">{file.name}</p>
              </div>
              <button className="new-btn" onClick={reset}>Analyze another →</button>
            </div>

            <div className="overall-score">
              <div className="overall-left">
                <div className="overall-label">Overall Score</div>
                <ScoreBadge score={result.overallScore} />
                <p className="overall-summary">{result.summary}</p>
              </div>
              <div className="score-rings">
                {result.scores?.map(s => (
                  <ScoreRing key={s.label} score={s.score} label={s.label}
                    color={s.score >= 75 ? 'var(--green)' : s.score >= 50 ? 'var(--yellow)' : 'var(--red)'} />
                ))}
              </div>
            </div>

            <div className="sections-grid">
              <Section title="Strengths" icon="✓" items={result.strengths} type="strengths" />
              <Section title="Weaknesses" icon="✗" items={result.weaknesses} type="weaknesses" />
              <Section title="Missing Elements" icon="○" items={result.missing} type="missing" />
              <Section title="Action Items" icon="→" items={result.actions} type="actions" />
            </div>

            {result.atsKeywords?.length > 0 && (
              <div className="keywords-section">
                <h3 className="section-title">💡 Suggested Keywords to Add</h3>
                <div className="keywords-list">
                  {result.atsKeywords.map(k => <span key={k} className="keyword-chip">{k}</span>)}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <a href="https://digitalheroesco.com" target="_blank" rel="noopener noreferrer" className="dh-btn">
          Built for Digital Heroes
        </a>
        <span className="footer-copy">Built by {OWNER_NAME} · {OWNER_EMAIL}</span>
      </footer>
    </div>
  )
}

const PROMPT = `You are a professional resume reviewer. Analyze the resume and respond ONLY with valid JSON (no markdown, no preamble).

Return exactly this structure:
{
  "overallScore": <0-100 integer>,
  "summary": "<2-sentence honest summary>",
  "scores": [
    {"label": "ATS", "score": <0-100>},
    {"label": "Impact", "score": <0-100>},
    {"label": "Format", "score": <0-100>},
    {"label": "Skills", "score": <0-100>}
  ],
  "strengths": ["<specific strength 1>", "<specific strength 2>", "<specific strength 3>"],
  "weaknesses": ["<specific weakness 1>", "<specific weakness 2>", "<specific weakness 3>"],
  "missing": ["<missing element 1>", "<missing element 2>"],
  "actions": ["<actionable improvement 1>", "<actionable improvement 2>", "<actionable improvement 3>", "<actionable improvement 4>"],
  "atsKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}

Be specific, honest, and constructive. No generic advice.`
