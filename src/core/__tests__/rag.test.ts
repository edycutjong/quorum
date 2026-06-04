import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @qvac/sdk ───────────────────────────────────────────────────────────
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockRagIngest = vi.fn();
const mockRagSearch = vi.fn();
const mockRagCloseWorkspace = vi.fn();

vi.mock("@qvac/sdk", () => ({
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  unloadModel: (...args: unknown[]) => mockUnloadModel(...args),
  completion: vi.fn(),
  ragIngest: (...args: unknown[]) => mockRagIngest(...args),
  ragSearch: (...args: unknown[]) => mockRagSearch(...args),
  ragCloseWorkspace: (...args: unknown[]) => mockRagCloseWorkspace(...args),
  textToSpeech: vi.fn(),
  startQVACProvider: vi.fn(),
  stopQVACProvider: vi.fn(),
  LLAMA_3_2_1B_INST_Q4_0: "llama-model",
  GTE_LARGE_FP16: "gte-model",
  TTS_EN_SUPERTONIC_Q8_0: { src: "tts-src" },
}));

import {
  initEmbeddingModel,
  releaseEmbeddingModel,
  ingestCorpus,
  searchCorpus,
  searchMedicalKnowledge,
  resetCorpus,
  chunkText,
  prepareDocumentChunks,
} from "../rag";

