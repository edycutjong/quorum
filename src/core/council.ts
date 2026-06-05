import { loadLLMModel, runCompletion, LLAMA_MODEL_ID } from "./qvac.js";
import { searchMedicalKnowledge } from "./rag.js"; // Reuse ragSearch helper

export interface CitationRef {
  source: string;
  content: string;
}

export interface AgentTurn {
  role: "researcher" | "skeptic" | "synthesizer";
  content: string;
  citations: CitationRef[];
}

export interface CouncilResult {
  turns: AgentTurn[];
  verdict: string;
  confidence: "high" | "medium" | "low";
  citations: string[];
}

/**
 * Truncate text to maxChars to prevent context overflow on small LLMs.
 * Llama 3.2 1B has ~2048 token context — we must keep prompts compact.
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "...";
}

const RAG_DOC_LIMIT = 400;    // Max chars per RAG document chunk
const AGENT_OUTPUT_LIMIT = 600; // Max chars when embedding agent output in next prompt

// Skeptic phrasing that signals an irreconcilable conflict → low confidence.
const IRRECONCILABLE_SIGNALS = [
  "irreconcilable",
  "directly contradict",
  "cannot be reconciled",
  "fraud",
  "fabricat",   // fabricated / fabrication
  "falsif",     // falsified / falsification
  "impossible",
];

// Skeptic phrasing that signals an objection worth flagging → medium confidence.
const OBJECTION_SIGNALS = [
  "contradict",
  "wrong",
  "missed",
  "inconsistent",
  "discrepancy",
  "unsupported",
  "uncited",
];

/**
 * Extract a confidence level the Synthesizer explicitly declared.
 * The Synthesizer is prompted to state "high / medium / low", so when it does,
 * that verdict is authoritative. Returns null when no level is stated.
 */
function parseDeclaredConfidence(text: string): "high" | "medium" | "low" | null {
  const t = text.toLowerCase();
  const match =
    t.match(/confidence[:\s*-]+\**(high|medium|low)/) ??
    t.match(/\b(high|medium|low)[\s*-]*confidence/);
  return (match?.[1] as "high" | "medium" | "low" | undefined) ?? null;
}

/**
 * Classify how strongly the Skeptic challenged the Researcher's answer.
 * This is the spec's contradiction-catch signal: the Skeptic is the agent
 * responsible for catching injected contradictions, independent of whether
 * the Synthesizer later chooses to downgrade overall confidence.
 */
export function skepticConcernLevel(
  skepticText: string
): "none" | "objection" | "irreconcilable" {
  const s = skepticText.toLowerCase();
  if (IRRECONCILABLE_SIGNALS.some((k) => s.includes(k))) return "irreconcilable";
  if (OBJECTION_SIGNALS.some((k) => s.includes(k))) return "objection";
  return "none";
}

/**
 * Derive the council's confidence from the debate.
 * The Synthesizer is the arbiter: if it declares a level, we honor it.
 * Otherwise we infer from the strength of the Skeptic's challenge —
 * irreconcilable conflicts are "low", lesser objections "medium", none "high".
 */
export function deriveConfidence(
  skepticText: string,
  synthesizerText: string
): "high" | "medium" | "low" {
  const declared = parseDeclaredConfidence(synthesizerText);
  if (declared) return declared;

  const level = skepticConcernLevel(skepticText);
  return level === "irreconcilable" ? "low" : level === "objection" ? "medium" : "high";
}

/**
 * Callback invoked as each agent turn completes.
 * Enables progressive streaming to the frontend.
 */
export type OnTurnCallback = (turn: AgentTurn, phase: "researcher" | "skeptic" | "synthesizer") => void;

