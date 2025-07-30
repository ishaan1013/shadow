"use server";

import { cookies } from "next/headers";

export type ApiKeyProvider = "openai" | "anthropic";

export interface ApiKeys {
  openai: string;
  anthropic: string;
}

export async function getApiKeys(): Promise<ApiKeys> {
  const cookieStore = await cookies();

  const openaiKey = cookieStore.get("openai-key")?.value || "";
  const anthropicKey = cookieStore.get("anthropic-key")?.value || "";

  return {
    openai: openaiKey,
    anthropic: anthropicKey,
  };
}

export async function saveApiKey(provider: ApiKeyProvider, key: string | null) {
  const cookieStore = await cookies();
  const cookieName = `${provider}-key`;

  if (key) {
    cookieStore.set(cookieName, key, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  } else {
    cookieStore.delete(cookieName);
  }

  return { success: true };
}

export async function clearApiKey(provider: ApiKeyProvider) {
  return saveApiKey(provider, null);
}
