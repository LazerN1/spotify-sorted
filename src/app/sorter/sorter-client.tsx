"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Playlist = {
  id: string;
  name: string;
  owner: string;
  total: number;
};

export default function SorterClient() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const router = useRouter();

  useEffect(() => {
    let isActive = true;
    async function load() {
      try {
        const res = await fetch("/api/playlists", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `Request failed: ${res.status}`);
        }
        const data = (await res.json()) as { playlists: Playlist[] };
        if (isActive) setPlaylists(data.playlists);
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

  const selectedCount = selectedIds.length;
  const canSelectMore = selectedCount < 6;

  const playlistById = useMemo(() => {
    return new Map(playlists.map((p) => [p.id, p]));
  }, [playlists]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      if (!canSelectMore) return prev;
      return [...prev, id];
    });
  }

  async function createNewPlaylist() {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as { playlist: { id: string; name: string } };
      setPlaylists((prev) => [
        { id: data.playlist.id, name: data.playlist.name, owner: "You", total: 0 },
        ...prev,
      ]);
      setNewName("");
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function goToSorter() {
    if (selectedIds.length === 0) return;
    router.push(`/sorter/play?ids=${selectedIds.join(",")}`);
  }

  if (isLoading) {
    return <p className="mt-4 text-sm text-neutral-600">Loading playlists...</p>;
  }

  if (error) {
    return (
      <p className="mt-4 text-sm text-red-600">Failed to load: {error}</p>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <button
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm"
          onClick={() => setIsCreating(true)}
        >
          Create new playlist
        </button>
        <button
          className="rounded-md bg-black px-4 py-1 text-sm text-white disabled:opacity-40"
          onClick={goToSorter}
          disabled={selectedIds.length === 0}
        >
          Go
        </button>
        <span className="text-xs text-neutral-500">
          Selected {selectedCount}/6
        </span>
      </div>

      {isCreating ? (
        <div className="mt-4 rounded-md border border-neutral-300 p-3">
          <p className="text-sm font-medium">New playlist name</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-1 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My new playlist"
            />
            <button
              className="rounded-md bg-black px-3 py-1 text-sm text-white"
              onClick={createNewPlaylist}
            >
              Create
            </button>
            <button
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm"
              onClick={() => setIsCreating(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-2">
        {playlists.map((playlist) => {
          const selected = selectedIds.includes(playlist.id);
          return (
            <label
              key={playlist.id}
              className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm ${
                selected ? "border-black" : "border-neutral-200"
              }`}
            >
              <div>
                <p className="font-medium">{playlist.name}</p>
                <p className="text-xs text-neutral-500">
                  {playlist.owner} • {playlist.total} tracks
                </p>
              </div>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleSelect(playlist.id)}
                disabled={!selected && !canSelectMore}
              />
            </label>
          );
        })}
      </div>

      {selectedIds.length > 0 ? (
        <div className="mt-4 text-xs text-neutral-500">
          {selectedIds
            .map((id) => playlistById.get(id)?.name)
            .filter(Boolean)
            .join(", ")}
        </div>
      ) : null}
    </div>
  );
}