export async function runQuorumCouncil(
  query: string,
  onTurn?: OnTurnCallback
): Promise<CouncilResult> {
  const cleanQuery = query.trim();
  const modelId = await loadLLMModel(LLAMA_MODEL_ID);
  const turns: AgentTurn[] = [];
  const allCitations: string[] = [];

  // Phase 1: Researcher Turn (broad retrieval and initial hypothesis)
  const researchDocs = await searchMedicalKnowledge(cleanQuery, 3);
  researchDocs.forEach(d => allCitations.push(d.source));

  const researcherContext = researchDocs.map((d, i) => `[Doc ${i + 1}]: ${truncate(d.content, RAG_DOC_LIMIT)}`).join("\n");
  const researcherPrompt = `You are the Researcher Agent. Answer this query using ONLY the documents below. Be concise.
Query: "${cleanQuery}"
${researcherContext}
Cite documents as [Doc X]. Do not speculate.`;

  const researcherResponse = await runCompletion({
    modelId,
    history: [{ role: "user", content: researcherPrompt }],
    stream: false,
    label: "researcher"
  });

  const researcherTurn: AgentTurn = {
    role: "researcher",
    content: researcherResponse.text,
    citations: researchDocs.map(d => ({ source: d.source, content: truncate(d.content, 200) }))
  };
  turns.push(researcherTurn);
  onTurn?.(researcherTurn, "researcher");

  // Phase 2: Skeptic Turn (actively looks for gaps, contradictions, or missed information).
  // Widen retrieval and target the records that most often contradict a claim
  // (availability/leave/attendance, approvals, exceptions) so cross-document
  // conflicts — e.g. an authorizer who was actually on leave — surface.
  const skepticDocs = await searchMedicalKnowledge(
    `contradictions, exceptions, warnings, availability, leave, attendance, approval and authorization records: ${cleanQuery}`,
    4
  );
  skepticDocs.forEach(d => allCitations.push(d.source));

  const skepticContext = skepticDocs.map((d, i) => `[Doc ${i + 1}]: ${truncate(d.content, RAG_DOC_LIMIT)}`).join("\n");
  const skepticPrompt = `You are the Skeptic Agent. Challenge this answer using the documents below. Be concise.
Researcher said: "${truncate(researcherResponse.text, AGENT_OUTPUT_LIMIT)}"
${skepticContext}
Find contradictions, gaps, or errors. What did the Researcher miss?`;

  const skepticResponse = await runCompletion({
    modelId,
    history: [{ role: "user", content: skepticPrompt }],
    stream: false,
    label: "skeptic"
  });

  const skepticTurn: AgentTurn = {
    role: "skeptic",
    content: skepticResponse.text,
    citations: skepticDocs.map(d => ({ source: d.source, content: truncate(d.content, 200) }))
  };
  turns.push(skepticTurn);
  onTurn?.(skepticTurn, "skeptic");

  // Phase 3: Synthesizer Turn (arbitration and final consensus)
  const synthesizerPrompt = `You are the Synthesizer. Reconcile these two positions into a final verdict. Be concise.
Query: "${cleanQuery}"
RESEARCHER: "${truncate(researcherResponse.text, AGENT_OUTPUT_LIMIT)}"
SKEPTIC: "${truncate(skepticResponse.text, AGENT_OUTPUT_LIMIT)}"
State confidence: high (agree), medium (some objections), or low (irreconcilable).`;

  const synthesizerResponse = await runCompletion({
    modelId,
    history: [{ role: "user", content: synthesizerPrompt }],
    stream: false,
    label: "synthesizer"
  });

  const synthesizerTurn: AgentTurn = {
    role: "synthesizer",
    content: synthesizerResponse.text,
    citations: []
  };
  turns.push(synthesizerTurn);
  onTurn?.(synthesizerTurn, "synthesizer");

  // Keep model loaded for fast subsequent queries (skip unload)
  // Model will be cleaned up when the server shuts down

  // Determine consensus-based confidence (high / medium / low)
  const confidence = deriveConfidence(skepticResponse.text, synthesizerResponse.text);

  return {
    turns,
    verdict: synthesizerResponse.text,
    confidence,
    citations: Array.from(new Set(allCitations))
  };
}
