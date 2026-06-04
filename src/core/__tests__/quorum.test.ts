import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @qvac/sdk
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockCompletion = vi.fn();
const mockRagIngest = vi.fn();
const mockRagSearch = vi.fn();
const mockTextToSpeech = vi.fn();
const mockStartQVACProvider = vi.fn();
const mockStopQVACProvider = vi.fn();

vi.mock("@qvac/sdk", () => ({
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  unloadModel: (...args: unknown[]) => mockUnloadModel(...args),
  completion: (...args: unknown[]) => mockCompletion(...args),
  ragIngest: (...args: unknown[]) => mockRagIngest(...args),
  ragSearch: (...args: unknown[]) => mockRagSearch(...args),
  textToSpeech: (...args: unknown[]) => mockTextToSpeech(...args),
  startQVACProvider: (...args: unknown[]) => mockStartQVACProvider(...args),
  stopQVACProvider: (...args: unknown[]) => mockStopQVACProvider(...args),
  LLAMA_3_2_1B_INST_Q4_0: "llama-model",
  GTE_LARGE_FP16: "gte-model",
  TTS_EN_SUPERTONIC_Q8_0: { src: "tts-src" },
  WHISPER_EN_TINY_Q8_0: "whisper-model",
}));

// Import Quorum core modules and wrappers
import {
  initEmbeddingModel,
  releaseEmbeddingModel,
  ingestCorpus,
  searchCorpus,
} from "../rag";

import {
  runQuorumCouncil,
} from "../council";

import {
  loadLLMModel,
  loadEmbeddingModel,
  loadTTSModel,
  unloadQVACModel,
  runCompletion,
  runSaveEmbeddings,
  runRagSearch,
  runTextToSpeech,
  startP2PProvider,
  stopP2PProvider,
} from "../qvac";

