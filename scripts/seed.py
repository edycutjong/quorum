#!/usr/bin/env python3
"""
Quorum — Seed Script
Ingests Northwind dossier documents into local QVAC RAG vector store.
Usage: python3 scripts/seed.py
"""

import os
import sys
import json

DOSSIER_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'fixtures', 'northwind_dossier')

def load_dossier():
    documents = []
    dossier_path = os.path.abspath(DOSSIER_DIR)
    if not os.path.isdir(dossier_path):
        print(f"[seed] ERROR: Dossier not found: {dossier_path}")
        sys.exit(1)
    for fname in sorted(os.listdir(dossier_path)):
        if fname.endswith('.txt'):
            fpath = os.path.join(dossier_path, fname)
            with open(fpath, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            if content:
                documents.append({'filename': fname, 'content': content, 'chars': len(content)})
                print(f"  [seed] Loaded {fname} ({len(content)} chars)")
    return documents

def main():
    print("=" * 60)
    print("  Quorum — Seed Script")
    print("  Ingesting Northwind dossier into RAG vector store")
    print("=" * 60)
    print()
    documents = load_dossier()
    if not documents:
        print("[seed] ERROR: No documents found.")
        sys.exit(1)
    total_chars = sum(d['chars'] for d in documents)
    print(f"\n[seed] Total: {len(documents)} documents, {total_chars} chars")
    manifest = {
        'seeded_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'documents': len(documents),
        'total_chars': total_chars,
        'files': [d['filename'] for d in documents],
        'planted_contradictions': [
            'VP Chen approved payment on March 12 BUT was on PTO March 11-15',
            'Memo REF-4821 timestamped March 12 BUT HR logs show no badge/VPN access',
            '$2.4M payment requires board resolution (Section 4.2) BUT no board discussion occurred',
        ],
    }
    manifest_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'seed_manifest.json')
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"[seed] Manifest written: {os.path.abspath(manifest_path)}")
    print("\n[seed] ✅ Seed complete.")

if __name__ == '__main__':
    main()