describe("rag.ts — corpus pipeline", () => {
  beforeEach(async () => {
    // Release any model left loaded by a prior test BEFORE clearing mocks,
    // so the cleanup unload isn't counted against this test's assertions.
    await releaseEmbeddingModel();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("embedding model lifecycle", () => {
    it("loads the embedding model on first init", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      const id = await initEmbeddingModel();
      expect(id).toBe("embed-id");
      expect(mockLoadModel).toHaveBeenCalledTimes(1);
    });

    it("loads the embedding model with the embeddings model type", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      await initEmbeddingModel();
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelType: "embeddings" })
      );
    });

    it("caches the model id and does not reload on second init", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      const a = await initEmbeddingModel();
      const b = await initEmbeddingModel();
      expect(a).toBe(b);
      expect(mockLoadModel).toHaveBeenCalledTimes(1);
    });

    it("unloads and clears the cached model on release", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      await initEmbeddingModel();
      await releaseEmbeddingModel();
      expect(mockUnloadModel).toHaveBeenCalledWith({ modelId: "embed-id" });
    });

    it("reloads after a release (state is reset)", async () => {
      mockLoadModel.mockResolvedValueOnce("embed-id-1").mockResolvedValueOnce("embed-id-2");
      await initEmbeddingModel();
      await releaseEmbeddingModel();
      const id2 = await initEmbeddingModel();
      expect(id2).toBe("embed-id-2");
      expect(mockLoadModel).toHaveBeenCalledTimes(2);
    });

    it("release is a no-op when no model is loaded", async () => {
      await releaseEmbeddingModel();
      expect(mockUnloadModel).not.toHaveBeenCalled();
    });
  });

  describe("resetCorpus", () => {
    it("clears the default corpus workspace (idempotent re-seed)", async () => {
      mockRagCloseWorkspace.mockResolvedValue(undefined);
      await resetCorpus();
      expect(mockRagCloseWorkspace).toHaveBeenCalledWith({ deleteOnClose: true });
    });

    it("does not throw when there is no existing workspace", async () => {
      mockRagCloseWorkspace.mockRejectedValue(new Error("missing"));
      await expect(resetCorpus()).resolves.toBeUndefined();
    });
  });

  describe("ingestCorpus", () => {
    it("initializes the embedding model before ingesting", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["doc"]);
      expect(mockLoadModel).toHaveBeenCalled();
    });

    it("ingests unchunked at the SDK level (we chunk ourselves)", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["doc"]);
      // We pre-chunk + re-prefix, so the SDK must not chunk again.
      expect(mockRagIngest).toHaveBeenCalledWith(
        expect.objectContaining({ chunk: false })
      );
    });

    it("splits a long document into multiple source-tagged chunks", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      const longBody = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ` + "x".repeat(300)).join("\n\n");
      await ingestCorpus([`[Source: big.txt]\n${longBody}`]);
      const sent = mockRagIngest.mock.calls[0][0].documents as string[];
      expect(sent.length).toBeGreaterThan(1);
      // EVERY chunk carries the source — the bug we are fixing.
      expect(sent.every((c) => c.startsWith("[Source: big.txt]"))).toBe(true);
    });

    it("passes documents through verbatim when chunk=false", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["[Source: a.txt]\nverbatim body"], false);
      expect(mockRagIngest).toHaveBeenCalledWith(
        expect.objectContaining({ chunk: false, documents: ["[Source: a.txt]\nverbatim body"] })
      );
    });

    it("passes all documents through to the SDK", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["a", "b", "c"]);
      expect(mockRagIngest).toHaveBeenCalledWith(
        expect.objectContaining({ documents: ["a", "b", "c"] })
      );
    });

    it("resolves without throwing on success", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await expect(ingestCorpus(["doc"])).resolves.toBeUndefined();
    });

    it("propagates ingestion failures", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockRejectedValue(new Error("Ingest failed"));
      await expect(ingestCorpus(["doc"])).rejects.toThrow("Ingest failed");
    });

    it("handles an empty document list", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await expect(ingestCorpus([])).resolves.toBeUndefined();
      expect(mockRagIngest).toHaveBeenCalledWith(
        expect.objectContaining({ documents: [] })
      );
    });
  });

  describe("searchCorpus — citation mapping", () => {
    beforeEach(() => {
      mockLoadModel.mockResolvedValue("embed-id");
    });

    it("maps content from the `content` field", async () => {
      mockRagSearch.mockResolvedValue([{ id: "d1", content: "hello", source: "a.txt", score: 0.9 }]);
      const res = await searchCorpus("q");
      expect(res[0].content).toBe("hello");
    });

    it("falls back to the `text` field when `content` is absent", async () => {
      mockRagSearch.mockResolvedValue([{ text: "from-text" }]);
      const res = await searchCorpus("q");
      expect(res[0].content).toBe("from-text");
    });

    it("defaults content to an empty string when neither field exists", async () => {
      mockRagSearch.mockResolvedValue([{}]);
      const res = await searchCorpus("q");
      expect(res[0].content).toBe("");
    });

    it("prefers an explicit `source` field", async () => {
      mockRagSearch.mockResolvedValue([{ content: "x", source: "explicit.txt" }]);
      const res = await searchCorpus("q");
      expect(res[0].source).toBe("explicit.txt");
    });

    it("falls back to metadata.source when `source` is absent", async () => {
      mockRagSearch.mockResolvedValue([{ content: "x", metadata: { source: "meta.txt" } }]);
      const res = await searchCorpus("q");
      expect(res[0].source).toBe("meta.txt");
    });

    it("extracts source from an embedded [Source: ...] prefix", async () => {
      mockRagSearch.mockResolvedValue([{ content: "[Source: inline.txt] body text" }]);
      const res = await searchCorpus("q");
      expect(res[0].source).toBe("inline.txt");
    });

    it("strips the [Source: ...] prefix from displayed content", async () => {
      mockRagSearch.mockResolvedValue([{ content: "[Source: inline.txt] body text" }]);
      const res = await searchCorpus("q");
      expect(res[0].content).toBe("body text");
    });

    it("defaults source to corpus_document when nothing is available", async () => {
      mockRagSearch.mockResolvedValue([{ content: "no source here" }]);
      const res = await searchCorpus("q");
      expect(res[0].source).toBe("corpus_document");
    });

    it("uses the provided id when present", async () => {
      mockRagSearch.mockResolvedValue([{ id: "real-id", content: "x" }]);
      const res = await searchCorpus("q");
      expect(res[0].id).toBe("real-id");
    });

    it("generates a positional id when none is provided", async () => {
      mockRagSearch.mockResolvedValue([{ content: "a" }, { content: "b" }]);
      const res = await searchCorpus("q");
      expect(res[0].id).toBe("result-0");
      expect(res[1].id).toBe("result-1");
    });

    it("passes the score through unchanged", async () => {
      mockRagSearch.mockResolvedValue([{ content: "x", score: 0.42 }]);
      const res = await searchCorpus("q");
      expect(res[0].score).toBe(0.42);
    });

    it("passes metadata through unchanged", async () => {
      const metadata = { source: "m.txt", page: 7 };
      mockRagSearch.mockResolvedValue([{ content: "x", metadata }]);
      const res = await searchCorpus("q");
      expect(res[0].metadata).toEqual(metadata);
    });

    it("preserves result ordering", async () => {
      mockRagSearch.mockResolvedValue([
        { id: "1", content: "first" },
        { id: "2", content: "second" },
        { id: "3", content: "third" },
      ]);
      const res = await searchCorpus("q");
      expect(res.map((r) => r.content)).toEqual(["first", "second", "third"]);
    });

    it("returns an empty array when the corpus yields no results", async () => {
      mockRagSearch.mockResolvedValue([]);
      const res = await searchCorpus("q");
      expect(res).toEqual([]);
    });

    it("forwards the default topK of 3 to the SDK", async () => {
      mockRagSearch.mockResolvedValue([]);
      await searchCorpus("q");
      expect(mockRagSearch).toHaveBeenCalledWith(expect.objectContaining({ topK: 3 }));
    });

    it("forwards a custom topK to the SDK", async () => {
      mockRagSearch.mockResolvedValue([]);
      await searchCorpus("q", 7);
      expect(mockRagSearch).toHaveBeenCalledWith(expect.objectContaining({ topK: 7 }));
    });

    it("forwards the query text to the SDK", async () => {
      mockRagSearch.mockResolvedValue([]);
      await searchCorpus("who approved the payment?");
      expect(mockRagSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "who approved the payment?" })
      );
    });
  });

  describe("searchCorpus — failure fallback", () => {
    beforeEach(() => {
      mockLoadModel.mockResolvedValue("embed-id");
    });

    it("returns seed fallback documents when search fails", async () => {
      mockRagSearch.mockRejectedValue(new Error("search down"));
      const res = await searchCorpus("q");
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe("fallback-1");
      expect(res[1].id).toBe("fallback-2");
    });

    it("fallback documents contain the planted contradiction", async () => {
      mockRagSearch.mockRejectedValue(new Error("search down"));
      const res = await searchCorpus("q");
      const joined = res.map((r) => r.content).join(" ").toLowerCase();
      expect(joined).toContain("march 12");
      expect(joined).toContain("leave");
    });

    it("fallback documents carry source attribution", async () => {
      mockRagSearch.mockRejectedValue(new Error("search down"));
      const res = await searchCorpus("q");
      expect(res[0].source).toContain("memo");
      expect(res[1].source).toContain("board_minutes");
    });
  });

  describe("searchMedicalKnowledge alias", () => {
    it("is the same function as searchCorpus (backward-compat alias)", () => {
      expect(searchMedicalKnowledge).toBe(searchCorpus);
    });
  });

  describe("chunkText", () => {
    it("returns an empty array for empty/whitespace input", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("   \n  ")).toEqual([]);
    });

    it("returns a single chunk when text fits within the budget", () => {
      expect(chunkText("short text", 100)).toEqual(["short text"]);
    });

    it("splits on paragraph boundaries when over the budget", () => {
      const text = "a".repeat(40) + "\n\n" + "b".repeat(40);
      const chunks = chunkText(text, 50);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBe("a".repeat(40));
      expect(chunks[1]).toBe("b".repeat(40));
    });

    it("hard-splits a single paragraph that exceeds the budget", () => {
      const chunks = chunkText("x".repeat(250), 100);
      expect(chunks).toHaveLength(3);
      expect(chunks.every((c) => c.length <= 100)).toBe(true);
    });

    it("never emits a chunk larger than maxChars", () => {
      const text = Array.from({ length: 5 }, () => "word ".repeat(60)).join("\n\n");
      const chunks = chunkText(text, 200);
      expect(chunks.every((c) => c.length <= 200)).toBe(true);
    });

    it("packs adjacent small paragraphs into one chunk", () => {
      const text = "p1\n\np2\n\n" + "x".repeat(60);
      const chunks = chunkText(text, 50);
      expect(chunks[0]).toBe("p1\n\np2");
    });

    it("drops a whitespace-only segment when hard-splitting", () => {
      const chunks = chunkText("a".repeat(50) + " ".repeat(50) + "b".repeat(10), 50);
      expect(chunks).toEqual(["a".repeat(50), "b".repeat(10)]);
    });
  });

  describe("prepareDocumentChunks", () => {
    it("re-attaches the source prefix to every chunk", () => {
      const body = "p1 " + "x".repeat(300) + "\n\n" + "p2 " + "y".repeat(300);
      const chunks = prepareDocumentChunks(`[Source: file.txt]\n${body}`, 300);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.startsWith("[Source: file.txt]\n"))).toBe(true);
    });

    it("leaves content unprefixed when there is no source", () => {
      const chunks = prepareDocumentChunks("just body text", 300);
      expect(chunks).toEqual(["just body text"]);
    });

    it("keeps a short sourced document as a single attributed chunk", () => {
      const chunks = prepareDocumentChunks("[Source: a.txt]\nhello world");
      expect(chunks).toEqual(["[Source: a.txt]\nhello world"]);
    });

    it("produces chunks that searchCorpus can attribute back to the source", async () => {
      // Round-trip: a later chunk (not the first) still resolves its source.
      const body = "p0 " + "x".repeat(300) + "\n\n" + "p1 " + "y".repeat(300);
      const chunks = prepareDocumentChunks(`[Source: hr_logs.txt]\n${body}`, 300);
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagSearch.mockResolvedValue([{ content: chunks[1] }]);
      const res = await searchCorpus("q");
      expect(res[0].source).toBe("hr_logs.txt");
    });
  });
});
