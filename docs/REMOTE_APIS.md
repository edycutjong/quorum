# Remote APIs

**Quorum makes zero remote/cloud API calls. All inference is on-device via `@qvac/sdk`.**

Your documents, queries, embeddings, and model outputs never leave the machine. There is no cloud LLM, no hosted vector database, and no external embeddings/inference service.

## APIs / external interfaces used

| Interface | Type | When | Data sent off-device |
|---|---|---|---|
| `@qvac/sdk` — `loadModel`, `completion`, `ragIngest`, `ragSearch`, `unloadModel` | **Local, on-device** | Every inference | **None** — runs in-process via llama.cpp |
| QVAC model registry / HuggingFace | Network **download only** | **First run only** | None — fetches the open model weights (Llama 3.2 1B, GTE-Large) once into `~/.qvac/models`, then fully offline |

There are **no other network calls** — no analytics, telemetry, or third-party services. After the one-time model download, Quorum runs entirely air-gapped (you can disconnect the network and it still works).

## How this is enforced (verifiable)

`scripts/verify_offline.py` is part of the evidence bundle and the CI pipeline:

1. **Cloud-import scan** — fails the build if the source imports any banned cloud SDK: `openai`, `anthropic`, `googleapis`, `azure`, `aws-sdk`, `pinecone`, `cohere`, `firebase`, `supabase`.
2. **SDK-only check** — confirms the council/RAG go through `@qvac/sdk`.
3. **Network isolation** — when run with the network disconnected, asserts no outbound connectivity (`✅ Network disconnected (air-gapped)`).

```bash
# disconnect Wi-Fi / unplug ethernet first, then:
python3 scripts/verify_offline.py     # → 18/18 checks, "OFFLINE VERIFICATION PASSED"
```

The app also shows a live network pill (`LIVE · QVAC`) and `100% Offline · @qvac/sdk` in the footer during operation.
