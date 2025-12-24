import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchLikedTracks } from "@/lib/spotify";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tracks = await fetchLikedTracks(session.accessToken);
  return NextResponse.json({ tracks }, { headers: { "Cache-Control": "no-store" } });
}
