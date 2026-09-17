import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { NotFoundError } from "@/lib/errors";
import { UnsafeUrlError } from "@/lib/security/ssrf";

export class ApiError extends Error {
  /**
   * `code` is a stable machine-readable identifier (e.g. TARGET_LIMIT_REACHED)
   * so the UI can react to a specific failure without matching message text.
   * `details` carries structured context such as current usage.
   */
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new ApiError(401, "Not authenticated.");
  }
  return session.user.id;
}

export function jsonError(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      {
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      },
      { status: err.status }
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof UnsafeUrlError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export function requireCronAuth(req: Request) {
  const header = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    throw new ApiError(500, "CRON_SECRET is not configured.");
  }
  if (header !== `Bearer ${expected}`) {
    throw new ApiError(401, "Invalid cron credentials.");
  }
}
