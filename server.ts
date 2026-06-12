import express from "express";
import cors from "cors";
import { runQuorumCouncil } from "./src/core/council.js";
import { ingestCorpus, resetCorpus } from "./src/core/rag.js";
import { audit, setAuditWriter } from "./src/core/audit.js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Structured audit log (model loads/unloads + inference perf) ───────────────
// Enabled by default; disable with QUORUM_AUDIT=0. Truncated per server session.

if (process.env.QUORUM_AUDIT !== "0") {
  // Use in-memory array instead to prevent read-only filesystem crash on cloud deployments.
  const memoryAuditLog: any[] = [];
  setAuditWriter((rec) => memoryAuditLog.push(rec));
  console.log(`[audit] structured log → in-memory array`);
}

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json());

// ── Health Check ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", runtime: "qvac", timestamp: new Date().toISOString() });
});

// ── Council Debate ──────────────────────────────────────────────────────────
app.post("/api/council", async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Missing or invalid 'query' field" });
    return;
  }

  console.log(`[council] Query: "${query}"`);
  const start = Date.now();
  audit({ event: "council_query", endpoint: "/api/council", query });

  try {
    const result = await runQuorumCouncil(query);
    const elapsed = Date.now() - start;
    console.log(`[council] Completed in ${elapsed}ms — confidence: ${result.confidence}`);
    audit({ event: "council_result", confidence: result.confidence, citations: result.citations.length, elapsed_ms: elapsed });

    res.json({
      ...result,
      elapsed_ms: elapsed,
      // Map council result to frontend format
      turns: result.turns.map((t) => ({
        agent: t.agent,
        content: t.content,
        citations: t.citations.map((c, i) => ({
          id: `${t.agent}-${i}`,
          content: c.content,
          source: c.source,
        })),
      })),
      finalAnswer: result.verdict,
      contradictions: detectContradictions(result),
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error("[council] Error:", errMessage);
    const isOverflow = errMessage.includes("CONTEXT_OVERFLOW") || errMessage.includes("context overflow");
    if (isOverflow) {
      res.status(422).json({
        error: "Query too complex for the model's context window. Try a shorter, more specific question.",
        code: "CONTEXT_OVERFLOW",
      });
    } else {
      res.status(500).json({ error: errMessage });
    }
  }
});

// ── Council Debate (SSE Streaming) ──────────────────────────────────────────
// Streams each agent turn as a Server-Sent Event as it completes.
// Events: "turn" (per agent), "result" (final), "error"
app.post("/api/council/stream", async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Missing or invalid 'query' field" });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  console.log(`[council/stream] Query: "${query}"`);
  const start = Date.now();
  audit({ event: "council_query", endpoint: "/api/council/stream", query });

  try {
    const result = await runQuorumCouncil(query, (turn) => {
      // Stream each turn to the client as it completes
      sendEvent("turn", {
        agent: turn.agent,
        content: turn.content,
        citations: turn.citations.map((c, i) => ({
          id: `${turn.agent}-${i}`,
          content: c.content,
          source: c.source,
        })),
      });
    });

    const elapsed = Date.now() - start;
    console.log(`[council/stream] Completed in ${elapsed}ms — confidence: ${result.confidence}`);
    audit({ event: "council_result", confidence: result.confidence, citations: result.citations.length, elapsed_ms: elapsed });

    // Send final result
    sendEvent("result", {
      confidence: result.confidence,
      finalAnswer: result.verdict,
      contradictions: detectContradictions(result),
      elapsed_ms: elapsed,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error("[council/stream] Error:", errMessage);
    sendEvent("error", { error: errMessage });
  } finally {
    res.end();
  }
});

// ── Seed Corpus ─────────────────────────────────────────────────────────────
app.post("/api/seed", async (_req, res) => {
  const dossierDir = join(process.cwd(), "data/fixtures/northwind_dossier");

  try {
    const files = readdirSync(dossierDir).filter((f) => f.endsWith(".txt"));
    const documents = files.map((f) => {
      const content = readFileSync(join(dossierDir, f), "utf-8");
      return `[Source: ${f}]\n${content}`;
    });

    console.log(`[seed] Resetting corpus, then ingesting ${documents.length} documents from ${dossierDir}`);
    await resetCorpus(); // idempotent: avoid accumulating duplicate chunks on re-seed
    await ingestCorpus(documents, true);
    console.log(`[seed] Corpus ingestion complete`);

    res.json({
      success: true,
      documents: files.length,
      files,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error("[seed] Error:", errMessage);
    res.status(500).json({ error: errMessage });
  }
});

// ── Contradiction Detection ─────────────────────────────────────────────────
function detectContradictions(result: {
  turns: { agent: string; content: string }[];
}): string[] {
  const contradictions: string[] = [];
  const skepticTurn = result.turns.find((t) => t.agent === "skeptic");
  if (!skepticTurn) return contradictions;

  const lower = skepticTurn.content.toLowerCase();
  if (lower.includes("contradict")) contradictions.push("Skeptic found contradictions in the evidence");
  if (lower.includes("wrong")) contradictions.push("Skeptic challenged claims as incorrect");
  if (lower.includes("missed")) contradictions.push("Skeptic identified missed information");
  if (lower.includes("no access") || lower.includes("no badge"))
    contradictions.push("Physical/digital access records conflict with authorization claims");
  if (lower.includes("pto") || lower.includes("leave"))
    contradictions.push("Personnel availability conflicts with documented actions");

  return contradictions;
}

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏛️  Quorum Backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/council  — Run council debate`);
  console.log(`   POST /api/seed     — Ingest Northwind dossier`);
  console.log(`   GET  /api/health   — Health check\n`);
});
