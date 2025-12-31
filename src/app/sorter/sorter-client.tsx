"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import LoadingModal from "../ui/loading-modal";
import SessionExpiredModal from "../ui/session-expired-modal";

type Playlist = {
  id: string;
  name: string;
  owner: string;
  total: number;
  image: string | null;
};

type PlaylistTrack = {
  id: string;
  name: string;
  artists: string;
  image: string | null;
};

function dedupePlaylistTracks(tracks: PlaylistTrack[]) {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

const PLAYLIST_CACHE_KEY = "sorted:playlistsCache";
const PLAYLIST_CACHE_AT_KEY = "sorted:playlistsCacheAt";
const PLAYLIST_RATE_LIMIT_AT_KEY = "sorted:playlistsRateLimitAt";
const PLAYLIST_CACHE_TTL_MS = 60_000;
const PLAYLIST_RATE_LIMIT_COOLDOWN_MS = 60_000;

export default function SorterClient() {
  const { status: authStatus } = useSession();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeTracks, setActiveTracks] = useState<PlaylistTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const progressRef = useRef(0);
  const progressTargetRef = useRef(0);
  const router = useRouter();

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      setSessionExpired(true);
      setIsLoading(false);
      return;
    }
    const now = Date.now();
    let cachedPlaylists: Playlist[] | null = null;
    let cachedAt = 0;
    let rateLimitedAt = 0;
    if (typeof window !== "undefined") {
      const cachedRaw = window.localStorage.getItem(PLAYLIST_CACHE_KEY);
      const cachedAtRaw = window.localStorage.getItem(PLAYLIST_CACHE_AT_KEY);
      const rateLimitedRaw = window.localStorage.getItem(
        PLAYLIST_RATE_LIMIT_AT_KEY
      );
      if (cachedRaw) {
        try {
          const parsed = JSON.parse(cachedRaw) as Playlist[];
          if (Array.isArray(parsed)) {
            cachedPlaylists = parsed;
          }
        } catch {
          cachedPlaylists = null;
        }
      }
      cachedAt = cachedAtRaw ? Number(cachedAtRaw) : 0;
      rateLimitedAt = rateLimitedRaw ? Number(rateLimitedRaw) : 0;
    }
    const hasCache = Boolean(cachedPlaylists?.length);
    const isFresh =
      hasCache && now - cachedAt < PLAYLIST_CACHE_TTL_MS;
    const inCooldown =
      rateLimitedAt > 0 &&
      now - rateLimitedAt < PLAYLIST_RATE_LIMIT_COOLDOWN_MS;
    if (hasCache) {
      setPlaylists(cachedPlaylists ?? []);
      setIsLoading(false);
    }
    if (isFresh || inCooldown) {
      return;
    }

    let isActive = true;
    let loadingComplete = false;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let nudgeInterval: ReturnType<typeof setInterval> | null = null;

    progressRef.current = 0;
    progressTargetRef.current = 0;
    if (!hasCache) {
      setLoadProgress(0);
    }

    const finalizeLoading = () => {
      if (!isActive) return;
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      if (nudgeInterval) {
        clearInterval(nudgeInterval);
        nudgeInterval = null;
      }
      setIsLoading(false);
    };

    const setTarget = (value: number) => {
      progressTargetRef.current = Math.min(
        100,
        Math.max(progressTargetRef.current, value)
      );
    };

    const startNudges = (cap: number) => {
      if (nudgeInterval) return;
      nudgeInterval = setInterval(() => {
        if (loadingComplete) return;
        if (progressTargetRef.current < cap) {
          progressTargetRef.current = Math.min(
            cap,
            progressTargetRef.current + 1
          );
        }
      }, 4000);
    };

    if (!hasCache) {
      tickInterval = setInterval(() => {
        setLoadProgress((prev) => {
          const target = progressTargetRef.current;
          if (prev >= target) {
            if (loadingComplete && prev >= 100) {
              finalizeLoading();
            }
            return prev;
          }
          const delta = target - prev;
          const step = Math.max(0.6, Math.min(4, delta * 0.25));
          const next = Math.min(target, prev + step);
          progressRef.current = next;
          if (loadingComplete && next >= 100) {
            finalizeLoading();
          }
          return next;
        });
      }, 200);
    }

    async function load() {
      try {
        if (!hasCache) {
          setTarget(8);
          startNudges(92);
        }
        const res = await fetch("/api/playlists", { cache: "no-store" });
        if (!hasCache) {
          setTarget(18);
        }
        if (!res.ok) {
          if (res.status === 401) {
            if (isActive) {
              setSessionExpired(true);
              setError(null);
              setIsLoading(false);
            }
            return;
          }
          if (res.status === 429) {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(
                PLAYLIST_RATE_LIMIT_AT_KEY,
                String(Date.now())
              );
            }
            if (hasCache) {
              return;
            }
          }
          const body = await res.text();
          throw new Error(body || `Request failed: ${res.status}`);
        }
        const data = (await res.json()) as { playlists: Playlist[] };
        if (isActive) setPlaylists(data.playlists);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            PLAYLIST_CACHE_KEY,
            JSON.stringify(data.playlists)
          );
          window.localStorage.setItem(
            PLAYLIST_CACHE_AT_KEY,
            String(Date.now())
          );
          window.localStorage.removeItem(PLAYLIST_RATE_LIMIT_AT_KEY);
        }
        if (!hasCache) {
          setTarget(90);
        }
      } catch (err) {
        if (isActive) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (isActive) {
          loadingComplete = true;
          if (!hasCache) {
            setTarget(100);
          }
        }
      }
    }
    load();
    return () => {
      isActive = false;
      loadingComplete = true;
      if (tickInterval) clearInterval(tickInterval);
      if (nudgeInterval) clearInterval(nudgeInterval);
    };
  }, [authStatus]);

  const selectedCount = selectedIds.length;
  const canSelectMore = selectedCount < 5;

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
        { id: data.playlist.id, name: data.playlist.name, owner: "You", total: 0, image: null },
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

  async function openPlaylist(playlistId: string) {
    setActivePlaylistId(playlistId);
    setTracksLoading(true);
    setTracksError(null);
    try {
      const res = await fetch(`/api/playlist-tracks?id=${playlistId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          setSessionExpired(true);
          setError(null);
          return;
        }
        const body = await res.text();
        throw new Error(body || `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as { tracks: PlaylistTrack[] };
      setActiveTracks(dedupePlaylistTracks(data.tracks));
    } catch (err) {
      setTracksError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setTracksLoading(false);
    }
  }

  let body: ReactNode = null;
  if (sessionExpired) {
    body = <SessionExpiredModal />;
  } else if (error) {
    body = (
      <p className="mt-4 text-sm text-red-600">Failed to load: {error}</p>
    );
  } else {
    body = (
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
          Selected {selectedCount}/5
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

      <div className="mt-6 max-h-[65vh] overflow-y-auto pr-2">
        <div className="grid gap-1">
          {playlists.map((playlist) => {
            const selected = selectedIds.includes(playlist.id);
            return (
              <div
                key={playlist.id}
                role="button"
                tabIndex={0}
                onClick={() => openPlaylist(playlist.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openPlaylist(playlist.id);
                  }
                }}
                className="playlist-row group flex cursor-pointer items-stretch justify-between gap-3 rounded-md pl-3 pr-0 text-sm overflow-hidden"
              >
                <div className="flex items-center gap-3 py-2">
                  <img
                    src={playlist.image ?? "/favicon.ico"}
                    alt={playlist.name}
                    className="h-10 w-10 rounded-md object-cover aspect-square"
                  />
                  <div>
                    <p className="font-medium">{playlist.name}</p>
                    <p className="text-xs text-neutral-500">
                      {playlist.owner} - {playlist.total} tracks
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`playlist-add relative min-w-[96px] self-stretch overflow-hidden rounded-r-md px-4 py-2 text-xs font-semibold transition ${
                    selected
                      ? "bg-emerald-500/90 text-white hover:bg-emerald-700"
                      : "bg-neutral-800/70 text-neutral-200 hover:bg-neutral-700"
                  } ${!selected && !canSelectMore ? "opacity-40" : ""} hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSelect(playlist.id);
                  }}
                  disabled={!selected && !canSelectMore}
                >
                  <span
                    className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
                      selected
                        ? "-translate-x-full opacity-0 text-neutral-200"
                        : "translate-x-0 opacity-100 text-neutral-200"
                    }`}
                  >
                    Add
                  </span>
                  <span
                    className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
                      selected
                        ? "translate-x-0 opacity-100 text-white"
                        : "translate-x-full opacity-0 text-white"
                    }`}
                  >
                    Added
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <div className="mt-4 text-xs text-neutral-500">
          {selectedIds
            .map((id) => playlistById.get(id)?.name)
            .filter(Boolean)
            .join(", ")}
        </div>
      ) : null}

      {activePlaylistId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-3xl rounded-xl bg-neutral-950 p-6 text-neutral-100 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {playlistById.get(activePlaylistId)?.name ?? "Playlist tracks"}
              </h2>
              <button
                className="text-sm text-neutral-400"
                onClick={() => setActivePlaylistId(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 max-h-[55vh] overflow-y-auto">
              {tracksLoading ? (
                <p className="text-sm text-neutral-400">Loading tracks...</p>
              ) : tracksError ? (
                <p className="text-sm text-red-400">
                  Failed to load tracks: {tracksError}
                </p>
              ) : activeTracks.length === 0 ? (
                <p className="text-sm text-neutral-400">No tracks found.</p>
              ) : (
                <div className="grid gap-3">
                  {activeTracks.map((track) => (
                    <div
                      key={track.id}
                      className="flex items-center gap-3 rounded-lg bg-neutral-900/70 px-3 py-2 transition hover:bg-neutral-800/80"
                    >
                      <img
                        src={track.image ?? "/favicon.ico"}
                        alt={track.name}
                        className="h-10 w-10 rounded-md object-cover aspect-square"
                      />
                      <div>
                        <p className="text-sm font-medium">{track.name}</p>
                        <p className="text-xs text-neutral-400">
                          {track.artists}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
    );
  }

  return (
    <>
      <LoadingModal
        message="Loading playlists..."
        progress={loadProgress}
        visible={isLoading && authStatus === "authenticated" && !sessionExpired}
      />
      {!isLoading ? body : null}
    </>
  );
}
