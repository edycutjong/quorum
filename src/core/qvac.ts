/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  loadModel,
  unloadModel,
  completion,
  ragIngest,
  ragSearch,
  ragCloseWorkspace,
  textToSpeech,
  startQVACProvider,
  stopQVACProvider,
  LLAMA_3_2_1B_INST_Q4_0,
  GTE_LARGE_FP16,
  TTS_EN_SUPERTONIC_Q8_0,
} from "@qvac/sdk";
import { audit } from "./audit.js";

// Define custom constants or fallbacks
export const MEDPSY_MODEL_ID = "MedPsy-1.7B"; // Default name for MedPsy-1.7B
export const MULTIMODAL_MODEL_ID = "QVAC-Vision-1B"; // Multimodal vision model for scene understanding
export const LLAMA_MODEL_ID = LLAMA_3_2_1B_INST_Q4_0;
export const EMBEDDING_MODEL_ID = GTE_LARGE_FP16;

export interface CompletionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CompletionParams {
  modelId: string;
  history: CompletionMessage[];
  stream?: boolean;
  images?: Uint8Array[];
  label?: string; // audit label, e.g. agent role
}

export interface EmbedParams {
  modelId: string;
  documents: string[];
  chunk?: boolean;
}

export interface RagSearchParams {
  modelId: string;
  query: string;
  topK?: number;
}

export interface TTSParams {
  text: string;
  eSpeakDataPath?: string;
}

export interface P2PProviderParams {
  topic: string;
  firewall?: {
    mode: "allow" | "deny";
    publicKeys: string[];
  };
}

export interface P2PDelegateParams {
  providerPublicKey: string;
  timeout?: number;
  fallbackToLocal?: boolean;
}

// ── Model Loaders ──────────────────────────────────────────────────────────

export async function loadLLMModel(modelSrc: any = LLAMA_MODEL_ID, delegateParams?: P2PDelegateParams) {
  try {
    const src = typeof modelSrc === "string" ? modelSrc : modelSrc.src;
    const params: any = {
      modelSrc: src,
      modelType: "llm",
    };

    if (delegateParams) {
      // Confirm signature against docs.qvac.tether.io
      params.delegate = {
        providerPublicKey: delegateParams.providerPublicKey,
        timeout: delegateParams.timeout ?? 30000,
        fallbackToLocal: delegateParams.fallbackToLocal ?? true,
      };
    }

    const t0 = Date.now();
    const modelId = await loadModel(params);
    audit({ event: "model_load", model: "llm", modelType: "llm", modelId, ms: Date.now() - t0 });
    return modelId;
  } catch (error) {
    console.error("Failed to load LLM model:", error);
    throw error;
  }
}

export async function loadEmbeddingModel(modelSrc: any = EMBEDDING_MODEL_ID) {
  try {
    const src = typeof modelSrc === "string" ? modelSrc : modelSrc.src;
    const t0 = Date.now();
    const modelId = await loadModel({
      modelSrc: src,
      modelType: "embeddings",
    } as any);
    audit({ event: "model_load", model: "embeddings", modelType: "embeddings", modelId, ms: Date.now() - t0 });
    return modelId;
  } catch (error) {
    console.error("Failed to load Embedding model:", error);
    throw error;
  }
}

export async function loadTTSModel(_eSpeakDataPath: string = "./espeak-data") {
  try {
    const modelId = await loadModel({
      modelSrc: TTS_EN_SUPERTONIC_Q8_0.src,
      modelType: "tts",
      modelConfig: {
        language: "en",
      },
    } as any);
    return modelId;
  } catch (error) {
    console.error("Failed to load TTS model:", error);
    throw error;
  }
}

export async function unloadQVACModel(modelId: string) {
  try {
    await unloadModel({ modelId });
    audit({ event: "model_unload", modelId });
  } catch (error) {
    console.error(`Failed to unload model ${modelId}:`, error);
  }
}

// ── Completion Wrapper ──────────────────────────────────────────────────────

