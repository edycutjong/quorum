# Quorum — Demo Script

## Setup
1. `npm install`
2. `npm run start` — boots the QVAC backend (`:3001`) **and** the web app (`:5173`) together.
   First run downloads the local models, so allow a moment.
3. Seed the corpus into the running backend:
   `curl -X POST http://localhost:3001/api/seed`
   (Ingests the Northwind dossier into the local RAG store the council queries.)
4. Open `http://localhost:5173` — the status pill should read **LIVE · QVAC**
   (if it reads **DEMO · OFFLINE**, the backend isn't reachable — check step 2).

> Tip: disconnect the network before this step to demonstrate the air-gap — the
> badge stays LIVE because everything runs locally via `@qvac/sdk`.

## Devastating Demo Query
> "Who authorized the Entity X payment and was it legitimate?"

Expected debate over the dossier:
- **Researcher** finds memo REF-4821 → "VP Operations Sarah Chen authorized $2.4M on March 12."
- **Skeptic** counter-retrieves and surfaces the conflicts: HR access logs show Chen on
  approved PTO March 11–15 (no badge swipe, no VPN), the March 10 board minutes record
  **no** discussion of Entity X, and governance §4.2 requires a Board resolution for a
  payment of this size.
- **Synthesizer** returns a cited verdict flagging the attribution as **disputed**, with
  **LOW confidence** (the records are irreconcilable).

## Demo Flow (~2 min)
1. Show the **LIVE · QVAC** badge / air-gap (network off).
2. Type the demo query.
3. Watch the 3-agent debate stream in (Researcher → Skeptic → Synthesizer).
4. Click each agent turn to expand its citations → exact source chunks.
5. Show the contradictions panel and the **LOW** confidence badge.
6. Point: "This is why you need multiple agents — a single LLM would have just repeated
   the memo. The visible disagreement is the trust mechanism."

## Reproduce the evidence bundle
- `python3 scripts/verify_offline.py` — disconnect the network first (0 outbound).
- `npm run bench` — real council latency + contradiction recall (writes `data/bench_results.json`).
- `python3 scripts/check_submission_readiness.py` — submission gate.
