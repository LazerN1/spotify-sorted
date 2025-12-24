import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchMostRecentLikedTrack } from "@/lib/spotify";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const track = await fetchMostRecentLikedTrack(session.accessToken);
  return NextResponse.json({ track }, { headers: { "Cache-Control": "no-store" } });
}
