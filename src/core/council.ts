import { loadLLMModel, runCompletion, unloadQVACModel, LLAMA_MODEL_ID } from "./qvac.js";
import { searchMedicalKnowledge } from "./rag.js"; // Reuse ragSearch helper

export interface AgentTurn {
  role: "researcher" | "skeptic" | "synthesizer";
  content: string;
  citations: string[];
}

export interface CouncilResult {
  turns: AgentTurn[];
  verdict: string;
  confidence: "high" | "medium" | "low";
  citations: string[];
}

export async function runQuorumCouncil(query: string): Promise<CouncilResult> {
  const modelId = await loadLLMModel(LLAMA_MODEL_ID);
  const turns: AgentTurn[] = [];
  const allCitations: string[] = [];

  // Phase 1: Researcher Turn (broad retrieval and initial hypothesis)
  const researchDocs = await searchMedicalKnowledge(query, 3);
  researchDocs.forEach(d => allCitations.push(d.source));

  const researcherContext = researchDocs.map((d, i) => `[Doc ${i + 1}]: ${d.content}`).join("\n");
  const researcherPrompt = `You are the lead Researcher Agent in a document council.
Your goal is to answer this query: "${query}" based on the following documents:
${researcherContext}

Answer carefully, citing the documents as [Doc X]. Do not speculate beyond what is in the documents.`;

  const researcherResponse = await runCompletion({
    modelId,
    history: [{ role: "user", content: researcherPrompt }],
    stream: false
  });

  turns.push({
    role: "researcher",
    content: researcherResponse.text,
    citations: researchDocs.map(d => d.source)
  });

  // Phase 2: Skeptic Turn (actively looks for gaps, contradictions, or missed information)
  // Retrieve counter-materials
  const skepticDocs = await searchMedicalKnowledge(`contraindications exceptions safety warnings: ${query}`, 2);
  skepticDocs.forEach(d => allCitations.push(d.source));

  const skepticContext = skepticDocs.map((d, i) => `[Doc ${i + 1}]: ${d.content}`).join("\n");
  const skepticPrompt = `You are the Skeptic Agent in a document council.
You have reviewed the lead Researcher's answer:
"${researcherResponse.text}"

Your goal is to find contradictions, gaps, or warnings concerning this answer using the following supplementary documents:
${skepticContext}

Challenge the Researcher's assumptions. Highlight what they might have missed or gotten wrong.`;

  const skepticResponse = await runCompletion({
    modelId,
    history: [{ role: "user", content: skepticPrompt }],
    stream: false
  });

  turns.push({
    role: "skeptic",
    content: skepticResponse.text,
    citations: skepticDocs.map(d => d.source)
  });

  // Phase 3: Synthesizer Turn (arbitration and final consensus)
  const synthesizerPrompt = `You are the Synthesizer Agent in a document council.
You have the outputs from the lead Researcher and the Skeptic:

RESEARCHER: "${researcherResponse.text}"
SKEPTIC: "${skepticResponse.text}"

Query: "${query}"

Resolve their disagreement. Provide a unified final verdict.
Indicate your confidence (high/medium/low) based on whether the Researcher and Skeptic agree, and list the final citations.`;

  const synthesizerResponse = await runCompletion({
    modelId,
    history: [{ role: "user", content: synthesizerPrompt }],
    stream: false
  });

  turns.push({
    role: "synthesizer",
    content: synthesizerResponse.text,
    citations: []
  });

  // Cleanup LLM
  await unloadQVACModel(modelId);

  // Determine consensus-based confidence
  const lowerSkeptic = skepticResponse.text.toLowerCase();
  const hasObjection = lowerSkeptic.includes("contradict") || lowerSkeptic.includes("wrong") || lowerSkeptic.includes("missed");
  const confidence = hasObjection ? "medium" : "high";

  return {
    turns,
    verdict: synthesizerResponse.text,
    confidence: confidence as "high" | "medium",
    citations: Array.from(new Set(allCitations))
  };
}