describe("Quorum Core Module", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await releaseEmbeddingModel(); // reset static state
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("rag.ts corpus tests", () => {
    it("should manage Embedding Model loading lifecycle", async () => {
      mockLoadModel.mockResolvedValue("embed-lifecycle-id");
      
      // Test when null
      await releaseEmbeddingModel();
      
      const id1 = await initEmbeddingModel();
      expect(id1).toBe("embed-lifecycle-id");

      // Test caching
      const id2 = await initEmbeddingModel();
      expect(id2).toBe("embed-lifecycle-id");

      // Test release when non-null
      await releaseEmbeddingModel();
      expect(mockUnloadModel).toHaveBeenCalledWith({ modelId: "embed-lifecycle-id" });
    });

    it("should ingest corpus successfully", async () => {
      mockLoadModel.mockResolvedValue("embed-lifecycle-id");
      mockRagIngest.mockResolvedValue({ success: true });
      await expect(ingestCorpus(["document content"], false)).resolves.not.toThrow();
    });

    it("should handle corpus ingestion failures", async () => {
      mockLoadModel.mockResolvedValue("embed-lifecycle-id");
      mockRagIngest.mockRejectedValue(new Error("Ingest failed"));
      await expect(ingestCorpus(["document content"])).rejects.toThrow("Ingest failed");
    });

    it("should search corpus and map properties", async () => {
      mockLoadModel.mockResolvedValue("embed-lifecycle-id");
      mockRagSearch.mockResolvedValue([
        { id: "doc-1", content: "some text", source: "doc.txt", score: 0.8 },
        { id: "doc-2", content: "[Source: test.txt] some content with source match", score: 0.9 },
      ]);
      const res = await searchCorpus("query", 2);
      expect(res).toHaveLength(2);
      expect(res[0]).toEqual({
        id: "doc-1",
        content: "some text",
        source: "doc.txt",
        score: 0.8,
        metadata: undefined,
      });
      expect(res[1]).toEqual({
        id: "doc-2",
        content: "some content with source match",
        source: "test.txt",
        score: 0.9,
        metadata: undefined,
      });
    });

    it("should search corpus and map properties with fallbacks", async () => {
      mockLoadModel.mockResolvedValue("embed-lifecycle-id");
      mockRagSearch.mockResolvedValue([
        { text: "fallback text", metadata: { source: "meta.txt" } },
        {},
      ]);
      const res = await searchCorpus("query", 2);
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe("result-0");
      expect(res[0].content).toBe("fallback text");
      expect(res[0].source).toBe("meta.txt");

      expect(res[1].id).toBe("result-1");
      expect(res[1].content).toBe("");
      expect(res[1].source).toBe("corpus_document");
    });

    it("should return fallback data on RAG search failure", async () => {
      mockLoadModel.mockResolvedValue("embed-lifecycle-id");
      mockRagSearch.mockRejectedValue(new Error("Search failed"));
      const res = await searchCorpus("query");
      expect(res).toHaveLength(2);
      expect(res[0].id).toBe("fallback-1");
      expect(res[1].id).toBe("fallback-2");
    });
  });

  describe("council.ts debate tests", () => {
    it("should run quorum council debate and return consensus results with high confidence", async () => {
      mockLoadModel.mockResolvedValue("model-id");
      
      // RAG returns researcher and skeptic materials
      mockRagSearch
        .mockResolvedValueOnce([{ id: "d1", content: "Entity X was paid. " + "B".repeat(400), source: "memo.txt" }])
        .mockResolvedValueOnce([{ id: "d2", content: "Safety warning details", source: "warning.txt" }]);

      // Completion responds sequentially for Researcher, Skeptic, and Synthesizer
      mockCompletion
        .mockResolvedValueOnce({ text: Promise.resolve("Researcher: It is approved. " + "A".repeat(600)) })
        .mockResolvedValueOnce({ text: Promise.resolve("Skeptic: Looks fine, no objections.") })
        .mockResolvedValueOnce({ text: Promise.resolve("Synthesizer: Consensus is positive.") });

      const result = await runQuorumCouncil("Was Entity X paid?");
      
      expect(result.turns).toHaveLength(3);
      expect(result.turns[0].role).toBe("researcher");
      expect(result.turns[0].content).toBe("Researcher: It is approved. " + "A".repeat(600));
      expect(result.turns[1].role).toBe("skeptic");
      expect(result.turns[1].content).toBe("Skeptic: Looks fine, no objections.");
      expect(result.turns[2].role).toBe("synthesizer");
      expect(result.turns[2].content).toBe("Synthesizer: Consensus is positive.");
      
      expect(result.verdict).toBe("Synthesizer: Consensus is positive.");
      expect(result.confidence).toBe("high");
      expect(result.citations).toContain("memo.txt");
      expect(result.citations).toContain("warning.txt");
    });

    it("should return medium confidence if the skeptic raises objections", async () => {
      mockLoadModel.mockResolvedValue("model-id");
      mockRagSearch.mockResolvedValue([]);
      
      mockCompletion
        .mockResolvedValueOnce({ text: Promise.resolve("Researcher text") })
        .mockResolvedValueOnce({ text: Promise.resolve("Skeptic text with contradiction and wrong info.") })
        .mockResolvedValueOnce({ text: Promise.resolve("Synthesizer resolution") });

      const result = await runQuorumCouncil("Was Entity X paid?");
      
      expect(result.confidence).toBe("medium");
    });
  });

  describe("qvac.ts wrapper tests", () => {
    it("should load LLM Model successfully", async () => {
      mockLoadModel.mockResolvedValue("mock-llm-id");
      const id = await loadLLMModel();
      expect(id).toBe("mock-llm-id");

      // Test object modelSrc parameter to cover ternary branch
      const idObj = await loadLLMModel({ src: "obj-llama-model" });
      expect(idObj).toBe("mock-llm-id");
    });

    it("should load LLM Model with delegate options", async () => {
      mockLoadModel.mockResolvedValue("mock-llm-id");
      const id = await loadLLMModel("custom-src", {
        providerPublicKey: "pubkey",
        timeout: 10000,
        fallbackToLocal: false,
      });
      expect(id).toBe("mock-llm-id");
    });

    it("should load LLM Model with delegate options and defaults", async () => {
      mockLoadModel.mockResolvedValue("mock-llm-id");
      const id = await loadLLMModel("custom-src", {
        providerPublicKey: "pubkey"
      });
      expect(id).toBe("mock-llm-id");
      expect(mockLoadModel).toHaveBeenCalledWith({
        modelSrc: "custom-src",
        modelType: "llm",
        delegate: {
          providerPublicKey: "pubkey",
          timeout: 30000,
          fallbackToLocal: true
        }
      });
    });

    it("should load Embedding Model successfully", async () => {
      mockLoadModel.mockResolvedValue("mock-embed-id");
      const id = await loadEmbeddingModel();
      expect(id).toBe("mock-embed-id");

      // Test object modelSrc parameter to cover ternary branch
      const idObj = await loadEmbeddingModel({ src: "obj-embed-model" });
      expect(idObj).toBe("mock-embed-id");
    });


    it("should load TTS Model successfully", async () => {
      mockLoadModel.mockResolvedValue("mock-tts-id");
      const id = await loadTTSModel();
      expect(id).toBe("mock-tts-id");
    });

    it("should handle model loading failures", async () => {
      mockLoadModel.mockRejectedValue(new Error("Load failed"));
      await expect(loadLLMModel()).rejects.toThrow("Load failed");
      await expect(loadEmbeddingModel()).rejects.toThrow("Load failed");
      await expect(loadTTSModel()).rejects.toThrow("Load failed");
    });

    it("should log error when unloading fails but not throw", async () => {
      mockUnloadModel.mockRejectedValue(new Error("Unload failed"));
      await expect(unloadQVACModel("mock-id")).resolves.not.toThrow();
    });

    it("should run Completion successfully with text", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("hello") });
      const res = await runCompletion({
        modelId: "mock-id",
        history: [{ role: "user", content: "hi" }],
      });
      expect(res.text).toBe("hello");
    });

    it("should run Completion successfully with stream", async () => {
      const mockStream = { tokenStream: "stream-obj" };
      mockCompletion.mockReturnValue(mockStream);
      const res = await runCompletion({
        modelId: "mock-id",
        history: [{ role: "user", content: "hi" }],
        stream: true,
      });
      expect(res.tokenStream).toBe("stream-obj");
    });

    it("should run Completion with images if provided", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("image-processed") });
      const img = new Uint8Array([1, 2, 3]);
      const res = await runCompletion({
        modelId: "mock-id",
        history: [{ role: "user", content: "hi" }],
        images: [img],
      });
      expect(res.text).toBe("image-processed");

      // Test empty images array to cover the empty branch check
      const resEmpty = await runCompletion({
        modelId: "mock-id",
        history: [{ role: "user", content: "hi" }],
        images: [],
      });
      expect(resEmpty.text).toBe("image-processed");
    });


    it("should handle runCompletion failures", async () => {
      mockCompletion.mockRejectedValue(new Error("Inference failed"));
      await expect(
        runCompletion({
          modelId: "mock-id",
          history: [],
        })
      ).rejects.toThrow("Inference failed");
    });

    it("should save embeddings successfully", async () => {
      mockRagIngest.mockResolvedValue({ success: true });
      const res = await runSaveEmbeddings({
        modelId: "mock-id",
        documents: ["doc1"],
        chunk: true,
      });
      expect(res).toEqual({ success: true });
    });

    it("should handle save embeddings failure", async () => {
      mockRagIngest.mockRejectedValue(new Error("Ingest failed"));
      await expect(
        runSaveEmbeddings({
          modelId: "mock-id",
          documents: [],
        })
      ).rejects.toThrow("Ingest failed");
    });

    it("should search RAG successfully", async () => {
      mockRagSearch.mockResolvedValue([{ content: "found" }]);
      const res = await runRagSearch({
        modelId: "mock-id",
        query: "test",
      });
      expect(res).toEqual([{ content: "found" }]);
    });

    it("should handle RAG search failure", async () => {
      mockRagSearch.mockRejectedValue(new Error("Search failed"));
      await expect(
        runRagSearch({
          modelId: "mock-id",
          query: "test",
        })
      ).rejects.toThrow("Search failed");
    });

    it("should synthesize TTS successfully", async () => {
      mockLoadModel.mockResolvedValue("mock-tts-id");
      mockTextToSpeech.mockReturnValue({ buffer: Promise.resolve(new Uint8Array([9, 9])) });
      mockUnloadModel.mockResolvedValue(undefined);

      const buffer = await runTextToSpeech({ text: "say hi" });
      expect(buffer).toEqual(new Uint8Array([9, 9]));
    });

    it("should handle TTS failure", async () => {
      mockLoadModel.mockResolvedValue("mock-tts-id");
      mockTextToSpeech.mockReturnValue({ buffer: Promise.reject(new Error("TTS failed")) });
      await expect(runTextToSpeech({ text: "say hi" })).rejects.toThrow("TTS failed");
    });

    it("should handle stopP2PProvider failures", async () => {
      mockStopQVACProvider.mockRejectedValue(new Error("Stop failed"));
      await expect(stopP2PProvider()).rejects.toThrow("Stop failed");
    });

    it("should pair with invalid key and handle errors in startP2PProvider", async () => {
      mockStartQVACProvider.mockRejectedValue(new Error("Start failed"));
      await expect(startP2PProvider({ topic: "test" })).rejects.toThrow("Start failed");
    });

    it("should start P2P provider successfully", async () => {
      mockStartQVACProvider.mockResolvedValue({ success: true, publicKey: "pubkey" });
      const res = await startP2PProvider({ topic: "test" });
      expect(res).toEqual({ success: true, publicKey: "pubkey" });

      // Test with firewall definition to cover the firewall branch
      const resFW = await startP2PProvider({
        topic: "test",
        firewall: { mode: "allow", publicKeys: ["key1"] }
      });
      expect(resFW).toEqual({ success: true, publicKey: "pubkey" });
    });

  });
});
