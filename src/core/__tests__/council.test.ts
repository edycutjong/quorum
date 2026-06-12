import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @qvac/sdk ───────────────────────────────────────────────────────────
const mockLoadModel = vi.fn();
const mockCompletion = vi.fn();
const mockRagSearch = vi.fn();

vi.mock("@qvac/sdk", () => ({
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  unloadModel: vi.fn(),
  completion: (...args: unknown[]) => mockCompletion(...args),
  ragIngest: vi.fn(),
  ragSearch: (...args: unknown[]) => mockRagSearch(...args),
  textToSpeech: vi.fn(),
  startQVACProvider: vi.fn(),
  stopQVACProvider: vi.fn(),
  LLAMA_3_2_1B_INST_Q4_0: "llama-model",
  GTE_LARGE_FP16: "gte-model",
  TTS_EN_SUPERTONIC_Q8_0: { src: "tts-src" },
}));

import { runQuorumCouncil, deriveConfidence, skepticConcernLevel } from "../council";

/** Queue three completion responses (researcher, skeptic, synthesizer). */
function mockCouncilCompletions(researcher: string, skeptic: string, synthesizer: string) {
  mockCompletion
    .mockResolvedValueOnce({ text: Promise.resolve(researcher) })
    .mockResolvedValueOnce({ text: Promise.resolve(skeptic) })
    .mockResolvedValueOnce({ text: Promise.resolve(synthesizer) });
}

