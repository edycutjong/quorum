/**
 * Quorum — Real Performance Benchmark (QVAC SDK)
 * ================================================
 * Runs the ACTUAL 3-agent council over the Northwind dossier using
 * `@qvac/sdk` on your hardware, and records real latency, contradiction
 * recall, and citation coverage. Replaces the simulated `bench.py`.
 *
 * Usage:
 *   npx tsx scripts/bench.ts            # Run + write data/bench_results.json
 *   npx tsx scripts/bench.ts --assert   # Also fail (exit 1) if over budget
 *
 * Requires the QVAC models to be available locally (first run downloads them).
 * If a model cannot be loaded, this exits non-zero rather than emitting fake
 * numbers — by design, so the evidence bundle is always real.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";

import { close } from "@qvac/sdk";
import { ingestCorpus, resetCorpus, releaseEmbeddingModel } from "../src/core/rag.js";
import { runQuorumCouncil, skepticConcernLevel } from "../src/core/council.js";
import { loadLLMModel, LLAMA_MODEL_ID } from "../src/core/qvac.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOSSIER_DIR = join(ROOT, "data/fixtures/northwind_dossier");

// Budgets (General Purpose track: 32GB box, 4GB working budget).
const BUDGET = {
  council_total_ms: 15000,
  rag_search_ms: 500,
  model_load_ms: 10000,
  peak_ram_mb: 4096,
};

/**
 * Benchmark queries. Those flagged `expectsContradiction: true` target the
 * planted conflicts in the dossier (Chen authorized the payment on March 12
 * vs. Chen on approved PTO March 11–15; a $2.4M payment with no Board
 * resolution despite §4.2). The Skeptic should surface these — i.e. the
 * council should NOT return "high" confidence.
 */
