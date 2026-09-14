import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation/auth";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { jsonError } from "@/lib/api-helpers";

export async function POST(req: Request) {
  try {
    const ip = clientIpFromHeaders(req.headers);
    const rate = await checkRateLimit(`register:${ip}`);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 900) } }
      );
    }

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: parsed.data.name },
      select: { id: true, email: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
