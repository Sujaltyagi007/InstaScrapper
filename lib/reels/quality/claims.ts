import { ai } from "@/lib/ai/router";
import type { ReelScript } from "@/lib/reels/types";

/**
 * A single factual claim extracted from the script that the reviewer should
 * verify before posting. Claims are things like statistics, dates, quotes,
 * named people/studies, cause-and-effect assertions, and "everyone knows"
 * common-knowledge statements that might actually be wrong.
 */
export interface ExtractedClaim {
  /** The exact sentence (or short excerpt) from the script containing the claim. */
  quote: string;
  /** The specific factual assertion to check. */
  claim: string;
  /** Why it matters or could be wrong. */
  risk: string;
  /** A suggested search to verify, or "common knowledge" if trivially checkable. */
  checkWith: string;
  /** Which beat (0-indexed sentence) contains this claim. */
  sentence: number;
}

export interface ClaimsReport {
  /** Version for forward-compat. */
  version: 1;
  /** The claims Gemini found. */
  claims: ExtractedClaim[];
  /** Per-claim sign-off status, keyed by index. */
  signedOff: Record<number, { at: string; note?: string }>;
  /** True when every claim has been signed off (or there are none). */
  allSignedOff: boolean;
  extractedAt: string;
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          claim: { type: "string" },
          risk: { type: "string" },
          checkWith: { type: "string" },
          sentence: { type: "integer" },
        },
        required: ["quote", "claim", "risk", "checkWith", "sentence"],
      },
    },
  },
  required: ["claims"],
};

/**
 * Asks Gemini to extract every verifiable factual claim from a reel script.
 * Returns the claims; sign-off status starts empty.
 *
 * Deliberately does **not** throw on failure — a missing extraction should
 * never fail the render. Returns null if Gemini isn't configured or the
 * request fails.
 */
export async function extractClaims(script: ReelScript): Promise<ClaimsReport | null> {
  if (!(await ai.isConfigured())) return null;

  const lines = script.sentences.map((s, i) => `[${i}] ${s.text}`).join("\n");

  const prompt = [
    `You are a fact-checker reviewing a short-form video script. The narrator speaks these lines:`,
    ``,
    lines,
    ``,
    `Extract every statement that a viewer could check and find wrong. Include:`,
    `- Statistics, numbers, percentages, or quantities`,
    `- Named studies, papers, or researchers`,
    `- Specific dates, historical events, or timelines`,
    `- Cause-and-effect claims ("X causes Y", "X leads to Y")`,
    `- Health, science, or fitness assertions`,
    `- Quotes attributed to specific people`,
    `- "Everyone knows" claims that might actually be disputed`,
    `- Comparisons ("more than", "the most", "the only")`,
    ``,
    `For each claim, return the exact words from the script, what to check,`,
    `why it could be wrong, and a search query to verify it.`,
    ``,
    `If the script has no verifiable factual claims (e.g. it's pure opinion,`,
    `personal story, or explicitly framed as illustrative), return an empty array.`,
    `Do NOT flag:`,
    `- Subjective opinions or personal preferences`,
    `- Rhetorical questions`,
    `- Illustrative scenarios explicitly framed as hypothetical`,
    `- Common idioms or figures of speech`,
  ].join("\n");

  try {
    const result = await ai.generateJson<{ claims: ExtractedClaim[] }>({
      prompt,
      schema: EXTRACT_SCHEMA,
    });

    const claims = (result.claims ?? [])
      .filter(
        (c) =>
          typeof c.quote === "string" &&
          typeof c.claim === "string" &&
          typeof c.sentence === "number" &&
          c.sentence >= 0 &&
          c.sentence < script.sentences.length,
      )
      .map((c) => ({ ...c, sentence: Math.min(c.sentence, script.sentences.length - 1) }));

    return {
      version: 1,
      claims,
      signedOff: {},
      allSignedOff: claims.length === 0,
      extractedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[claims] extraction failed:", (err as Error).message?.slice(0, 200));
    return null;
  }
}

/** Updates the sign-off status for one claim and recomputes `allSignedOff`. */
export function signOffClaim(
  report: ClaimsReport,
  claimIndex: number,
  note?: string,
): ClaimsReport {
  if (claimIndex < 0 || claimIndex >= report.claims.length) return report;

  const signedOff = {
    ...report.signedOff,
    [claimIndex]: { at: new Date().toISOString(), ...(note ? { note } : {}) },
  };
  const allSignedOff = report.claims.every((_, i) => i in signedOff);
  return { ...report, signedOff, allSignedOff };
}

/** Removes the sign-off for one claim. */
export function unsignOffClaim(report: ClaimsReport, claimIndex: number): ClaimsReport {
  if (claimIndex < 0 || claimIndex >= report.claims.length) return report;

  const signedOff = { ...report.signedOff };
  delete signedOff[claimIndex];
  const allSignedOff = report.claims.every((_, i) => i in signedOff);
  return { ...report, signedOff, allSignedOff };
}
