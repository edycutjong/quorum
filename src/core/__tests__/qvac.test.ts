import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @qvac/sdk ───────────────────────────────────────────────────────────
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockCompletion = vi.fn();
const mockRagIngest = vi.fn();
const mockRagSearch = vi.fn();
const mockRagCloseWorkspace = vi.fn();
const mockTextToSpeech = vi.fn();
const mockStartQVACProvider = vi.fn();
const mockStopQVACProvider = vi.fn();

vi.mock("@qvac/sdk", () => ({
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  unloadModel: (...args: unknown[]) => mockUnloadModel(...args),
  completion: (...args: unknown[]) => mockCompletion(...args),
  ragIngest: (...args: unknown[]) => mockRagIngest(...args),
  ragSearch: (...args: unknown[]) => mockRagSearch(...args),
  ragCloseWorkspace: (...args: unknown[]) => mockRagCloseWorkspace(...args),
  textToSpeech: (...args: unknown[]) => mockTextToSpeech(...args),
  startQVACProvider: (...args: unknown[]) => mockStartQVACProvider(...args),
  stopQVACProvider: (...args: unknown[]) => mockStopQVACProvider(...args),
  LLAMA_3_2_1B_INST_Q4_0: "llama-model",
  GTE_LARGE_FP16: "gte-model",
  TTS_EN_SUPERTONIC_Q8_0: { src: "tts-src" },
}));

import {
  loadLLMModel,
  loadEmbeddingModel,
  loadTTSModel,
  unloadQVACModel,
  runCompletion,
  runSaveEmbeddings,
  runRagSearch,
  clearCorpusWorkspace,
  runTextToSpeech,
  startP2PProvider,
  stopP2PProvider,
  LLAMA_MODEL_ID,
  EMBEDDING_MODEL_ID,
} from "../qvac";

