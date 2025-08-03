"use server";

import { ModelInfo } from "@repo/types";

import { headers } from "next/headers";

export async function getModels(): Promise<ModelInfo[]> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";

    // Forward cookies from the original request
    const requestHeaders = await headers();
    const cookieHeader = requestHeaders.get("cookie");

    const response = await fetch(`${baseUrl}/api/models`, {
      headers: {
        ...(cookieHeader && { Cookie: cookieHeader }),
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.models;
  } catch (error) {
    console.error("Error fetching models:", error);
    return [];
  }
}
