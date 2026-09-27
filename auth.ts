import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import { getServerSession } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation/auth";
import CredentialsProvider from "next-auth/providers/credentials";

const nextAuthSecret = process.env.NEXTAUTH_SECRET;
if (!nextAuthSecret) {
  throw new Error("NEXTAUTH_SECRET must be set.");
}

export const authOptions: NextAuthOptions = {
  ...authConfig,
  secret: nextAuthSecret,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = loginSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();
        const rate = await checkRateLimit(`login:${normalizedEmail}`);
        if (!rate.allowed) return null;
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, });
        if (!user) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
};

export const auth = () => getServerSession(authOptions);
