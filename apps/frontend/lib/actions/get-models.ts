"use server";

import { ModelInfo } from "@repo/types";

export async function getModels(): Promise<ModelInfo[]> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const response = await fetch(`${baseUrl}/api/models`);
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