describe("council.ts — multi-agent debate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadModel.mockResolvedValue("model-id");
    mockRagSearch.mockResolvedValue([]);
  });

  describe("orchestration", () => {
    it("produces exactly three turns", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.turns).toHaveLength(3);
    });

    it("orders turns Researcher → Skeptic → Synthesizer", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.turns.map((t) => t.agent)).toEqual(["researcher", "skeptic", "synthesizer"]);
    });

    it("captures each agent's text on its turn", async () => {
      mockCouncilCompletions("Researcher claim", "Skeptic rebuttal", "Final verdict");
      const result = await runQuorumCouncil("q");
      expect(result.turns[0].content).toBe("Researcher claim");
      expect(result.turns[1].content).toBe("Skeptic rebuttal");
      expect(result.turns[2].content).toBe("Final verdict");
    });

    it("uses the synthesizer's output as the verdict", async () => {
      mockCouncilCompletions("R", "S", "The final reconciled answer");
      const result = await runQuorumCouncil("q");
      expect(result.verdict).toBe("The final reconciled answer");
    });

    it("loads the LLM once for the whole council", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await runQuorumCouncil("q");
      expect(mockLoadModel).toHaveBeenCalledTimes(1);
    });

    it("loads the LLM with the Llama model id", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await runQuorumCouncil("q");
      expect(mockLoadModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelSrc: "llama-model", modelType: "llm" })
      );
    });

    it("invokes completion once per agent (three total)", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await runQuorumCouncil("q");
      expect(mockCompletion).toHaveBeenCalledTimes(3);
    });
  });

  describe("retrieval", () => {
    it("retrieves for both the researcher and the skeptic", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await runQuorumCouncil("q");
      expect(mockRagSearch).toHaveBeenCalledTimes(2);
    });

    it("issues a counter-retrieval query for the skeptic", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await runQuorumCouncil("payment to Entity X");
      const queries = mockRagSearch.mock.calls.map((c) => c[0].query);
      expect(queries[0]).toBe("payment to Entity X");
      expect(queries[1]).toContain("contradictions");
      expect(queries[1]).toContain("payment to Entity X");
    });

    it("trims whitespace from the query before retrieval", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await runQuorumCouncil("   spaced query   ");
      expect(mockRagSearch.mock.calls[0][0].query).toBe("spaced query");
    });
  });

  describe("citations", () => {
    it("aggregates citations from researcher and skeptic retrievals", async () => {
      mockRagSearch
        .mockReset()
        .mockResolvedValueOnce([{ id: "a", content: "x", source: "memo.txt" }])
        .mockResolvedValueOnce([{ id: "b", content: "y", source: "minutes.txt" }]);
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.citations).toContain("memo.txt");
      expect(result.citations).toContain("minutes.txt");
    });

    it("de-duplicates citations that appear in multiple retrievals", async () => {
      mockRagSearch
        .mockReset()
        .mockResolvedValueOnce([{ id: "a", content: "x", source: "shared.txt" }])
        .mockResolvedValueOnce([{ id: "b", content: "y", source: "shared.txt" }]);
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.citations.filter((c) => c === "shared.txt")).toHaveLength(1);
    });

    it("attaches source citations to the researcher turn", async () => {
      mockRagSearch
        .mockReset()
        .mockResolvedValueOnce([{ id: "a", content: "evidence", source: "doc.txt" }])
        .mockResolvedValueOnce([]);
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.turns[0].citations[0].source).toBe("doc.txt");
    });

    it("leaves the synthesizer turn without its own citations", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.turns[2].citations).toEqual([]);
    });

    it("yields no citations when retrieval returns nothing", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.citations).toEqual([]);
    });
  });

  describe("confidence scoring", () => {
    it("reports high confidence when the skeptic raises no objection", async () => {
      mockCouncilCompletions("R", "All sources agree.", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("high");
    });

    it("reports medium confidence when the skeptic finds a contradiction", async () => {
      mockCouncilCompletions("R", "This contradicts the memo.", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("medium");
    });

    it("reports medium confidence when the skeptic flags something wrong", async () => {
      mockCouncilCompletions("R", "The date is wrong.", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("medium");
    });

    it("reports medium confidence when the skeptic says the researcher missed something", async () => {
      mockCouncilCompletions("R", "The researcher missed the leave record.", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("medium");
    });

    it("detects objection keywords case-insensitively", async () => {
      mockCouncilCompletions("R", "This CONTRADICTS the report.", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("medium");
    });

    it("reports low confidence when the skeptic finds an irreconcilable conflict", async () => {
      mockCouncilCompletions("R", "These records are irreconcilable.", "Synth");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("low");
    });

    it("honors a confidence level explicitly declared by the synthesizer", async () => {
      mockCouncilCompletions("R", "Looks fine.", "Final verdict. Confidence: low.");
      const result = await runQuorumCouncil("q");
      expect(result.confidence).toBe("low");
    });
  });

  describe("deriveConfidence (unit)", () => {
    it("returns high when the skeptic raises no objection", () => {
      expect(deriveConfidence("All sources agree.", "verdict")).toBe("high");
    });

    it("returns medium on a plain contradiction", () => {
      expect(deriveConfidence("This contradicts the memo.", "verdict")).toBe("medium");
    });

    it("returns medium for other objection signals", () => {
      expect(deriveConfidence("The citation is unsupported.", "verdict")).toBe("medium");
      expect(deriveConfidence("There is a discrepancy here.", "verdict")).toBe("medium");
    });

    it("returns low for irreconcilable / fraud signals", () => {
      expect(deriveConfidence("The accounts are irreconcilable.", "verdict")).toBe("low");
      expect(deriveConfidence("This looks like fraud.", "verdict")).toBe("low");
      expect(deriveConfidence("The memo directly contradicts the logs.", "verdict")).toBe("low");
    });

    it("lets the synthesizer's declared confidence override skeptic heuristics", () => {
      // Skeptic implies a conflict, but the synthesizer reconciles it to high.
      expect(deriveConfidence("This contradicts the memo.", "Confidence: high")).toBe("high");
    });

    it("parses 'low confidence' phrasing as well as 'confidence: low'", () => {
      expect(deriveConfidence("ok", "I have low confidence in this.")).toBe("low");
      expect(deriveConfidence("ok", "Confidence: medium")).toBe("medium");
    });
  });

  describe("skepticConcernLevel (PRD contradiction-catch signal)", () => {
    it("reports none when the skeptic agrees", () => {
      expect(skepticConcernLevel("All sources are consistent.")).toBe("none");
    });

    it("reports objection on a plain contradiction or gap", () => {
      expect(skepticConcernLevel("This contradicts the memo.")).toBe("objection");
      expect(skepticConcernLevel("The claim is unsupported.")).toBe("objection");
    });

    it("reports irreconcilable on strong-conflict signals", () => {
      expect(skepticConcernLevel("The records are irreconcilable.")).toBe("irreconcilable");
      expect(skepticConcernLevel("This appears to be fraud.")).toBe("irreconcilable");
    });

    it("is case-insensitive", () => {
      expect(skepticConcernLevel("CONTRADICTS the logs")).toBe("objection");
    });
  });

  describe("progressive streaming callback", () => {
    it("invokes onTurn once per agent", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      const onTurn = vi.fn();
      await runQuorumCouncil("q", onTurn);
      expect(onTurn).toHaveBeenCalledTimes(3);
    });

    it("reports phases in council order", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      const phases: string[] = [];
      await runQuorumCouncil("q", (_turn, phase) => phases.push(phase));
      expect(phases).toEqual(["researcher", "skeptic", "synthesizer"]);
    });

    it("passes the matching turn object to the callback", async () => {
      mockCouncilCompletions("Claim", "Rebuttal", "Verdict");
      const seen: string[] = [];
      await runQuorumCouncil("q", (turn) => seen.push(turn.content));
      expect(seen).toEqual(["Claim", "Rebuttal", "Verdict"]);
    });

    it("works without a callback (callback is optional)", async () => {
      mockCouncilCompletions("R", "S", "Synth");
      await expect(runQuorumCouncil("q")).resolves.toBeDefined();
    });
  });

  describe("contradiction-catch scenario (the core demo)", () => {
    it("flags medium confidence and cites both conflicting sources", async () => {
      mockRagSearch
        .mockReset()
        .mockResolvedValueOnce([
          { id: "memo", content: "VP Vance authorized the payment on March 3.", source: "memo_4821.txt" },
        ])
        .mockResolvedValueOnce([
          { id: "leave", content: "Vance was on leave March 1-7.", source: "hr_access_logs.txt" },
        ]);
      mockCouncilCompletions(
        "Vance approved the payment on March 3 [Doc 1].",
        "This contradicts the leave record: Vance was away March 1-7.",
        "Disputed: the memo's attribution conflicts with HR leave records. Confidence: medium."
      );

      const result = await runQuorumCouncil("Who approved the payment, and when?");

      expect(result.confidence).toBe("medium");
      expect(result.citations).toEqual(
        expect.arrayContaining(["memo_4821.txt", "hr_access_logs.txt"])
      );
      expect(result.verdict.toLowerCase()).toContain("disputed");
    });
  });
});
