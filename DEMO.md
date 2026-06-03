# Quorum — Demo Script

## Setup
1. `npm install && python3 scripts/seed.py`
2. `npm run dev`
3. Open `http://localhost:5173`

## Devastating Demo Query
> "Who authorized the Entity X payment and was it legitimate?"

Expected: Researcher finds the memo → Skeptic catches 4 contradictions → Synthesizer concludes fraud → LOW confidence

## Demo Flow (2 min)
1. Show offline badge
2. Type the devastating query
3. Watch the 3-agent debate unfold
4. Click each agent turn to expand citations
5. Show the 4 contradictions detected
6. Point: "This is why you need multiple agents — a single LLM would have just repeated the memo."
