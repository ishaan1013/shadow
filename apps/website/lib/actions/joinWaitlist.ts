"use server";

import redis from "@/lib/redis";
import { cookies } from "next/headers";

export async function joinWaitlist(email: string) {
  const cookieStore = await cookies();

  cookieStore.set("joined-waitlist", "true");
  await redis.sadd("waitlist", email);
}
