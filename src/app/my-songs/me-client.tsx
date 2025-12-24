"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type TrackRow = {
  id: string;
  name: string;
  artists: string;
};

export default function MeClient() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function load() {
      try {
        const res = await fetch("/api/liked-tracks", {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `Request failed: ${res.status}`);
        }
        const data = (await res.json()) as { tracks: TrackRow[] };
        if (isActive) {
          setTracks(data.tracks);
        }
      } catch (err) {
        if (isActive) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    load();
    return () => {
      isActive = false;
    };
  }, []);

  if (isLoading) {
    return <p className="mt-2 text-sm text-neutral-600">Loading…</p>;
  }

  if (error) {
    return (
      <p className="mt-2 text-sm text-red-600">
        Failed to load tracks: {error}
      </p>
    );
  }

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm text-neutral-600">{tracks.length} tracks</p>
        <Link
          href="/sorter"
          className="rounded-md bg-black px-3 py-1 text-sm text-white"
        >
          Go to Sorter
        </Link>
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Song</th>
              <th className="py-2 pr-4">Artist</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="py-2 pr-4">{t.name}</td>
                <td className="py-2 pr-4">{t.artists}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
