/**
 * Seed Script — Ingest Northwind dossier into QVAC RAG vector store
 *
 * Usage: npx tsx scripts/seed.ts
 *
 * Reads all .txt files from data/fixtures/northwind_dossier/ and
 * ingests them into the local RAG corpus for the council to query.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { close } from "@qvac/sdk";
import { ingestCorpus, resetCorpus, releaseEmbeddingModel } from "../src/core/rag.js";

const DOSSIER_DIR = join(process.cwd(), "data/fixtures/northwind_dossier");

async function main() {
  console.log("🏛️  Quorum — Corpus Seeder");
  console.log("─".repeat(50));

  const files = readdirSync(DOSSIER_DIR).filter((f) => f.endsWith(".txt"));
  if (files.length === 0) {
    console.error("❌ No .txt files found in", DOSSIER_DIR);
    process.exit(1);
  }

  console.log(`📂 Found ${files.length} documents in ${DOSSIER_DIR}:`);
  files.forEach((f) => console.log(`   • ${f}`));
  console.log();

  const documents = files.map((f) => {
    const content = readFileSync(join(DOSSIER_DIR, f), "utf-8");
    console.log(`📄 ${f} — ${content.length} chars`);
    return `[Source: ${f}]\n${content}`;
  });

  console.log(`\n⏳ Ingesting ${documents.length} documents into RAG corpus...`);
  const start = Date.now();

  await resetCorpus(); // idempotent re-seed: clear any prior corpus first
  await ingestCorpus(documents, true);

  const elapsed = Date.now() - start;
  console.log(`✅ Corpus ingestion complete in ${elapsed}ms`);

  // Release embedding model to free memory
  await releaseEmbeddingModel();
  console.log("🧹 Embedding model released");
  console.log("\n🏛️  Ready for council debates!");
}

main()
  .then(async () => {
    await close().catch(() => {}); // shut down the SDK worker so the process exits
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Seed failed:", err);
    await close().catch(() => {});
    process.exit(1);
  });
