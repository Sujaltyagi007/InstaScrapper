import { NextResponse } from "next/server";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { GeminiError } from "@/lib/ai/gemini";
import { generateIdeas } from "@/lib/services/idea.service";

export const maxDuration = 60;

export async function POST() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await generateIdeas(userId), { status: 201 });
  } catch (err) {
    if (err instanceof GeminiError) {
      const message = err.quotaExceeded
        ? "Gemini's free daily limit is used up. Try again tomorrow."
        : err.retryAfterMs !== undefined
          ? "Gemini's free tier is busy right now. Try again in a minute."
          : err.message;
      const limited = err.quotaExceeded || err.retryAfterMs !== undefined;
      return NextResponse.json({ error: message, code: "GEMINI_ERROR" }, { status: limited ? 429 : 502 });
    }
    return jsonError(err);
  }
}
