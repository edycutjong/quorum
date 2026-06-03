<div align="center">
  <h1>Quorum 🏛️</h1>
  <p><em>Offline multi-agent document council — 3 AI agents debate your documents to a cited answer. The visible disagreement IS the trust mechanism.</em></p>
  <img src="docs/readme-hero.png" alt="Quorum" width="100%">

  <br/>

  [![Built for QVAC Hackathon](https://img.shields.io/badge/DoraHacks-QVAC%20Edge%20AI-8b5cf6?style=for-the-badge)](https://dorahacks.io)
  [![Track](https://img.shields.io/badge/Track-General%20Purpose-06b6d4?style=for-the-badge)](https://dorahacks.io)

  <br/>

  ![Vite](https://img.shields.io/badge/Vite_8-646CFF?style=flat&logo=vite&logoColor=white)
  ![React](https://img.shields.io/badge/React_19-61DAFB?style=flat&logo=react&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
  ![QVAC](https://img.shields.io/badge/@qvac/sdk-06b6d4?style=flat)
  [![CI](https://github.com/edycutjong/quorum/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/quorum/actions/workflows/ci.yml)

</div>

---

## 💡 The Problem & Solution

When analyzing confidential documents — legal dossiers, financial audits, HR records — you can't upload them to cloud AI. But a single LLM will just parrot the first document it reads, missing contradictions.

**Quorum** solves this with a **3-agent council** that cross-examines your corpus entirely offline:

**Key Features:**
- 🔍 **Researcher** — Retrieves relevant documents, proposes initial answer with citations
- ⚡ **Skeptic** — Counter-retrieves to challenge claims, finds planted contradictions
- 🧩 **Synthesizer** — Reconciles viewpoints, assigns HIGH/MEDIUM/LOW confidence
- 📚 **Every claim cited** — Source chunk mapped to exact document
- 🔴 **Contradiction detection** — Skeptic catches what a single LLM would miss

## 🏗️ Architecture & Tech Stack

```
[User Query] → [Researcher] → [Skeptic] → [Synthesizer] → [Cited Answer]
                    ↓               ↓              ↓
              RAG retrieve    Counter-retrieve   Reconcile
              + propose       + challenge        + confidence
```

| Layer | Technology |
|---|---|
| **Frontend** | Vite 8, React 19, TypeScript |
| **AI Engine** | @qvac/sdk (completion, RAG) |
| **Embeddings** | GTE-Large-FP16 via @qvac/sdk |
| **LLM** | Llama 3.2 1B (local) |

## 🏆 Why ONLY QVAC?

| QVAC SDK Method | Quorum Usage | Cloud Alternative You'd Need |
|---|---|---|
| `loadModel()` + `completion()` | Runs all 3 agents (Researcher, Skeptic, Synthesizer) | OpenAI API ($0.03/query × 3 agents) |
| `ragIngest()` + `ragSearch()` | Embeds & searches private dossier locally | Pinecone + OpenAI Embeddings API |
| `loadModel(GTE_LARGE_FP16)` | 384-dim embeddings for citation matching | Cohere Embed API |
| `unloadModel()` | Memory lifecycle — load once, 3 agents, unload | N/A (cloud doesn't care) |

**Take QVAC out and you'd need 3 separate cloud services** (OpenAI + Pinecone + Cohere), a network connection, and your confidential documents would leave your machine.

## 📋 Dossier — Planted Contradictions

The demo includes a 5-document **Northwind dossier** with deliberate contradictions:

| Document | Claims | Contradiction |
|---|---|---|
| `memo_ref_4821.txt` | VP Chen authorized $2.4M payment March 12 | Chen was on PTO |
| `board_minutes_march.txt` | Chen PTO March 11-15, no Entity X discussion | Memo claims March 12 |
| `q1_financial_report.txt` | Audit flags: no SOW, no deliverables | Payment processed |
| `hr_access_logs.txt` | No badge/VPN access March 12 | Memo timestamped March 12 |
| `governance_charter.txt` | >$1M needs board resolution | No board approval |

## 🚀 Getting Started

```bash
git clone https://github.com/edycutjong/quorum.git
cd quorum
npm install
python3 scripts/seed.py
npm run dev
```

> **Devastating Demo Query:** "Who authorized the Entity X payment and was it legitimate?"

## 📊 Benchmarks

Run `python3 scripts/bench.py` to reproduce. Results on MacBook Pro M2 (16GB RAM):

| Metric | p50 | p95 | Budget |
|---|---|---|---|
| Full Council Round | ~170ms | ~180ms | <15,000ms |
| RAG Search | ~15ms | ~16ms | <500ms |
| Model Load | ~2,500ms | ~3,000ms | <10,000ms |
| Peak RAM | ~1.2GB | — | <4,096MB |

> *Simulated timings — run `python3 scripts/bench.py` on your hardware for real @qvac/sdk measurements.*

## 🧪 Testing & CI

**3 E2E suites + 7 offline verification checks = 10 test assertions.** Target: 100+ with unit tests.

**7-stage pipeline:** Quality → Security → Build → E2E → Performance → Offline → Deploy

```bash
# ── Code Quality ────────────────────────────
npm run lint           # ESLint
npm run typecheck      # TypeScript check
npm run ci             # Full quality gate

# ── E2E & Performance ──────────────────────
npm run e2e            # Playwright E2E (3 suites)
npm run lighthouse     # Lighthouse CI audit

# ── Evidence Bundle ─────────────────────────
python3 scripts/verify_offline.py
python3 scripts/bench.py
python3 scripts/check_submission_readiness.py
```

| Layer | Tool | Status |
|---|---|---|
| Code Quality | ESLint + TypeScript | ✅ |
| E2E Testing | Playwright (3 suites) | ✅ |
| Security (SAST) | CodeQL | ✅ |
| Security (SCA) | Dependabot + npm audit | ✅ |
| Secret Scanning | TruffleHog | ✅ |
| Performance | Lighthouse CI | ✅ |
| Offline Verification | verify_offline.py (7/7) | ✅ |

## 📁 Project Structure
```
quorum/
├── docs/               # README assets
├── data/fixtures/
│   └── northwind_dossier/  # 5 docs with planted contradictions
├── e2e/                # Playwright E2E tests
├── scripts/            # seed, bench, verify, readiness
├── src/
│   ├── core/
│   │   ├── qvac.ts     # @qvac/sdk wrapper
│   │   ├── rag.ts      # Corpus RAG pipeline
│   │   └── council.ts  # 3-agent council orchestration
│   ├── App.tsx         # Debate transcript viewer
│   └── App.css         # Dark mode theme
├── .github/            # CI/CD + CodeQL + Dependabot
├── playwright.config.ts
├── lighthouserc.json
└── README.md
```

## ⚠️ Honest Limitations

1. Small model — limited reasoning depth vs cloud LLMs
2. Sequential agents — no true parallel debate
3. English only
4. Fixed dossier — no live document upload yet
5. Mock inference in demo mode

## 📄 License
[MIT](LICENSE) © 2026 Edy Cu

## 🙏 Acknowledgments
Built for **QVAC Hackathon I — Unleash Edge AI** (DoraHacks). Thank you to the QVAC team for making multi-agent AI possible on the edge.
