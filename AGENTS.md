# 🏛️ Quorum — Agent Instructions

## Project
Offline multi-agent "council" that debates your documents to a cited answer. Three agents (Researcher, Skeptic, Synthesizer) cross-examine a private corpus — fully offline on a laptop via `@qvac/sdk`. The visible disagreement IS the trust mechanism.

## Hackathon
**QVAC Hackathon I – Unleash Edge AI** (DoraHacks) — General Purpose Track + Build in Public. $21,000 USDT pool.

## Structure
- `src/core/qvac.ts` — Shared QVAC SDK wrapper (loadModel, completion, RAG, TTS, P2P)
- `src/core/rag.ts` — Corpus RAG pipeline (embedding model lifecycle, ingest, searchCorpus)
- `src/core/council.ts` — Multi-agent council orchestration (Researcher → Skeptic → Synthesizer)
- `src/App.tsx` — Vite + React entry point (desktop web app)
- `src/App.css` / `src/index.css` — Styling
- `scripts/` — seed.py, bench.py, verify_offline.py, check_submission_readiness.py
- `data/fixtures/` — Synthetic dossier with planted contradictions

## Tech Stack
| Layer | Technology |
|---|---|
| **Frontend** | Vite 8, React 19, TypeScript |
| **AI Engine** | @qvac/sdk (completion, RAG) |
| **Embeddings** | GTE-Large-FP16 via @qvac/sdk |
| **LLM** | Llama 3.2 1B (local) |

## Key Rules
- **All inference** must go through `@qvac/sdk` — zero cloud APIs
- **Three agents**: Researcher (retrieve + propose), Skeptic (challenge + contradict), Synthesizer (reconcile + confidence)
- **Citations everywhere**: every claim maps to an exact source chunk
- **Skeptic catches contradictions**: must find planted contradictions in test corpus
- **Confidence scoring**: high (agents agree), medium (Skeptic has objections), low (irreconcilable)
- **Colors**: Cyan (#06b6d4) for Researcher, Amber (#f59e0b) for Skeptic, Green (#22c55e) for Synthesizer, Red (#ef4444) for contradictions
- **Aesthetic**: Dark mode, glassmorphism cards, debate transcript viewer
- **Test target**: 100+ tests stated in README

## Critical Patterns
- Council runs sequentially: Researcher → Skeptic → Synthesizer (same model, different system prompts)
- Each agent can re-query the corpus via `searchCorpus()`
- `searchCorpus()` is aliased as `searchMedicalKnowledge` for backward compat in council.ts
- Model lifecycle: load once, run all 3 agents, unload once (minimize load/unload overhead)
- Skeptic counter-retrieval: searches for `"contraindications exceptions safety warnings: ${query}"`
