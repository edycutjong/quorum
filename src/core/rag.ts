import {
  loadEmbeddingModel,
  runSaveEmbeddings,
  runRagSearch,
  clearCorpusWorkspace,
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

// ── Chunking ─────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_CHARS = 600;
const SOURCE_PREFIX_RE = /^\[Source:\s*([^\]]+)\]\s*/;

/**
 * Split text into chunks of at most `maxChars`, preferring paragraph
 * boundaries and hard-splitting any paragraph that is itself too large.
 */
export function chunkText(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of trimmed.split(/\n\s*\n/)) {
    if (para.length > maxChars) {
      // Paragraph alone exceeds the budget — emit what we have, then hard-split.
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        const slice = para.slice(i, i + maxChars).trim();
        if (slice) chunks.push(slice);
      }
      continue;
    }
    if (current.length + para.length + 2 > maxChars) flush();
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

/**
 * Chunk a single document while preserving its `[Source: filename]` prefix on
 * EVERY chunk — so each chunk remains independently attributable after the SDK
 * indexes it. (The SDK's own chunking keeps the prefix only on the first chunk,
 * which is why we chunk here and ingest unchunked.)
 */
export function prepareDocumentChunks(doc: string, maxChars: number = DEFAULT_CHUNK_CHARS): string[] {
  const match = doc.match(SOURCE_PREFIX_RE);
  const source = match?.[1]?.trim();
  const body = match ? doc.slice(match[0].length) : doc;
  const pieces = chunkText(body, maxChars);
  return source ? pieces.map((p) => `[Source: ${source}]\n${p}`) : pieces;
}

// ── Reset Corpus ─────────────────────────────────────────────────────────────

/**
 * Clear the persisted corpus so a subsequent ingest starts from empty.
 * The QVAC RAG store persists to disk (~/.qvac/rag-hyperdb) and accumulates
 * across runs, so seed paths call this first to stay idempotent.
 */
export async function resetCorpus(): Promise<void> {
  await clearCorpusWorkspace();
  console.log("[rag] Corpus workspace reset (clean slate for ingest)");
}

// ── Ingest Corpus ────────────────────────────────────────────────────────────

/**
 * Ingest a corpus of documents into the local RAG vector store.
 * When `chunk` is true we split each document ourselves and re-attach its
 * source to every chunk, then ingest unchunked so citation attribution
 * survives chunking. When false, documents are ingested verbatim.
 */
export async function ingestCorpus(
  documents: string[],
  chunk: boolean = true
): Promise<void> {
  const modelId = await initEmbeddingModel();
  try {
    const prepared = chunk
      ? documents.flatMap((d) => prepareDocumentChunks(d))
      : documents;
    await runSaveEmbeddings({
      modelId,
      documents: prepared,
      chunk: false,
    });
    console.log(`[rag] Ingested ${documents.length} documents (${prepared.length} chunks) into corpus`);
  } catch (error) {
    console.error("[rag] Corpus ingestion failed:", error);
    throw error;
  }
}

interface RawRagResult {
  id?: string;
  content?: string;
  text?: string;
  source?: string;
  score?: number;
  metadata?: Record<string, unknown>;
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

    return (results as unknown as RawRagResult[]).map((r, i: number) => {
      const rawContent = r.content ?? r.text ?? "";
      // Extract source from [Source: filename.txt] prefix embedded during ingestion
      const sourceMatch = rawContent.match(/\[Source:\s*([^\]]+)\]/);
      const source = r.source ?? (r.metadata?.source as string | undefined) ?? sourceMatch?.[1]?.trim() ?? "corpus_document";
      // Strip the [Source: ...] prefix from content for cleaner display
      const content = sourceMatch ? rawContent.replace(/\[Source:\s*[^\]]+\]\s*/, "").trim() : rawContent;

      return {
        id: r.id ?? `result-${i}`,
        content,
        source,
        score: r.score,
        metadata: r.metadata,
      };
    });
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
export { searchCorpus as searchCorporateDossier };
