import { NextResponse } from "next/server";
import { jsonError, requireUserId, ApiError } from "@/lib/api-helpers";
import { addUserKey, envKeyProviders, listUserKeys } from "@/lib/ai/keys";
import { addKeySchema } from "@/lib/validation/ai-keys";

/** The user's keys (last 4 characters only) and which providers also have a server key. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ keys: await listUserKeys(userId), serverKeys: envKeyProviders() });
  } catch (err) {
    return jsonError(err);
  }
}

/** Checks the key with its provider, then saves it encrypted. */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = addKeySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Pick a provider and paste a key.");
    const result = await addUserKey(userId, parsed.data.provider, parsed.data.key, { force: parsed.data.force });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
