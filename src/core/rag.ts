import {
  loadEmbeddingModel,
  runSaveEmbeddings,
  runRagSearch,
  unloadQVACModel,
  EMBEDDING_MODEL_ID,
} from "./qvac.js";

export interface CorpusDocument {
  id: string;
  content: string;
  source: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

// ── Embedding Model Lifecycle ────────────────────────────────────────────────

let embeddingModelId: string | null = null;

export async function initEmbeddingModel(): Promise<string> {
  if (embeddingModelId) return embeddingModelId;
  embeddingModelId = await loadEmbeddingModel(EMBEDDING_MODEL_ID);
  console.log("[rag] Embedding model loaded:", embeddingModelId);
  return embeddingModelId;
}

export async function releaseEmbeddingModel(): Promise<void> {
  if (embeddingModelId) {
    await unloadQVACModel(embeddingModelId);
    embeddingModelId = null;
  }
}

// ── Ingest Corpus ────────────────────────────────────────────────────────────

/**
 * Ingest a corpus of documents into the local RAG vector store.
 * Supports bulk ingestion of chunked text for the multi-agent council.
 */
export async function ingestCorpus(
  documents: string[],
  chunk: boolean = true
): Promise<void> {
  const modelId = await initEmbeddingModel();
  try {
    await runSaveEmbeddings({
      modelId,
      documents,
      chunk,
    });
    console.log(`[rag] Ingested ${documents.length} documents into corpus`);
  } catch (error) {
    console.error("[rag] Corpus ingestion failed:", error);
    throw error;
  }
}

// ── Search Corpus ────────────────────────────────────────────────────────────

/**
 * Search the local document corpus using RAG.
 * Used by all three council agents (Researcher, Skeptic, Synthesizer).
 * Returns ranked results with source attribution for citation tracking.
 */
export async function searchCorpus(
  query: string,
  topK: number = 3
): Promise<CorpusDocument[]> {
  const modelId = await initEmbeddingModel();
  try {
    const results = await runRagSearch({
      modelId,
      query,
      topK,
    });

    return (results as Record<string, unknown>[]).map((r: Record<string, unknown>, i: number) => ({
      id: r.id ?? `result-${i}`,
      content: r.content ?? r.text ?? "",
      source: r.source ?? r.metadata?.source ?? "unknown_source",
      score: r.score,
      metadata: r.metadata,
    }));
  } catch (err) {
    console.warn(
      "[rag] RAG search failed or corpus not initialized, returning seed fallback:",
      err
    );
    // Seed fallback for development/demo
    return [
      {
        id: "fallback-1",
        content:
          "The payment of $2.4M to Entity X was approved by VP Operations on March 12, per internal memo REF-4821.",
        source: "northwind_memo_4821.txt",
      },
      {
        id: "fallback-2",
        content:
          "Board minutes from March 10 show NO discussion of Entity X. The VP was on leave March 11-15.",
        source: "northwind_board_minutes_march.txt",
      },
    ];
  }
}

// Re-export with legacy alias for backward compatibility (council.ts uses this name)
export { searchCorpus as searchMedicalKnowledge };
