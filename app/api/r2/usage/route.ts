import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/storage/r2-guardrail";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  
  // Basic security check - only admins/users should see this
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const summary = await getUsageSummary();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[R2 Usage API] Error fetching usage summary", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
