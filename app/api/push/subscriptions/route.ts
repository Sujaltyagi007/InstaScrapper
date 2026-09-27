import { NextResponse } from "next/server";
import { requireUserId, jsonError } from "@/lib/api-helpers";
import { pushSubscriptionSchema } from "@/lib/validation/push";
import { getPushState, removeSubscription, saveSubscription } from "@/lib/services/push.service";

/** Push state for the Notifications page: server config, preferences, this user's devices. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await getPushState(userId));
  } catch (err) {
    return jsonError(err);
  }
}

/** Save this browser's subscription (also used by the service worker when the browser rotates it). */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json().catch(() => null);
    const parsed = pushSubscriptionSchema.safeParse(body?.subscription ?? body);
    if (!parsed.success) return NextResponse.json({ error: "That isn't a valid push subscription." }, { status: 400 });

    // The service worker sends the old endpoint when the browser replaced the subscription.
    if (typeof body?.oldEndpoint === "string" && body.oldEndpoint !== parsed.data.endpoint) {
      await removeSubscription(userId, { endpoint: body.oldEndpoint });
    }
    const saved = await saveSubscription(userId, parsed.data, req.headers.get("user-agent"));
    return NextResponse.json({ device: { id: saved.id, label: saved.label } }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

/** Remove a device: `?id=` from the device list, or `?endpoint=` for this browser. */
export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? undefined;
    const endpoint = url.searchParams.get("endpoint") ?? undefined;
    return NextResponse.json(await removeSubscription(userId, { id, endpoint }));
  } catch (err) {
    return jsonError(err);
  }
}
