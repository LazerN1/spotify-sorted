"use client";

import { useEffect, useMemo, useState } from "react";

type Playlist = {
  id: string;
  name: string;
};

type Track = {
  id: string;
  name: string;
  artists: string;
  image: string | null;
  uri: string;
};

const positions = [
  { top: "8%", left: "10%" },
  { top: "8%", right: "10%" },
  { top: "40%", left: "4%" },
  { top: "40%", right: "4%" },
  { bottom: "8%", left: "15%" },
  { bottom: "8%", right: "15%" },
];

export default function SorterPlayClient({ ids }: { ids: string }) {
  const [track, setTrack] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => ids.split(",").map((id) => id.trim()).filter(Boolean),
    [ids]
  );

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [trackRes, playlistsRes] = await Promise.all([
          fetch("/api/recent-track", { cache: "no-store" }),
          fetch("/api/playlists", { cache: "no-store" }),
        ]);
        if (!trackRes.ok || !playlistsRes.ok) {
          throw new Error("Failed to load sorter data");
        }
        const trackData = (await trackRes.json()) as { track: Track | null };
        const playlistsData = (await playlistsRes.json()) as {
          playlists: Playlist[];
        };
        const filtered = playlistsData.playlists.filter((p) =>
          selectedIds.includes(p.id)
        );
        if (active) {
          setTrack(trackData.track);
          setPlaylists(filtered);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [selectedIds]);

  async function handleDrop(playlistId: string) {
    if (!track) return;
    setStatus("Adding to playlist...");
    try {
      const res = await fetch("/api/add-to-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId, trackUri: track.uri }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "Failed to add track");
      }
      setStatus("Added!");
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  if (error) {
    return <p className="mt-4 text-sm text-red-600">{error}</p>;
  }

  if (!track) {
    return <p className="mt-4 text-sm text-neutral-600">Loading track...</p>;
  }

  return (
    <div className="relative mt-8 h-[70vh] rounded-xl border border-neutral-200 bg-white">
      {playlists.map((playlist, index) => (
        <div
          key={playlist.id}
          className="absolute flex h-24 w-24 items-center justify-center rounded-full border border-neutral-300 bg-neutral-50 text-center text-xs font-medium shadow-sm"
          style={positions[index] ?? { top: "45%", left: "45%" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(playlist.id)}
        >
          {playlist.name}
        </div>
      ))}

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="text-center">
          <p className="text-sm text-neutral-500">Most recent liked</p>
          <p className="text-base font-semibold">{track.name}</p>
          <p className="text-sm text-neutral-600">{track.artists}</p>
        </div>
        <img
          src={track.image ?? "/favicon.ico"}
          alt={track.name}
          className="h-48 w-48 cursor-grab rounded-xl object-cover shadow-lg"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", track.uri)}
        />
        {status ? (
          <p className="text-xs text-neutral-500">{status}</p>
        ) : null}
      </div>
    </div>
  );
}
