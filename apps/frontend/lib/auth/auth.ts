import { prisma } from "@repo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export const auth: ReturnType<typeof betterAuth> = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  secret: process.env.BETTER_AUTH_SECRET as string,
  trustedOrigins: ["http://localhost:3000"],
  callbacks: {
    redirect: {
      signInRedirect: "/",
      signUpRedirect: "/",
    },
  },
});
