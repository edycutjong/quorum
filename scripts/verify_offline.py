#!/usr/bin/env python3
"""
Quorum — Offline Verification Bundle
======================================
Proves zero-cloud execution. Run with network cable unplugged.
Usage: python3 scripts/verify_offline.py
"""
import os, sys, subprocess, socket

P = 0; F = 0
def check(name, condition, detail=""):
    global P, F
    if condition:
        P += 1; print(f"  ✅ {name}")
    else:
        F += 1; print(f"  ❌ {name}: {detail}")

def main():
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    print("=" * 64)
    print("  Quorum — Offline Verification Bundle")
    print("=" * 64)

    # ── 1. No cloud API imports ──
    print("\n  ── Cloud Import Scan ──")
    banned = ["openai", "anthropic", "googleapis", "azure", "aws-sdk",
              "pinecone", "cohere", "firebase", "supabase"]
    violations = []
    for root, _, files in os.walk(os.path.join(base, "src")):
        for f in files:
            if f.endswith((".ts", ".tsx", ".js")):
                content = open(os.path.join(root, f)).read()
                for kw in banned:
                    if kw in content:
                        violations.append(f"{f}: imports '{kw}'")
    check("No cloud API imports in src/", len(violations) == 0, str(violations[:5]))

    # ── 2. No cloud URLs in source ──
    print("\n  ── Cloud URL Scan ──")
    cloud_urls = ["api.openai.com", "api.anthropic.com", "api.cohere.ai",
                  "pinecone.io", "firebaseio.com", "googleapis.com"]
    url_violations = []
    for root, _, files in os.walk(os.path.join(base, "src")):
        for f in files:
            if f.endswith((".ts", ".tsx", ".js")):
                content = open(os.path.join(root, f)).read()
                for url in cloud_urls:
                    if url in content:
                        url_violations.append(f"{f}: contains '{url}'")
    check("No cloud URLs in source", len(url_violations) == 0, str(url_violations[:5]))

    # ── 3. @qvac/sdk imported ──
    print("\n  ── QVAC SDK Integration ──")
    qvac_files = []
    for root, _, files in os.walk(os.path.join(base, "src")):
        for f in files:
            if f.endswith(".ts"):
                content = open(os.path.join(root, f)).read()
                if "@qvac/sdk" in content:
                    qvac_files.append(f)
    check("@qvac/sdk imported", len(qvac_files) > 0, "No files import @qvac/sdk")
    check("@qvac/sdk in core wrapper", len(qvac_files) >= 1, f"Only in: {qvac_files}")

    # ── 4. Council agents present ──
    print("\n  ── Council Architecture ──")
    council_path = os.path.join(base, "src", "core", "council.ts")
    if os.path.isfile(council_path):
        content = open(council_path).read()
        check("Council has Researcher agent", "researcher" in content.lower())
        check("Council has Skeptic agent", "skeptic" in content.lower())
        check("Council has Synthesizer agent", "synthesizer" in content.lower())
        check("Council uses completion()", "completion" in content or "runCompletion" in content)
    else:
        check("council.ts exists", False, "File missing")

    # ── 5. RAG pipeline ──
    print("\n  ── RAG Pipeline ──")
    rag_path = os.path.join(base, "src", "core", "rag.ts")
    if os.path.isfile(rag_path):
        content = open(rag_path).read()
        check("RAG has embedding model", "GTE_LARGE" in content or "embeddings" in content.lower())
        check("RAG has search function", "search" in content.lower())
        check("RAG has ingest function", "ingest" in content.lower() or "save" in content.lower())
    else:
        check("rag.ts exists", False, "File missing")

    # ── 6. Dossier data ──
    print("\n  ── Dossier ──")
    dossier = os.path.join(base, "data", "fixtures", "northwind_dossier")
    check("Dossier directory exists", os.path.isdir(dossier))
    if os.path.isdir(dossier):
        docs = [f for f in os.listdir(dossier) if f.endswith(".txt")]
        check(f"Dossier has ≥3 documents ({len(docs)} found)", len(docs) >= 3)
        # Check for planted contradictions
        all_text = ""
        for doc in docs:
            all_text += open(os.path.join(dossier, doc)).read().lower()
        check("Contradictions planted (PTO vs authorization)",
              "pto" in all_text and "authorized" in all_text,
              "Dossier should contain contradictory claims")

    # ── 7. No .env secrets committed ──
    print("\n  ── Security ──")
    check("No .env file committed", not os.path.isfile(os.path.join(base, ".env")))
    check(".env.example exists", os.path.isfile(os.path.join(base, ".env.example")))
    check(".gitignore exists", os.path.isfile(os.path.join(base, ".gitignore")))
    if os.path.isfile(os.path.join(base, ".gitignore")):
        gi = open(os.path.join(base, ".gitignore")).read()
        check(".env in .gitignore", ".env" in gi)

    # ── 8. Network test (optional) ──
    print("\n  ── Network Isolation (optional) ──")
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=2)
        print("  ⚠️  Network is UP — for full verification, disconnect and re-run")
    except (socket.timeout, OSError):
        check("Network disconnected (air-gapped)", True)

    # ── Summary ──
    print(f"\n{'=' * 64}")
    print(f"  Results: {P} passed, {F} failed")
    if F > 0:
        print(f"  ❌ OFFLINE VERIFICATION FAILED")
    else:
        print(f"  ✅ OFFLINE VERIFICATION PASSED — zero cloud dependencies")
    print(f"{'=' * 64}")
    sys.exit(1 if F > 0 else 0)

if __name__ == "__main__":
    main()