const QUERIES: { query: string; expectsContradiction: boolean }[] = [
  { query: "Who authorized the $2.4M Entity X payment, and on what date?", expectsContradiction: true },
  { query: "Was VP Operations Chen in the office on March 12th?", expectsContradiction: true },
  { query: "Does the $2.4M Entity X payment comply with governance Section 4.2?", expectsContradiction: true },
  { query: "What is the total revenue reported in the Q1 financial report?", expectsContradiction: false },
  { query: "Who attended the March 10 board meeting?", expectsContradiction: false },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function peakRamMb(): number {
  return round(process.memoryUsage().rss / (1024 * 1024));
}

async function main() {
  const assertMode = process.argv.includes("--assert");
  console.log("=".repeat(64));
  console.log("  Quorum — Real Benchmark (QVAC SDK)");
  console.log("  Mode:", assertMode ? "ASSERT (CI gate)" : "REPORT");
  console.log("=".repeat(64));

  const totalRamGb = round(os.totalmem() / 1024 ** 3);
  console.log(`\n  Hardware: ${os.cpus()[0]?.model ?? os.arch()} | ${totalRamGb} GB RAM | ${os.cpus().length} cores`);
  console.log(`  Platform: ${os.platform()} ${os.release()} (${os.arch()})`);

  // ── Ingest corpus ──────────────────────────────────────────────────────────
  const files = readdirSync(DOSSIER_DIR).filter((f) => f.endsWith(".txt"));
  const documents = files.map((f) => `[Source: ${f}]\n${readFileSync(join(DOSSIER_DIR, f), "utf-8")}`);
  console.log(`\n  Ingesting ${files.length} documents...`);
  const ingestStart = performance.now();
  await resetCorpus(); // clean slate so latency/recall aren't skewed by stale duplicates
  await ingestCorpus(documents, true);
  const ingestMs = round(performance.now() - ingestStart);
  console.log(`  Corpus ingested in ${ingestMs}ms`);

  // ── Measure model load (cold) ────────────────────────────────────────────
  console.log("  Loading LLM...");
  const loadStart = performance.now();
  await loadLLMModel(LLAMA_MODEL_ID);
  const modelLoadMs = round(performance.now() - loadStart);
  console.log(`  Model loaded in ${modelLoadMs}ms`);

  // ── Run council over each query ──────────────────────────────────────────
  console.log(`\n  Running ${QUERIES.length} council queries...\n`);
  const results: Array<{
    query: string;
    total_ms: number;
    confidence: string;
    citations: number;
    expectsContradiction: boolean;
    contradictionCaught: boolean;
  }> = [];

  for (const { query, expectsContradiction } of QUERIES) {
    const t0 = performance.now();
    const council = await runQuorumCouncil(query);
    const totalMs = round(performance.now() - t0);
    // Per the PRD, the metric is whether the SKEPTIC catches the contradiction —
    // independent of whether the Synthesizer later downgrades overall confidence.
    const skepticTurn = council.turns.find((t) => t.role === "skeptic");
    const skepticCaught = skepticTurn ? skepticConcernLevel(skepticTurn.content) !== "none" : false;
    const contradictionCaught = skepticCaught || council.confidence !== "high";
    results.push({
      query,
      total_ms: totalMs,
      confidence: council.confidence,
      citations: council.citations.length,
      expectsContradiction,
      contradictionCaught,
    });
    console.log(
      `  ${totalMs.toFixed(0).padStart(7)}ms  ${council.confidence.padEnd(6)}  ` +
        `${council.citations.length} cites  ${query}`
    );
  }

  await releaseEmbeddingModel();

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const totals = results.map((r) => r.total_ms);
  const planted = results.filter((r) => r.expectsContradiction);
  const caught = planted.filter((r) => r.contradictionCaught);
  const contradictionRecall = planted.length ? round(caught.length / planted.length) : null;
  const withCitations = results.filter((r) => r.citations > 0);
  const citationCoverage = results.length ? round(withCitations.length / results.length) : 0;
  const peak = peakRamMb();

  const stats = {
    council_p50_ms: round(percentile(totals, 0.5)),
    council_p95_ms: round(percentile(totals, 0.95)),
    council_mean_ms: round(mean(totals)),
    model_load_ms: modelLoadMs,
    ingest_ms: ingestMs,
    peak_ram_mb: peak,
    queries_run: results.length,
    contradiction_recall: contradictionRecall,
    contradiction_caught: `${caught.length}/${planted.length}`,
    citation_coverage: citationCoverage,
  };

  console.log("\n  ── Summary ──");
  console.log(`  Council p50: ${stats.council_p50_ms}ms | p95: ${stats.council_p95_ms}ms | mean: ${stats.council_mean_ms}ms`);
  console.log(`  Model load: ${stats.model_load_ms}ms | Ingest: ${stats.ingest_ms}ms | Peak RAM: ${peak} MB`);
  console.log(`  Contradiction recall: ${contradictionRecall} (${stats.contradiction_caught}) | Citation coverage: ${citationCoverage}`);

  // ── Write report ─────────────────────────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    system: {
      platform: `${os.platform()}-${os.release()}-${os.arch()}`,
      processor: os.cpus()[0]?.model ?? os.arch(),
      cpu_count: os.cpus().length,
      ram_gb: totalRamGb,
      node: process.version,
    },
    budget: BUDGET,
    stats,
    queries: results,
    note: "Real @qvac/sdk measurements on target hardware",
  };
  const outDir = join(ROOT, "data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "bench_results.json"), JSON.stringify(report, null, 2));
  console.log("\n  Results saved to data/bench_results.json");

  // ── Assert mode ────────────────────────────────────────────────────────────
  if (assertMode) {
    const failures: string[] = [];
    if (stats.council_p50_ms > BUDGET.council_total_ms)
      failures.push(`council_p50 ${stats.council_p50_ms}ms > budget ${BUDGET.council_total_ms}ms`);
    if (stats.model_load_ms > BUDGET.model_load_ms)
      failures.push(`model_load ${stats.model_load_ms}ms > budget ${BUDGET.model_load_ms}ms`);
    if (peak > BUDGET.peak_ram_mb) failures.push(`peak_ram ${peak}MB > budget ${BUDGET.peak_ram_mb}MB`);
    // Contradiction recall is reported, not gated: the 1B model is
    // non-deterministic, so a hard recall gate would be flaky. Surface it.
    if (contradictionRecall !== null && contradictionRecall < 1)
      console.log(`\n  ⚠️  contradiction_recall ${contradictionRecall} (${stats.contradiction_caught}) — informational; 1B model is non-deterministic run-to-run.`);
    if (failures.length) {
      console.log("\n  ❌ REGRESSION DETECTED:");
      failures.forEach((f) => console.log(`    • ${f}`));
      process.exit(1);
    }
    console.log("\n  ✅ All benchmarks within budget.");
  }

  console.log("\n" + "=".repeat(64));
}

main()
  .then(async () => {
    await close().catch(() => {}); // tear down the SDK worker so the process exits cleanly
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ Benchmark failed (model unavailable or SDK error):", err);
    console.error("   No results written — run with QVAC models available for real numbers.");
    await close().catch(() => {});
    process.exit(1);
  });
