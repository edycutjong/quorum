// ── Structured Audit Log ─────────────────────────────────────────────────────
// Captures model lifecycle (load/unload) and per-inference performance
// (prompt size, tokens, TTFT, tokens/sec) for a demo run.
//
// Browser-safe: a no-op until a writer is registered. Node entrypoints
// (server.ts, scripts) register a file writer; the React app leaves it unset.

export interface AuditRecord {
  event:
    | "model_load"
    | "model_unload"
    | "inference"
    | "council_query"
    | "council_result";
  [key: string]: unknown;
}

type Writer = (rec: AuditRecord & { ts: string }) => void;

let writer: Writer | null = null;

/** Register (or clear) the sink that receives audit records. */
export function setAuditWriter(w: Writer | null): void {
  writer = w;
}

/** Emit one audit record (timestamped). Never throws — logging must not break inference. */
export function audit(rec: AuditRecord): void {
  if (!writer) return;
  try {
    writer({ ts: new Date().toISOString(), ...rec });
  } catch {
    /* swallow — auditing is best-effort */
  }
}
