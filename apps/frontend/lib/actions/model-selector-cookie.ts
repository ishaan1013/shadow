"use server";

import { cookies } from "next/headers";
import type { ModelType } from "@repo/types";
import { MODEL_SELECTOR_COOKIE_NAME } from "../constants";

export async function saveModelSelectorCookie(model: ModelType | null) {
  const cookieStore = await cookies();

  if (model) {
    cookieStore.set(MODEL_SELECTOR_COOKIE_NAME, model, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    });
  } else {
    cookieStore.delete(MODEL_SELECTOR_COOKIE_NAME);
  }
}

export async function getModelSelectorCookie(): Promise<ModelType | null> {
  const cookieStore = await cookies();
  const modelSelectorCookie = cookieStore.get(MODEL_SELECTOR_COOKIE_NAME);

  if (modelSelectorCookie?.value) {
    // Return the model string as-is, validation will happen elsewhere
    return modelSelectorCookie.value as ModelType;
  }

  return null;
}

export async function deleteModelSelectorCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(MODEL_SELECTOR_COOKIE_NAME);
}