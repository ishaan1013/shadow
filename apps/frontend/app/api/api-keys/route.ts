import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();
    
    const openaiKey = cookieStore.get("openai-key")?.value || "";
    const anthropicKey = cookieStore.get("anthropic-key")?.value || "";

    return NextResponse.json({
      openai: openaiKey,
      anthropic: anthropicKey,
    });
  } catch (error) {
    console.error("API Keys GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch API keys" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { provider, key } = await request.json();

    if (!provider || !["openai", "anthropic"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Must be 'openai' or 'anthropic'" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const cookieName = `${provider}-key`;

    if (key) {
      // Save key
      cookieStore.set(cookieName, key, {
        httpOnly: false, // Allow client-side access for this use case
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    } else {
      // Clear key
      cookieStore.delete(cookieName);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API Keys POST error:", error);
    return NextResponse.json(
      { error: "Failed to save API key" },
      { status: 500 }
    );
  }
}