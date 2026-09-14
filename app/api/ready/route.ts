import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Readiness: can this instance actually serve traffic (i.e. reach the DB).
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready" });
  } catch (err) {
    return NextResponse.json(
      { status: "not-ready", error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
