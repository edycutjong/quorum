import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @qvac/sdk ───────────────────────────────────────────────────────────
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockRagIngest = vi.fn();
const mockRagSearch = vi.fn();

vi.mock("@qvac/sdk", () => ({
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  unloadModel: (...args: unknown[]) => mockUnloadModel(...args),
  completion: vi.fn(),
  ragIngest: (...args: unknown[]) => mockRagIngest(...args),
  ragSearch: (...args: unknown[]) => mockRagSearch(...args),
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

  describe("ingestCorpus", () => {
    it("initializes the embedding model before ingesting", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["doc"]);
      expect(mockLoadModel).toHaveBeenCalled();
    });

    it("chunks documents by default (chunk=true)", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["doc"]);
      expect(mockRagIngest).toHaveBeenCalledWith(
        expect.objectContaining({ chunk: true })
      );
    });

    it("honors chunk=false when explicitly disabled", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await ingestCorpus(["doc"], false);
      expect(mockRagIngest).toHaveBeenCalledWith(
        expect.objectContaining({ chunk: false })
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
});
