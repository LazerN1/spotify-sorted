"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import LoadingModal from "../ui/loading-modal";
import SessionExpiredModal from "../ui/session-expired-modal";

type TrackRow = {
  id: string;
  name: string;
  artists: string;
  image: string | null;
  popularity: number;
  savedAt: string;
  genres: string;
  playlists: { id: string; name: string; image: string | null }[];
  playlistCount: number;
};

export default function MeClient() {
  const { status: authStatus } = useSession();
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const progressRef = useRef(0);
  const progressTargetRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateMin, setDateMin] = useState(0);
  const [dateMax, setDateMax] = useState(0);
  const [popMin, setPopMin] = useState(0);
  const [popMax, setPopMax] = useState(100);
  const [playlistMin, setPlaylistMin] = useState(0);
  const [playlistMax, setPlaylistMax] = useState(0);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [genreOpen, setGenreOpen] = useState(false);
  const [sortKey, setSortKey] = useState<
    "song" | "artist" | "genres" | "savedAt" | "playlistCount" | "popularity"
  >("savedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const selectionKey = "sorted:selectedTracks";
  const [initialized, setInitialized] = useState(false);
  const unlabeledGenre = "__unlabeled__";
  const genreRef = useRef<HTMLDivElement | null>(null);
  const [displayTracks, setDisplayTracks] = useState<TrackRow[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rowGap = 4;
  const rowHeight = 72 + rowGap;
  const overscan = 6;
  const hasResetScrollRef = useRef(false);
  const manualSelectedRef = useRef<Set<string>>(new Set());
  const manualDeselectedRef = useRef<Set<string>>(new Set());

  function formatSavedAt(value: string) {
    if (!value) return "N/A";
    const date = new Date(value);
    const base = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const parts = base.split(" ");
    if (parts.length < 2) return base;
    if (!parts[0].endsWith(".")) {
      parts[0] = `${parts[0]}.`;
    }
    return parts.join(" ");
  }

  function formatDateLabel(value: number) {
    if (!value) return "N/A";
    return formatSavedAt(new Date(value).toISOString());
  }

  function formatDateInput(value: number) {
    if (!value) return "";
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDateInput(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function toggleTrack(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        manualSelectedRef.current.delete(id);
        manualDeselectedRef.current.add(id);
        return prev.filter((value) => value !== id);
      }
      manualDeselectedRef.current.delete(id);
      manualSelectedRef.current.add(id);
      return [...prev, id];
    });
  }

  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const track of tracks) {
      const parts = track.genres
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        set.add(part);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const allGenreOptions = useMemo(() => {
    return [...availableGenres, unlabeledGenre];
  }, [availableGenres, unlabeledGenre]);

  const dateBounds = useMemo(() => {
    const values = tracks
      .map((track) => new Date(track.savedAt).getTime())
      .filter((value) => !Number.isNaN(value));
    if (values.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [tracks]);

  const playlistBounds = useMemo(() => {
    if (tracks.length === 0) return { max: 0 };
    return { max: Math.max(...tracks.map((track) => track.playlistCount ?? 0)) };
  }, [tracks]);

  const popularityBounds = useMemo(() => {
    if (tracks.length === 0) return { min: 0, max: 100 };
    return {
      min: Math.min(...tracks.map((track) => track.popularity ?? 0)),
      max: Math.max(...tracks.map((track) => track.popularity ?? 0)),
    };
  }, [tracks]);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      setSessionExpired(true);
      setIsLoading(false);
      return;
    }
    let isActive = true;
    let loadingComplete = false;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let nudgeInterval: ReturnType<typeof setInterval> | null = null;

    progressRef.current = 0;
    progressTargetRef.current = 0;
    setLoadProgress(0);

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

    let nudgeCap = 0;
    const startNudges = (cap: number) => {
      nudgeCap = Math.max(nudgeCap, cap);
      if (nudgeInterval) return;
      nudgeInterval = setInterval(() => {
        if (loadingComplete) return;
        if (progressTargetRef.current < nudgeCap) {
          progressTargetRef.current = Math.min(
            nudgeCap,
            progressTargetRef.current + 1
          );
        }
      }, 4000);
    };

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

    async function load() {
      try {
        setTarget(5);
        startNudges(92);
        const res = await fetch("/api/liked-tracks?includePlaylists=1", {
          cache: "no-store",
        });
        setTarget(18);
        if (!res.ok) {
          if (res.status === 401) {
            if (isActive) {
              setSessionExpired(true);
              setError(null);
              setIsLoading(false);
            }
            return;
          }
          const body = await res.text();
          throw new Error(body || `Request failed: ${res.status}`);
        }
        const contentLength = res.headers.get("content-length");
        const total = contentLength ? Number(contentLength) : 0;
        let data: { tracks: TrackRow[] };
        if (res.body && total > 0) {
          setTarget(24);
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              const percent = Math.min(
                90,
                Math.round((received / total) * 90)
              );
              setTarget(percent);
            }
          }
          const merged = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          const text = new TextDecoder().decode(merged);
          data = JSON.parse(text) as { tracks: TrackRow[] };
        } else {
          setTarget(28);
          data = (await res.json()) as { tracks: TrackRow[] };
        }
        setTarget(78);
        if (isActive) {
          setTracks(data.tracks);
        }
        setTarget(94);
      } catch (err) {
        if (isActive) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (isActive) {
          loadingComplete = true;
          setTarget(100);
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

  useEffect(() => {
    if (!tracks.length || initialized) return;
    setDateMin(dateBounds.min);
    setDateMax(dateBounds.max);
    setPopMin(popularityBounds.min);
    setPopMax(popularityBounds.max);
    setPlaylistMin(0);
    setPlaylistMax(playlistBounds.max);

    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(selectionKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as string[];
          const valid = parsed.filter((id) =>
            tracks.some((track) => track.id === id)
          );
          setSelectedIds(valid);
        } catch {
          setSelectedIds(tracks.map((track) => track.id));
        }
      } else {
        setSelectedIds(tracks.map((track) => track.id));
      }
    } else {
      setSelectedIds(tracks.map((track) => track.id));
    }
    setInitialized(true);
  }, [
    tracks,
    initialized,
    dateBounds,
    popularityBounds,
    playlistBounds,
    selectionKey,
  ]);

  const rawFilters = useMemo(
    () => ({
      dateMin,
      dateMax,
      popMin,
      popMax,
      playlistMin,
      playlistMax,
      selectedGenres,
    }),
    [
      dateMin,
      dateMax,
      popMin,
      popMax,
      playlistMin,
      playlistMax,
      selectedGenres,
    ]
  );

  const deferredFilters = useDeferredValue(rawFilters);

  const sortedBaseTracks = useMemo(() => {
    const list = [...tracks];
    const direction = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "song") {
        return a.name.localeCompare(b.name) * direction;
      }
      if (sortKey === "artist") {
        return a.artists.localeCompare(b.artists) * direction;
      }
      if (sortKey === "genres") {
        return a.genres.localeCompare(b.genres) * direction;
      }
      if (sortKey === "playlistCount") {
        return (a.playlistCount - b.playlistCount) * direction;
      }
      if (sortKey === "popularity") {
        return (a.popularity - b.popularity) * direction;
      }
      const aDate = new Date(a.savedAt).getTime();
      const bDate = new Date(b.savedAt).getTime();
      return (aDate - bDate) * direction;
    });
    return list;
  }, [tracks, sortKey, sortDir]);

  const filteredIds = useMemo(() => {
    if (!tracks.length) return [];
    const {
      dateMin: minDate,
      dateMax: maxDate,
      popMin: minPop,
      popMax: maxPop,
      playlistMin: minPlaylists,
      playlistMax: maxPlaylists,
      selectedGenres: genreFilters,
    } = deferredFilters;
    return tracks
      .filter((track) => {
        const savedAt = new Date(track.savedAt).getTime();
        if (minDate && savedAt && savedAt < minDate) return false;
        if (maxDate && savedAt && savedAt > maxDate) return false;
        if (track.popularity < minPop || track.popularity > maxPop) return false;
        if (
          track.playlistCount < minPlaylists ||
          track.playlistCount > maxPlaylists
        ) {
          return false;
        }
        if (genreFilters.length > 0) {
          const trackGenres = track.genres
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
          const wantsUnlabeled = genreFilters.includes(unlabeledGenre);
          const hasGenre = genreFilters.some((genre) => {
            if (genre === unlabeledGenre) return false;
            return trackGenres.includes(genre);
          });
          if (!hasGenre && !(wantsUnlabeled && trackGenres.length === 0)) {
            return false;
          }
        }
        return true;
      })
      .map((track) => track.id);
  }, [
    tracks,
    deferredFilters,
    unlabeledGenre,
  ]);

  useEffect(() => {
    if (!initialized) return;
    const selectedSet = new Set(filteredIds);
    for (const id of manualSelectedRef.current) {
      selectedSet.add(id);
    }
    for (const id of manualDeselectedRef.current) {
      selectedSet.delete(id);
    }
    const next = Array.from(selectedSet);
    const current = selectedIdsRef.current;
    if (current.length === next.length && current.every((id) => selectedSet.has(id))) {
      setDisplayTracks([
        ...sortedBaseTracks.filter((track) => selectedSet.has(track.id)),
        ...sortedBaseTracks.filter((track) => !selectedSet.has(track.id)),
      ]);
      return;
    }
    setSelectedIds(next);
    setDisplayTracks([
      ...sortedBaseTracks.filter((track) => selectedSet.has(track.id)),
      ...sortedBaseTracks.filter((track) => !selectedSet.has(track.id)),
    ]);
  }, [filteredIds, initialized, sortedBaseTracks]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(selectionKey, JSON.stringify(selectedIds));
  }, [selectedIds, selectionKey]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const updateHeight = () => {
      setViewportHeight(node.clientHeight);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    setViewportHeight(node.clientHeight);
    setScrollTop(node.scrollTop);
  }, [displayTracks.length, filtersOpen]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!genreRef.current) return;
      if (
        event.target instanceof Node &&
        !genreRef.current.contains(event.target)
      ) {
        setGenreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!displayTracks.length || hasResetScrollRef.current) return;
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = 0;
    setScrollTop(0);
    hasResetScrollRef.current = true;
  }, [displayTracks.length]);

  const visibleRange = useMemo(() => {
    if (!displayTracks.length) return { start: 0, end: 0 };
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(
      displayTracks.length,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
    );
    return { start, end };
  }, [displayTracks.length, scrollTop, viewportHeight, rowHeight, overscan]);

  const visibleTracks = useMemo(
    () => displayTracks.slice(visibleRange.start, visibleRange.end),
    [displayTracks, visibleRange]
  );

  const totalHeight = displayTracks.length * rowHeight;
  const offsetY = visibleRange.start * rowHeight;

  let body: ReactNode = null;
  if (sessionExpired) {
    body = <SessionExpiredModal />;
  } else if (error) {
    body = (
      <p className="mt-2 text-sm text-red-600">
        Failed to load tracks: {error}
      </p>
    );
  } else {
    body = (
      <>
        <div className="mt-2 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-400">{tracks.length} tracks</p>
          <p className="text-xs text-neutral-500">
            Selected {selectedIds.length}
          </p>
        </div>
        <Link
          href="/sorter"
          className="btn-link rounded-md bg-black px-3 py-1 text-sm text-white"
        >
          Go to Sorter
        </Link>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          className="rounded-full border border-neutral-700 bg-neutral-900/70 px-4 py-1 text-xs text-neutral-200"
          onClick={() => setFiltersOpen((prev) => !prev)}
        >
          Filters
        </button>
      </div>

      <div
        className="filters-panel"
        style={{
          maxHeight: filtersOpen ? "800px" : "0px",
          opacity: filtersOpen ? 1 : 0,
          transform: filtersOpen ? "translateY(0)" : "translateY(-8px)",
          marginTop: filtersOpen ? "16px" : "0px",
        }}
        aria-hidden={!filtersOpen}
      >
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-200">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-neutral-800/80 bg-neutral-900/60 p-4">
              <p className="text-xs text-neutral-400">Date saved</p>
              <p className="mt-2 text-xs text-neutral-300">
                {formatDateLabel(dateMin)} - {formatDateLabel(dateMax)}
              </p>
              <div
                className="range-wrap mt-3"
                style={{
                  ["--range-start" as string]: `${
                    dateBounds.max === dateBounds.min
                      ? 0
                      : ((dateMin - dateBounds.min) /
                          (dateBounds.max - dateBounds.min)) *
                        100
                  }%`,
                  ["--range-end" as string]: `${
                    dateBounds.max === dateBounds.min
                      ? 100
                      : ((dateMax - dateBounds.min) /
                          (dateBounds.max - dateBounds.min)) *
                        100
                  }%`,
                }}
              >
                <input
                  type="range"
                  min={dateBounds.min}
                  max={dateBounds.max}
                  value={dateMin}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDateMin(Math.min(value, dateMax));
                  }}
                  className="range-min"
                />
                <input
                  type="range"
                  min={dateBounds.min}
                  max={dateBounds.max}
                  value={dateMax}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDateMax(Math.max(value, dateMin));
                  }}
                  className="range-max"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-300">
                <label className="flex flex-col gap-1">
                  <span>From</span>
                  <input
                    type="date"
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                    value={formatDateInput(dateMin)}
                    min={formatDateInput(dateBounds.min)}
                    max={formatDateInput(dateBounds.max)}
                    onChange={(event) => {
                      const value = parseDateInput(event.target.value);
                      if (!value) return;
                      setDateMin(Math.min(value, dateMax));
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span>To</span>
                  <input
                    type="date"
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                    value={formatDateInput(dateMax)}
                    min={formatDateInput(dateBounds.min)}
                    max={formatDateInput(dateBounds.max)}
                    onChange={(event) => {
                      const value = parseDateInput(event.target.value);
                      if (!value) return;
                      setDateMax(Math.max(value, dateMin));
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800/80 bg-neutral-900/60 p-4">
              <p className="text-xs text-neutral-400">Genres</p>
              <div className="relative mt-3" ref={genreRef}>
                <button
                  className="w-full rounded-md border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-left text-xs text-neutral-200"
                  onClick={() => setGenreOpen((prev) => !prev)}
                  >
                  {selectedGenres.length === 0
                    ? "All genres"
                    : selectedGenres.length === allGenreOptions.length
                    ? "All genres"
                    : `${selectedGenres.length} selected`}
                  </button>
                {genreOpen ? (
                  <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-52 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs">
                    {availableGenres.length === 0 ? (
                      <p className="px-2 py-2 text-neutral-400">
                        No genres found
                      </p>
                    ) : (
                      <>
                        <label className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-900/60">
                          <input
                            type="checkbox"
                            checked={selectedGenres.length === allGenreOptions.length}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedGenres(allGenreOptions);
                              } else {
                                setSelectedGenres([]);
                              }
                            }}
                          />
                          <span>All genres</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-900/60">
                          <input
                            type="checkbox"
                            checked={selectedGenres.includes(unlabeledGenre)}
                            onChange={() => {
                              setSelectedGenres((prev) => {
                                if (prev.includes(unlabeledGenre)) {
                                  return prev.filter((value) => value !== unlabeledGenre);
                                }
                                return [...prev, unlabeledGenre];
                              });
                            }}
                          />
                          <span>Unlabeled</span>
                        </label>
                        <div className="my-2 h-px bg-neutral-800" />
                        {availableGenres.map((genre) => {
                          const checked = selectedGenres.includes(genre);
                          return (
                            <label
                              key={genre}
                              className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-900/60"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedGenres((prev) => {
                                    if (prev.includes(genre)) {
                                      return prev.filter((value) => value !== genre);
                                    }
                                    return [...prev, genre];
                                  });
                                }}
                              />
                              <span>{genre}</span>
                            </label>
                          );
                        })}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800/80 bg-neutral-900/60 p-4">
              <p className="text-xs text-neutral-400">Playlists per song</p>
              <p className="mt-2 text-xs text-neutral-300">
                {playlistMin} - {playlistMax}
              </p>
              <div
                className="range-wrap mt-3"
                style={{
                  ["--range-start" as string]: `${
                    playlistBounds.max === 0
                      ? 0
                      : (playlistMin / playlistBounds.max) * 100
                  }%`,
                  ["--range-end" as string]: `${
                    playlistBounds.max === 0
                      ? 100
                      : (playlistMax / playlistBounds.max) * 100
                  }%`,
                }}
              >
                <input
                  type="range"
                  min={0}
                  max={playlistBounds.max}
                  value={playlistMin}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setPlaylistMin(Math.min(value, playlistMax));
                  }}
                  className="range-min"
                />
                <input
                  type="range"
                  min={0}
                  max={playlistBounds.max}
                  value={playlistMax}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setPlaylistMax(Math.max(value, playlistMin));
                  }}
                  className="range-max"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-300">
                <label className="flex flex-col gap-1">
                  <span>Min</span>
                  <input
                    type="number"
                    min={0}
                    max={playlistBounds.max}
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                    value={playlistMin}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setPlaylistMin(Math.min(value, playlistMax));
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span>Max</span>
                  <input
                    type="number"
                    min={0}
                    max={playlistBounds.max}
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                    value={playlistMax}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setPlaylistMax(Math.max(value, playlistMin));
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800/80 bg-neutral-900/60 p-4">
              <p className="text-xs text-neutral-400">Popularity</p>
              <p className="mt-2 text-xs text-neutral-300">
                {popMin} - {popMax}
              </p>
              <div
                className="range-wrap mt-3"
                style={{
                  ["--range-start" as string]: `${
                    popularityBounds.max === popularityBounds.min
                      ? 0
                      : ((popMin - popularityBounds.min) /
                          (popularityBounds.max - popularityBounds.min)) *
                        100
                  }%`,
                  ["--range-end" as string]: `${
                    popularityBounds.max === popularityBounds.min
                      ? 100
                      : ((popMax - popularityBounds.min) /
                          (popularityBounds.max - popularityBounds.min)) *
                        100
                  }%`,
                }}
              >
                <input
                  type="range"
                  min={popularityBounds.min}
                  max={popularityBounds.max}
                  value={popMin}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setPopMin(Math.min(value, popMax));
                  }}
                  className="range-min"
                />
                <input
                  type="range"
                  min={popularityBounds.min}
                  max={popularityBounds.max}
                  value={popMax}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setPopMax(Math.max(value, popMin));
                  }}
                  className="range-max"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-300">
                <label className="flex flex-col gap-1">
                  <span>Min</span>
                  <input
                    type="number"
                    min={popularityBounds.min}
                    max={popularityBounds.max}
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                    value={popMin}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setPopMin(Math.min(value, popMax));
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span>Max</span>
                  <input
                    type="number"
                    min={popularityBounds.min}
                    max={popularityBounds.max}
                    className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                    value={popMax}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setPopMax(Math.max(value, popMin));
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-xs text-neutral-400">
        <span>Sort by</span>
        <select
          className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
          value={sortKey}
          onChange={(event) =>
            setSortKey(event.target.value as typeof sortKey)
          }
        >
          <option value="song">Song</option>
          <option value="artist">Artist</option>
          <option value="genres">Genres</option>
          <option value="savedAt">Date saved</option>
          <option value="playlistCount">Playlists</option>
          <option value="popularity">Popularity</option>
        </select>
        <button
          className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
          onClick={() =>
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
          }
        >
          {sortDir === "asc" ? "Asc" : "Desc"}
        </button>
      </div>

      <div
        className="mt-4 max-h-[65vh] overflow-y-auto pr-2"
        ref={listRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="sticky top-0 z-10 border-b border-neutral-800/70 bg-neutral-950 text-xs text-neutral-400">
          <div className="songs-grid px-2 py-2">
            <div></div>
            <div>Song</div>
            <div>Artist</div>
            <div>Genres</div>
            <div>Popularity</div>
            <div>Saved</div>
            <div>Playlists</div>
            <div className="text-right">Select</div>
          </div>
        </div>
        <div className="relative" style={{ height: totalHeight }}>
          <div className="absolute left-0 right-0" style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleTracks.map((t) => {
              const isSelected = selectedSet.has(t.id);
              return (
                <div
                  key={t.id}
                  style={{ height: rowHeight }}
                >
                  <div
                    className="songs-grid songs-row px-2 text-sm text-neutral-200 hover:bg-neutral-900/60"
                    style={{ height: rowHeight - rowGap }}
                  >
                    <div className="flex items-center">
                      <img
                        src={t.image ?? "/favicon.ico"}
                        alt={t.name}
                        loading="lazy"
                        decoding="async"
                        className="h-10 w-10 rounded-md object-cover aspect-square"
                      />
                    </div>
                    <div className="truncate">{t.name}</div>
                    <div className="truncate text-neutral-300">{t.artists}</div>
                    <div className="truncate text-neutral-300">
                      {t.genres || "None"}
                    </div>
                    <div className="text-neutral-300">{t.popularity}</div>
                    <div className="whitespace-nowrap text-neutral-300">
                      {formatSavedAt(t.savedAt)}
                    </div>
                    <div>
                      {t.playlists.length === 0 ? (
                        <span className="text-xs text-neutral-500">None</span>
                      ) : (
                        <div className="flex items-center">
                          {t.playlists.slice(0, 3).map((playlist, index) => (
                            <div
                              key={`${t.id}-${playlist.id}`}
                              className={`group relative ${
                                index === 0 ? "" : "-ml-2"
                              }`}
                            >
                              <img
                                src={playlist.image ?? "/favicon.ico"}
                                alt={playlist.name}
                                loading="lazy"
                                decoding="async"
                                className="h-7 w-7 rounded-full border border-neutral-900 object-cover"
                              />
                              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-neutral-200/90 px-2 py-0.5 text-[10px] text-neutral-900 opacity-0 transition group-hover:opacity-100">
                                {playlist.name}
                              </span>
                            </div>
                          ))}
                          {t.playlists.length > 3 ? (
                            <span className="group relative ml-2 text-xs text-neutral-500">
                              +{t.playlists.length - 3}
                              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-neutral-200/90 px-2 py-0.5 text-[10px] text-neutral-900 opacity-0 transition group-hover:opacity-100">
                                {t.playlists
                                  .slice(3)
                                  .map((playlist) => playlist.name)
                                  .join(", ")}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className="flex items-stretch justify-end self-stretch">
                      <button
                        type="button"
                        className={`playlist-add relative min-w-[96px] self-stretch overflow-hidden rounded-r-md px-4 py-2 text-xs font-semibold transition hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] ${
                          isSelected
                            ? "bg-emerald-500/90 text-white hover:bg-emerald-700"
                            : "bg-neutral-800/70 text-neutral-200 hover:bg-neutral-700"
                        }`}
                        onClick={() => toggleTrack(t.id)}
                      >
                        <span
                          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
                            isSelected
                              ? "-translate-x-full opacity-0 text-neutral-200"
                              : "translate-x-0 opacity-100 text-neutral-200"
                          }`}
                        >
                          Add
                        </span>
                        <span
                          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
                            isSelected
                              ? "translate-x-0 opacity-100 text-white"
                              : "translate-x-full opacity-0 text-white"
                          }`}
                        >
                          Added
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
    );
  }

  return (
    <>
      <LoadingModal
        message="Loading your liked songs..."
        progress={loadProgress}
        visible={isLoading && authStatus === "authenticated" && !sessionExpired}
      />
      {!isLoading ? body : null}
    </>
  );
}
