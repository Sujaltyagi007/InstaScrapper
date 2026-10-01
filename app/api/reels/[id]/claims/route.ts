import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUserId } from "@/lib/api-helpers";
import { signOffClaim, unsignOffClaim, type ClaimsReport } from "@/lib/reels/quality/claims";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = (await req.json()) as { claimIndex: number; signedOff: boolean; note?: string };
    const { claimIndex, signedOff, note } = body;

    if (typeof claimIndex !== "number" || typeof signedOff !== "boolean") {
      return NextResponse.json({ error: "claimIndex (number) and signedOff (boolean) are required." }, { status: 400 });
    }

    const project = await prisma.reelProject.findFirst({
      where: { id, userId },
      select: { claimsReport: true, qualityReport: true },
    });
    if (!project) return NextResponse.json({ error: "Reel not found." }, { status: 404 });
    if (!project.claimsReport) return NextResponse.json({ error: "No claims have been extracted for this reel." }, { status: 409 });

    const current = project.claimsReport as unknown as ClaimsReport;
    const updated = signedOff ? signOffClaim(current, claimIndex, note) : unsignOffClaim(current, claimIndex);

    // Also update the quality report's claims gate so the score reflects sign-off.
    let qualityUpdate: Prisma.InputJsonValue | undefined;
    if (project.qualityReport) {
      const qr = structuredClone(project.qualityReport) as unknown as { gates?: { id: string; passed: boolean | null; detail: string }[] };
      const gate = qr.gates?.find((g) => g.id === "claims-signed-off");
      if (gate) {
        if (updated.claims.length === 0) {
          gate.passed = true;
          gate.detail = "No verifiable factual claims found in the script.";
        } else if (updated.allSignedOff) {
          gate.passed = true;
          gate.detail = `All ${updated.claims.length} claim(s) signed off.`;
        } else {
          const remaining = updated.claims.length - Object.keys(updated.signedOff).length;
          gate.passed = false;
          gate.detail = `${remaining} of ${updated.claims.length} claim(s) still need sign-off.`;
        }
        qualityUpdate = qr as unknown as Prisma.InputJsonValue;
      }
    }

    await prisma.reelProject.update({
      where: { id },
      data: {
        claimsReport: updated as unknown as Prisma.InputJsonValue,
        ...(qualityUpdate ? { qualityReport: qualityUpdate } : {}),
      },
    });

    return NextResponse.json({ claimsReport: updated, ...(qualityUpdate ? { qualityReport: qualityUpdate } : {}) });
  } catch (err) {
    return jsonError(err);
  }
}
