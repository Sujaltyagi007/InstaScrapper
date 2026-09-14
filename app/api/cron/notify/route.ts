import { NextResponse } from "next/server";
import { requireCronAuth, jsonError } from "@/lib/api-helpers";
import { dispatchDueNotifications } from "@/lib/services/notification.service";

export async function GET(req: Request) {
  try {
    requireCronAuth(req);
    const result = await dispatchDueNotifications(25);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