describe("qvac.ts — SDK wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("exported model constants", () => {
    it("maps the LLAMA model id to the SDK constant", () => {
      expect(LLAMA_MODEL_ID).toBe("llama-model");
    });

    it("maps the embedding model id to the SDK constant", () => {
      expect(EMBEDDING_MODEL_ID).toBe("gte-model");
    });
  });

  describe("loadLLMModel", () => {
    it("loads with the default LLAMA model id", async () => {
      mockLoadModel.mockResolvedValue("llm-id");
      const id = await loadLLMModel();
      expect(id).toBe("llm-id");
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelSrc: "llama-model", modelType: "llm" })
      );
    });

    it("accepts a string model source", async () => {
      mockLoadModel.mockResolvedValue("llm-id");
      await loadLLMModel("custom-string-src");
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelSrc: "custom-string-src" })
      );
    });

    it("accepts an object model source with a `src` field", async () => {
      mockLoadModel.mockResolvedValue("llm-id");
      await loadLLMModel({ src: "obj-src" });
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelSrc: "obj-src" })
      );
    });

    it("does not attach a delegate when none is given", async () => {
      mockLoadModel.mockResolvedValue("llm-id");
      await loadLLMModel();
      const arg = mockLoadModel.mock.calls[0][0];
      expect(arg).not.toHaveProperty("delegate");
    });

    it("attaches delegate options when provided", async () => {
      mockLoadModel.mockResolvedValue("llm-id");
      await loadLLMModel("src", {
        providerPublicKey: "pk",
        timeout: 12345,
        fallbackToLocal: false,
      });
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({
          delegate: { providerPublicKey: "pk", timeout: 12345, fallbackToLocal: false },
        })
      );
    });

    it("applies delegate defaults (timeout 30000, fallbackToLocal true)", async () => {
      mockLoadModel.mockResolvedValue("llm-id");
      await loadLLMModel("src", { providerPublicKey: "pk" });
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({
          delegate: { providerPublicKey: "pk", timeout: 30000, fallbackToLocal: true },
        })
      );
    });

    it("propagates load failures", async () => {
      mockLoadModel.mockRejectedValue(new Error("Load failed"));
      await expect(loadLLMModel()).rejects.toThrow("Load failed");
    });
  });

  describe("loadEmbeddingModel", () => {
    it("loads with the default embedding model id and type", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      const id = await loadEmbeddingModel();
      expect(id).toBe("embed-id");
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelSrc: "gte-model", modelType: "embeddings" })
      );
    });

    it("accepts an object model source", async () => {
      mockLoadModel.mockResolvedValue("embed-id");
      await loadEmbeddingModel({ src: "embed-obj" });
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelSrc: "embed-obj" })
      );
    });

    it("propagates load failures", async () => {
      mockLoadModel.mockRejectedValue(new Error("Load failed"));
      await expect(loadEmbeddingModel()).rejects.toThrow("Load failed");
    });
  });

  describe("loadTTSModel", () => {
    it("loads with the tts model type", async () => {
      mockLoadModel.mockResolvedValue("tts-id");
      const id = await loadTTSModel();
      expect(id).toBe("tts-id");
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelType: "tts", modelSrc: "tts-src" })
      );
    });

    it("configures English language", async () => {
      mockLoadModel.mockResolvedValue("tts-id");
      await loadTTSModel();
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelConfig: { language: "en" } })
      );
    });

    it("propagates load failures", async () => {
      mockLoadModel.mockRejectedValue(new Error("Load failed"));
      await expect(loadTTSModel()).rejects.toThrow("Load failed");
    });
  });

  describe("unloadQVACModel", () => {
    it("calls the SDK unload with the model id", async () => {
      mockUnloadModel.mockResolvedValue(undefined);
      await unloadQVACModel("some-id");
      expect(mockUnloadModel).toHaveBeenCalledWith({ modelId: "some-id" });
    });

    it("swallows unload errors instead of throwing", async () => {
      mockUnloadModel.mockRejectedValue(new Error("Unload failed"));
      await expect(unloadQVACModel("some-id")).resolves.toBeUndefined();
    });
  });

  describe("runCompletion", () => {
    it("returns resolved text in non-streaming mode", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("answer") });
      const res = await runCompletion({ modelId: "m", history: [{ role: "user", content: "hi" }] });
      expect(res.text).toBe("answer");
    });

    it("defaults to non-streaming (stream=false)", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("answer") });
      await runCompletion({ modelId: "m", history: [] });
      expect(mockCompletion).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
    });

    it("returns a token stream in streaming mode", async () => {
      mockCompletion.mockReturnValue({ tokenStream: "stream-handle" });
      const res = await runCompletion({ modelId: "m", history: [], stream: true });
      expect(res.tokenStream).toBe("stream-handle");
      expect(res.text).toBe("");
    });

    it("attaches images when provided", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("ok") });
      const img = new Uint8Array([1, 2, 3]);
      await runCompletion({ modelId: "m", history: [], images: [img] });
      expect(mockCompletion).toHaveBeenCalledWith(expect.objectContaining({ images: [img] }));
    });

    it("does not attach an empty images array", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("ok") });
      await runCompletion({ modelId: "m", history: [], images: [] });
      const arg = mockCompletion.mock.calls[0][0];
      expect(arg).not.toHaveProperty("images");
    });

    it("forwards the conversation history", async () => {
      mockCompletion.mockResolvedValue({ text: Promise.resolve("ok") });
      const history = [{ role: "user" as const, content: "question" }];
      await runCompletion({ modelId: "m", history });
      expect(mockCompletion).toHaveBeenCalledWith(expect.objectContaining({ history }));
    });

    it("propagates completion failures", async () => {
      mockCompletion.mockRejectedValue(new Error("Inference failed"));
      await expect(runCompletion({ modelId: "m", history: [] })).rejects.toThrow("Inference failed");
    });
  });

  describe("runSaveEmbeddings", () => {
    it("returns the SDK response", async () => {
      mockRagIngest.mockResolvedValue({ success: true });
      const res = await runSaveEmbeddings({ modelId: "m", documents: ["d"] });
      expect(res).toEqual({ success: true });
    });

    it("defaults chunk to false", async () => {
      mockRagIngest.mockResolvedValue({ success: true });
      await runSaveEmbeddings({ modelId: "m", documents: ["d"] });
      expect(mockRagIngest).toHaveBeenCalledWith(expect.objectContaining({ chunk: false }));
    });

    it("forwards chunk=true when requested", async () => {
      mockRagIngest.mockResolvedValue({ success: true });
      await runSaveEmbeddings({ modelId: "m", documents: ["d"], chunk: true });
      expect(mockRagIngest).toHaveBeenCalledWith(expect.objectContaining({ chunk: true }));
    });

    it("propagates ingestion failures", async () => {
      mockRagIngest.mockRejectedValue(new Error("Ingest failed"));
      await expect(runSaveEmbeddings({ modelId: "m", documents: [] })).rejects.toThrow("Ingest failed");
    });
  });

  describe("runRagSearch", () => {
    it("returns search results", async () => {
      mockRagSearch.mockResolvedValue([{ content: "hit" }]);
      const res = await runRagSearch({ modelId: "m", query: "q" });
      expect(res).toEqual([{ content: "hit" }]);
    });

    it("defaults topK to 5", async () => {
      mockRagSearch.mockResolvedValue([]);
      await runRagSearch({ modelId: "m", query: "q" });
      expect(mockRagSearch).toHaveBeenCalledWith(expect.objectContaining({ topK: 5 }));
    });

    it("forwards a custom topK", async () => {
      mockRagSearch.mockResolvedValue([]);
      await runRagSearch({ modelId: "m", query: "q", topK: 2 });
      expect(mockRagSearch).toHaveBeenCalledWith(expect.objectContaining({ topK: 2 }));
    });

    it("propagates search failures", async () => {
      mockRagSearch.mockRejectedValue(new Error("Search failed"));
      await expect(runRagSearch({ modelId: "m", query: "q" })).rejects.toThrow("Search failed");
    });
  });

  describe("clearCorpusWorkspace", () => {
    it("deletes the default workspace on close", async () => {
      mockRagCloseWorkspace.mockResolvedValue(undefined);
      await clearCorpusWorkspace();
      expect(mockRagCloseWorkspace).toHaveBeenCalledWith({ deleteOnClose: true });
    });

    it("swallows errors when the workspace does not exist yet", async () => {
      mockRagCloseWorkspace.mockRejectedValue(new Error("no workspace"));
      await expect(clearCorpusWorkspace()).resolves.toBeUndefined();
    });
  });

  describe("runTextToSpeech", () => {
    it("synthesizes audio and returns the buffer", async () => {
      mockLoadModel.mockResolvedValue("tts-id");
      mockTextToSpeech.mockReturnValue({ buffer: Promise.resolve(new Uint8Array([7, 7])) });
      mockUnloadModel.mockResolvedValue(undefined);
      const buf = await runTextToSpeech({ text: "hello" });
      expect(buf).toEqual(new Uint8Array([7, 7]));
    });

    it("unloads the TTS model after synthesis", async () => {
      mockLoadModel.mockResolvedValue("tts-id");
      mockTextToSpeech.mockReturnValue({ buffer: Promise.resolve(new Uint8Array([1])) });
      mockUnloadModel.mockResolvedValue(undefined);
      await runTextToSpeech({ text: "hello" });
      expect(mockUnloadModel).toHaveBeenCalledWith({ modelId: "tts-id" });
    });

    it("propagates synthesis failures", async () => {
      mockLoadModel.mockResolvedValue("tts-id");
      mockTextToSpeech.mockReturnValue({ buffer: Promise.reject(new Error("TTS failed")) });
      await expect(runTextToSpeech({ text: "hello" })).rejects.toThrow("TTS failed");
    });
  });

  describe("startP2PProvider", () => {
    it("starts a provider and returns its public key", async () => {
      mockStartQVACProvider.mockResolvedValue({ success: true, publicKey: "pk" });
      const res = await startP2PProvider({ topic: "t" });
      expect(res).toEqual({ success: true, publicKey: "pk" });
    });

    it("passes an undefined firewall when none is configured", async () => {
      mockStartQVACProvider.mockResolvedValue({ success: true });
      await startP2PProvider({ topic: "t" });
      expect(mockStartQVACProvider).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "t", firewall: undefined })
      );
    });

    it("forwards a configured firewall", async () => {
      mockStartQVACProvider.mockResolvedValue({ success: true });
      await startP2PProvider({ topic: "t", firewall: { mode: "allow", publicKeys: ["k1"] } });
      expect(mockStartQVACProvider).toHaveBeenCalledWith(
        expect.objectContaining({ firewall: { mode: "allow", publicKeys: ["k1"] } })
      );
    });

    it("propagates start failures", async () => {
      mockStartQVACProvider.mockRejectedValue(new Error("Start failed"));
      await expect(startP2PProvider({ topic: "t" })).rejects.toThrow("Start failed");
    });
  });

  describe("stopP2PProvider", () => {
    it("stops the provider", async () => {
      mockStopQVACProvider.mockResolvedValue(undefined);
      await expect(stopP2PProvider()).resolves.toBeUndefined();
      expect(mockStopQVACProvider).toHaveBeenCalled();
    });

    it("propagates stop failures", async () => {
      mockStopQVACProvider.mockRejectedValue(new Error("Stop failed"));
      await expect(stopP2PProvider()).rejects.toThrow("Stop failed");
    });
  });
});
