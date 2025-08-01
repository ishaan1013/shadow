import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");

    // Forward request to backend server
    const backendUrl = `${process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000"}/api/context/usage/${taskId}${model ? `?model=${encodeURIComponent(model)}` : ""}`;
    
    const response = await fetch(backendUrl);
    
    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch context usage" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error proxying context usage request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}