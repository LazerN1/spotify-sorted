import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchPlaylistTracks } from "@/lib/spotify";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const playlistId = searchParams.get("id");
  if (!playlistId) {
    return NextResponse.json({ error: "Missing playlist id" }, { status: 400 });
  }

  try {
    const tracks = await fetchPlaylistTracks(session.accessToken, playlistId);
    return NextResponse.json(
      { tracks },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("401") || message.toLowerCase().includes("token")) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to load playlist tracks" },
      { status: 500 }
    );
  }
}
