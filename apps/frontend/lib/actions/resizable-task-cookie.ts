"use server";

import { cookies } from "next/headers";
import { RESIZABLE_TASK_COOKIE_NAMES, ResizableTaskCookieName } from "../constants";

export async function saveResizableTaskLayoutCookie(
  cookieName: ResizableTaskCookieName,
  layout: number[]
) {
  const cookieStore = await cookies();

  cookieStore.set(RESIZABLE_TASK_COOKIE_NAMES[cookieName], JSON.stringify(layout), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
