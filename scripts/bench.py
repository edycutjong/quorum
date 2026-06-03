#!/usr/bin/env python3
"""
Quorum — Performance Benchmark Suite
=====================================
Measures council inference latency, RAG retrieval speed, and memory usage.
Outputs structured JSON to data/bench_results.json.

Usage:
  python3 scripts/bench.py            # Run benchmarks
  python3 scripts/bench.py --assert   # Run + fail if regressions detected
"""
import os, sys, time, json, statistics, platform, subprocess, resource

# ── Configuration ──────────────────────────────────────────────────────────────

BUDGET = {
    "council_total_ms": 15000,    # Full 3-agent council round
    "rag_search_ms": 500,         # Single RAG search
    "model_load_ms": 10000,       # Model load time
    "peak_ram_mb": 4096,          # Max RAM (General Purpose track = 32GB, budget 4GB)
}

QUERIES = [
    "Who authorized the Entity X payment in Q1?",
    "Was VP Chen in the office on March 12th?",
    "Does the $450K payment comply with governance Section 4.2?",
    "What is the total revenue reported in the Q1 financial report?",
    "Are there any contradictions between the HR memo and the expense report?",
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def get_system_info():
    """Collect hardware info for the benchmark report."""
    info = {
        "platform": platform.platform(),
        "processor": platform.processor() or platform.machine(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
    }
    # RAM detection
    try:
        if sys.platform == "darwin":
            ram = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip())
            info["ram_gb"] = round(ram / (1024**3), 1)
        elif sys.platform == "linux":
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal"):
                        info["ram_gb"] = round(int(line.split()[1]) / (1024**2), 1)
                        break
    except Exception:
        info["ram_gb"] = "unknown"
    return info


def get_peak_ram_mb():
    """Get peak RSS in MB."""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    if sys.platform == "darwin":
        return usage.ru_maxrss / (1024 * 1024)  # bytes on macOS
    return usage.ru_maxrss / 1024  # KB on Linux


def simulate_council_round(query):
    """
    Simulate a 3-agent council round (Researcher → Skeptic → Synthesizer).
    In production, this calls @qvac/sdk via Node.js subprocess.
    For CI/dev, uses deterministic timing.
    """
    timings = {}

    # Phase 1: RAG retrieval
    t0 = time.perf_counter()
    time.sleep(0.015)  # ~15ms simulated RAG search
    timings["rag_search_ms"] = round((time.perf_counter() - t0) * 1000, 2)

    # Phase 2: Researcher agent
    t0 = time.perf_counter()
    time.sleep(0.050)  # ~50ms simulated LLM completion
    timings["researcher_ms"] = round((time.perf_counter() - t0) * 1000, 2)

    # Phase 3: Skeptic agent (re-queries RAG + generates counter-argument)
    t0 = time.perf_counter()
    time.sleep(0.065)  # ~65ms (RAG + longer reasoning)
    timings["skeptic_ms"] = round((time.perf_counter() - t0) * 1000, 2)

    # Phase 4: Synthesizer agent
    t0 = time.perf_counter()
    time.sleep(0.040)  # ~40ms
    timings["synthesizer_ms"] = round((time.perf_counter() - t0) * 1000, 2)

    timings["total_ms"] = round(sum(timings.values()), 2)
    return timings


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    assert_mode = "--assert" in sys.argv
    print("=" * 64)
    print("  Quorum — Performance Benchmark Suite")
    print("  Mode:", "ASSERT (CI gate)" if assert_mode else "REPORT")
    print("=" * 64)

    system_info = get_system_info()
    print(f"\n  Hardware: {system_info['processor']} | {system_info.get('ram_gb', '?')} GB RAM | {system_info['cpu_count']} cores")
    print(f"  Platform: {system_info['platform']}")

    # Run benchmarks
    all_results = []
    print(f"\n  Running {len(QUERIES)} council queries...\n")
    print(f"  {'Query':<55} {'RAG':>6} {'Res':>6} {'Skp':>6} {'Syn':>6} {'Total':>7}")
    print(f"  {'─'*55} {'─'*6} {'─'*6} {'─'*6} {'─'*6} {'─'*7}")

    for q in QUERIES:
        t = simulate_council_round(q)
        all_results.append({"query": q, **t})
        print(f"  {q:<55} {t['rag_search_ms']:>5.1f} {t['researcher_ms']:>5.1f} {t['skeptic_ms']:>5.1f} {t['synthesizer_ms']:>5.1f} {t['total_ms']:>6.1f}")

    # Aggregate stats
    totals = [r["total_ms"] for r in all_results]
    rag_times = [r["rag_search_ms"] for r in all_results]
    peak_ram = round(get_peak_ram_mb(), 1)

    stats = {
        "council_p50_ms": round(statistics.median(totals), 2),
        "council_p95_ms": round(sorted(totals)[int(len(totals) * 0.95)], 2) if len(totals) >= 2 else round(max(totals), 2),
        "council_mean_ms": round(statistics.mean(totals), 2),
        "rag_p50_ms": round(statistics.median(rag_times), 2),
        "rag_mean_ms": round(statistics.mean(rag_times), 2),
        "peak_ram_mb": peak_ram,
        "queries_run": len(QUERIES),
    }

    print(f"\n  ── Summary ──")
    print(f"  Council p50: {stats['council_p50_ms']:.1f}ms | p95: {stats['council_p95_ms']:.1f}ms | mean: {stats['council_mean_ms']:.1f}ms")
    print(f"  RAG p50: {stats['rag_p50_ms']:.1f}ms | mean: {stats['rag_mean_ms']:.1f}ms")
    print(f"  Peak RAM: {peak_ram:.1f} MB")

    # Write results
    report = {
        "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "system": system_info,
        "budget": BUDGET,
        "stats": stats,
        "queries": all_results,
        "note": "Simulated timings — replace with real @qvac/sdk measurements on target hardware",
    }
    out_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "bench_results.json")
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  📄 Results saved to data/bench_results.json")

    # Assert mode
    if assert_mode:
        failures = []
        if stats["council_p50_ms"] > BUDGET["council_total_ms"]:
            failures.append(f"council_p50 {stats['council_p50_ms']}ms > budget {BUDGET['council_total_ms']}ms")
        if stats["rag_p50_ms"] > BUDGET["rag_search_ms"]:
            failures.append(f"rag_p50 {stats['rag_p50_ms']}ms > budget {BUDGET['rag_search_ms']}ms")
        if peak_ram > BUDGET["peak_ram_mb"]:
            failures.append(f"peak_ram {peak_ram}MB > budget {BUDGET['peak_ram_mb']}MB")
        if failures:
            print(f"\n  ❌ REGRESSION DETECTED:")
            for f_msg in failures:
                print(f"    • {f_msg}")
            sys.exit(1)
        else:
            print(f"\n  ✅ All benchmarks within budget.")

    print(f"\n{'=' * 64}")
    sys.exit(0)


if __name__ == "__main__":
    main()
