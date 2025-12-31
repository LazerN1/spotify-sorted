import { NextResponse } from "next/server";

type TrackInput = {
  id: string;
  name: string;
  artist?: string;
};

type FinderResult = {
  success: boolean;
  results: { previewUrls: string[] }[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tracks?: TrackInput[] };
    const tracks = body.tracks ?? [];
    if (tracks.length === 0) {
      return NextResponse.json({ error: "Missing tracks" }, { status: 400 });
    }
    if (tracks.length > 20) {
      return NextResponse.json(
        { error: "Too many tracks" },
        { status: 400 }
      );
    }

    const module = await import("spotify-preview-finder");
    const spotifyPreviewFinder = (module.default ?? module) as (
      songName: string,
      artistOrLimit?: string | number,
      limit?: number
    ) => Promise<FinderResult>;

    const previews: Record<string, string | null> = {};
    for (const track of tracks) {
      const result = track.artist
        ? await spotifyPreviewFinder(track.name, track.artist, 1)
        : await spotifyPreviewFinder(track.name, 1);
      const preview =
        result.success && result.results[0]?.previewUrls?.[0]
          ? result.results[0].previewUrls[0]
          : null;
      previews[track.id] = preview;
    }

    return NextResponse.json({ previews });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message || "Failed to load previews" },
      { status: 500 }
    );
  }
}