export async function runCompletion(params: CompletionParams): Promise<{ text: string; tokenStream?: AsyncGenerator<string> }> {
  try {
    const completionParams: any = {
      modelId: params.modelId,
      history: params.history,
      stream: params.stream ?? false,
    };

    // Attach images for multimodal inference if provided
    if (params.images && params.images.length > 0) {
      completionParams.images = params.images;
    }

    if (params.stream) {
      const result = completion({ ...completionParams, stream: true } as any);
      return {
        text: "",
        tokenStream: result.tokenStream,
      };
    } else {
      const t0 = Date.now();
      const result = await completion({ ...completionParams, stream: false } as any);
      const text = await result.text;
      // Capture per-inference performance stats from the SDK for the audit log.
      let stats: any;
      try { stats = await result.stats; } catch { stats = undefined; }
      const prompt = params.history.map((h) => h.content).join("\n");
      audit({
        event: "inference",
        label: params.label,
        modelId: params.modelId,
        promptChars: prompt.length,
        promptPreview: prompt.slice(0, 160),
        durationMs: Date.now() - t0,
        timeToFirstTokenMs: stats?.timeToFirstToken,
        tokensPerSecond: stats?.tokensPerSecond,
        promptTokens: stats?.promptTokens,
        generatedTokens: stats?.generatedTokens,
        cacheTokens: stats?.cacheTokens,
        backendDevice: stats?.backendDevice,
      });
      return { text };
    }
  } catch (error) {
    console.error("Inference completion failed:", error);
    throw error;
  }
}

// ── RAG Wrapper ─────────────────────────────────────────────────────────────

export async function runSaveEmbeddings(params: EmbedParams) {
  try {
    const response = await ragIngest({
      modelId: params.modelId,
      documents: params.documents,
      chunk: params.chunk ?? false,
    } as any);
    return response;
  } catch (error) {
    console.error("RAG embedding save failed:", error);
    throw error;
  }
}

/**
 * Delete the default RAG workspace from disk so the next ingest starts clean.
 * Makes seeding idempotent — re-seeding can't accumulate duplicate chunks.
 * Safe to call when the workspace doesn't exist yet.
 */
export async function clearCorpusWorkspace(): Promise<void> {
  try {
    await ragCloseWorkspace({ deleteOnClose: true });
  } catch (error) {
    // Expected on a fresh store (no workspace ingested yet) — nothing to clear,
    // so stay silent. Only surface genuinely unexpected failures.
    if (!/not open|not exist/i.test(String(error))) {
      console.error("Failed to clear corpus workspace:", error);
    }
  }
}

export async function runRagSearch(params: RagSearchParams) {
  try {
    const results = await ragSearch({
      modelId: params.modelId,
      query: params.query,
      topK: params.topK ?? 5,
    });
    return results; // Returns array of { content: string, score?: number }
  } catch (error) {
    console.error("RAG search failed:", error);
    throw error;
  }
}

// ── Speech Synthesis Wrapper ────────────────────────────────────────────────

export async function runTextToSpeech(params: TTSParams) {
  try {
    const ttsModelId = await loadTTSModel(params.eSpeakDataPath ?? "./espeak-data");
    const result = textToSpeech({
      modelId: ttsModelId,
      text: params.text,
      inputType: "text",
      stream: false,
    });
    const buffer = await result.buffer;
    await unloadQVACModel(ttsModelId);
    return buffer;
  } catch (error) {
    console.error("TTS generation failed:", error);
    throw error;
  }
}

// ── P2P Compute Mesh Providers ──────────────────────────────────────────────

export async function startP2PProvider(params: P2PProviderParams) {
  try {
    const firewall = params.firewall ? {
      mode: params.firewall.mode,
      publicKeys: params.firewall.publicKeys,
    } : undefined;

    const response = await startQVACProvider({
      topic: params.topic,
      firewall,
    } as any);

    return response; // returns { success: boolean, publicKey?: string }
  } catch (error) {
    console.error("Failed to start QVAC P2P Provider:", error);
    throw error;
  }
}

export async function stopP2PProvider() {
  try {
    await stopQVACProvider();
  } catch (error) {
    console.error("Failed to stop QVAC P2P Provider:", error);
    throw error;
  }
}
