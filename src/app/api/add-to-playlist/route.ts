import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { addTrackToPlaylist } from "@/lib/spotify";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    playlistId?: string;
    trackUri?: string;
  };
  if (!body.playlistId || !body.trackUri) {
    return NextResponse.json(
      { error: "playlistId and trackUri are required" },
      { status: 400 }
    );
  }

  await addTrackToPlaylist(session.accessToken, body.playlistId, body.trackUri);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
