"use server";

import { cookies } from "next/headers";

export async function getInitialLayoutCookie(): Promise<number[] | null> {
  const cookieStore = await cookies();
  const taskLayoutCookie = cookieStore.get("resizable-task-layout");

  if (taskLayoutCookie?.value) {
    try {
      return JSON.parse(taskLayoutCookie.value);
    } catch {
      return null;
    }
  }

  return null;
}