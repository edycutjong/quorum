# Audit Log

Quorum emits a **structured audit log** capturing model lifecycle (loads/unloads) and per-inference performance (prompt size, tokens, **TTFT**, **tokens/sec**, device) for every council run.

- **Format:** newline-delimited JSON (NDJSON), one record per line.
- **Location:** [`docs/audit-log.jsonl`](audit-log.jsonl) (a real captured run is committed).
- **Source:** `src/core/audit.ts` (sink) + instrumentation in `src/core/qvac.ts` (model loads/unloads + inference stats from the SDK's `CompletionStats`) and `server.ts` (per-query markers).

## Record schema

| `event` | Fields |
|---|---|
| `model_load` | `model` (`llm`/`embeddings`), `modelId`, `ms` (load time) |
| `model_unload` | `modelId` |
| `council_query` | `endpoint`, `query` |
| `inference` | `label` (agent role), `modelId`, `promptChars`, `promptPreview`, `durationMs`, `timeToFirstTokenMs`, `tokensPerSecond`, `promptTokens`, `generatedTokens`, `cacheTokens`, `backendDevice` (`cpu`/`gpu`) |
| `council_result` | `confidence`, `citations`, `elapsed_ms` |

Every record is timestamped (`ts`, ISO-8601).

## Example: one demo run (Apple M1 Max)

Query: *"Who authorized the Entity X payment and was it legitimate?"* — the committed `audit-log.jsonl` contains:

```jsonc
{"event":"model_load","model":"embeddings","modelId":"c8fb5f8…","ms":950}
{"event":"council_query","endpoint":"/api/council","query":"Who authorized the Entity X payment and was it legitimate?"}
{"event":"model_load","model":"llm","modelId":"31b329c…","ms":1574}
{"event":"inference","label":"researcher","promptTokens":385,"generatedTokens":42,"timeToFirstTokenMs":154.7,"tokensPerSecond":160.9,"backendDevice":"gpu","durationMs":512}
{"event":"inference","label":"skeptic","promptTokens":418,"generatedTokens":198,"timeToFirstTokenMs":124.0,"tokensPerSecond":187.0,"backendDevice":"gpu","durationMs":1326}
{"event":"inference","label":"synthesizer","promptTokens":273,"generatedTokens":133,"timeToFirstTokenMs":86.8,"tokensPerSecond":132.2,"backendDevice":"gpu","durationMs":1222}
{"event":"council_result","confidence":"medium","citations":4,"elapsed_ms":4721}
```

So for this run: TTFT **87–155 ms**, throughput **132–187 tokens/sec**, on the **GPU** (Metal), full debate **4.7 s** including a cold model load.

## How to regenerate

Auditing is **on by default** when the backend runs. The log is truncated at the start of each server session.

```bash
npm run start                                   # writes docs/audit-log.jsonl
curl -X POST http://localhost:3001/api/seed     # (or `make seed`)
curl -X POST http://localhost:3001/api/council \
  -H "Content-Type: application/json" \
  -d '{"query":"Who authorized the Entity X payment and was it legitimate?"}'
cat docs/audit-log.jsonl
```

- Disable with `QUORUM_AUDIT=0`.
- Custom path with `QUORUM_AUDIT_LOG=path/to/log.jsonl`.
