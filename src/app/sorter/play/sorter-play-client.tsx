"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import LoadingModal from "../../ui/loading-modal";
import SessionExpiredModal from "../../ui/session-expired-modal";

type Playlist = {
  id: string;
  name: string;
  image: string | null;
};

type PlaylistTrack = {
  id: string;
  name: string;
  artists: string;
  image: string | null;
};

type Track = {
  id: string;
  name: string;
  artists: string;
  image: string | null;
  uri: string;
  popularity?: number;
  savedAt?: string;
  genres?: string;
  playlistCount?: number;
};

type DragState = {
  active: boolean;
  deltaX: number;
  deltaY: number;
  startX: number;
  startY: number;
};

type SortedItem = {
  track: Track;
  playlistId: string;
  playlistName: string;
};

type PendingAdd = {
  track: Track;
  playlistId: string;
};

type KeyAnimation = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  image: string | null;
  targetType: "playlist" | "skip" | "undo";
  playlistId?: string;
  track: Track;
  action: "add" | "undo";
};

type SortKey =
  | "song"
  | "artist"
  | "genres"
  | "savedAt"
  | "playlistCount"
  | "popularity";

type SortDir = "asc" | "desc";

type KeyConfig = {
  leftTop: string;
  leftBottom: string;
  rightTop: string;
  rightBottom: string;
  bottom: string;
  skip: string;
};

const DEFAULT_KEYS: KeyConfig = {
  leftTop: "Q",
  leftBottom: "A",
  rightTop: "E",
  rightBottom: "D",
  bottom: "S",
  skip: "W",
};

const SETTINGS_KEY = "sorted:sorterSettings";

const PLAYLIST_CACHE_KEY = "sorted:playlistsCache";
const PLAYLIST_CACHE_AT_KEY = "sorted:playlistsCacheAt";
const PLAYLIST_RATE_LIMIT_AT_KEY = "sorted:playlistsRateLimitAt";
const PLAYLIST_CACHE_TTL_MS = 60_000;
const PLAYLIST_RATE_LIMIT_COOLDOWN_MS = 60_000;

function distributePlaylists(playlists: Playlist[]) {
  const left: Playlist[] = [];
  const right: Playlist[] = [];
  const bottom: Playlist[] = [];

  const count = playlists.length;
  const targets = {
    left: 0,
    right: 0,
    bottom: 0,
  };

  if (count === 1) {
    targets.left = 1;
  } else if (count === 2) {
    targets.left = 1;
    targets.right = 1;
  } else if (count === 3) {
    targets.left = 1;
    targets.right = 1;
    targets.bottom = 1;
  } else if (count === 4) {
    targets.left = 1;
    targets.right = 1;
    targets.bottom = 2;
  } else {
    targets.left = 2;
    targets.right = 2;
    targets.bottom = Math.max(0, count - 4);
  }

  for (const playlist of playlists) {
    if (left.length < targets.left) {
      left.push(playlist);
    } else if (right.length < targets.right) {
      right.push(playlist);
    } else {
      bottom.push(playlist);
    }
  }

  return { left, right, bottom };
}

function pointInRect(x: number, y: number, rect: DOMRect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function buildKeyMapByLayout(
  left: Playlist[],
  right: Playlist[],
  bottom: Playlist[],
  count: number,
  keys: KeyConfig
) {
  const map = new Map<string, string>();
  const addKey = (key: string, playlist?: Playlist) => {
    if (!playlist) return;
    const normalized = normalizeKeyValue(key);
    if (!normalized) return;
    map.set(normalized, playlist.id);
  };

  if (count === 1) {
    addKey(keys.leftBottom, left[0]);
  } else if (count === 2) {
    addKey(keys.leftBottom, left[0]);
    addKey(keys.rightBottom, right[0]);
  } else if (count === 3) {
    addKey(keys.leftBottom, left[0]);
    addKey(keys.rightBottom, right[0]);
    addKey(keys.bottom, bottom[0]);
  } else if (count === 4) {
    addKey(keys.leftBottom, left[0]);
    addKey(keys.rightBottom, right[0]);
    addKey(keys.bottom, bottom[0]);
    addKey(keys.rightTop, bottom[1]);
  } else {
    addKey(keys.leftTop, left[0]);
    addKey(keys.leftBottom, left[1]);
    addKey(keys.rightTop, right[0]);
    addKey(keys.rightBottom, right[1]);
    addKey(keys.bottom, bottom[0]);
  }

  return map;
}

function normalizeKeyValue(value: string) {
  if (!value) return "";
  if (value === " " || value === "Spacebar") return "Space";
  if (value.startsWith("Arrow")) return value;
  return value.toUpperCase();
}

function formatKeyLabel(value: string) {
  if (!value) return "";
  if (value === "Space") return "Space";
  if (value.startsWith("Arrow")) return value.replace("Arrow", "");
  return value.toUpperCase();
}

function sortTracks(items: Track[], key: SortKey, dir: SortDir) {
  const list = [...items];
  const direction = dir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    if (key === "song") {
      return a.name.localeCompare(b.name) * direction;
    }
    if (key === "artist") {
      return a.artists.localeCompare(b.artists) * direction;
    }
    if (key === "genres") {
      return (a.genres ?? "").localeCompare(b.genres ?? "") * direction;
    }
    if (key === "playlistCount") {
      return ((a.playlistCount ?? 0) - (b.playlistCount ?? 0)) * direction;
    }
    if (key === "popularity") {
      return ((a.popularity ?? 0) - (b.popularity ?? 0)) * direction;
    }
    const aDate = a.savedAt ? new Date(a.savedAt).getTime() : 0;
    const bDate = b.savedAt ? new Date(b.savedAt).getTime() : 0;
    return (aDate - bDate) * direction;
  });
  return list;
}

function dedupeTracks(tracks: Track[]) {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function dedupePlaylistTracks(tracks: PlaylistTrack[]) {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

export default function SorterPlayClient({ ids }: { ids: string }) {
  const { status: authStatus } = useSession();
  const [queue, setQueue] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [preventDuplicates, setPreventDuplicates] = useState(false);
  const [excludeAllPlaylists, setExcludeAllPlaylists] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("savedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [skipToId, setSkipToId] = useState("");
  const [keyConfig, setKeyConfig] = useState<KeyConfig>(DEFAULT_KEYS);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [duplicateReady, setDuplicateReady] = useState(false);
  const [drag, setDrag] = useState<DragState>({
    active: false,
    deltaX: 0,
    deltaY: 0,
    startX: 0,
    startY: 0,
  });
  const [dragStarted, setDragStarted] = useState(false);
  const dragStartedRef = useRef(false);
  const [hoveredPlaylistId, setHoveredPlaylistId] = useState<string | null>(
    null
  );
  const [hoveredSkip, setHoveredSkip] = useState(false);
  const [sortedHistory, setSortedHistory] = useState<SortedItem[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [keyAnim, setKeyAnim] = useState<KeyAnimation | null>(null);
  const [keyAnimActive, setKeyAnimActive] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeTracks, setActiveTracks] = useState<PlaylistTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [previewById, setPreviewById] = useState<Record<string, string | null>>(
    {}
  );
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [playlistMapVersion, setPlaylistMapVersion] = useState(0);

  const skipRef = useRef<HTMLDivElement | null>(null);
  const playlistRefs = useRef(new Map<string, HTMLDivElement>());
  const stackRef = useRef<HTMLDivElement | null>(null);
  const pendingActionRef = useRef<{ type: "skip" } | { type: "playlist"; id: string } | null>(null);
  const topCardRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewLoadingRef = useRef(new Set<string>());
  const processingRef = useRef(false);
  const activePreviewRef = useRef<{ trackId: string | null; url: string | null }>({
    trackId: null,
    url: null,
  });
  const processedIdsRef = useRef(new Set<string>());
  const playlistTrackIdsRef = useRef(new Map<string, Set<string>>());
  const dragPosRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragRafRef = useRef<number | null>(null);
  const playlistRectsRef = useRef(new Map<string, DOMRect>());
  const skipRectRef = useRef<DOMRect | null>(null);
  const hoveredPlaylistRef = useRef<string | null>(null);
  const hoveredSkipRef = useRef(false);
  const statusTimerRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const progressTargetRef = useRef(0);

  const selectedIds = useMemo(
    () => ids.split(",").map((id) => id.trim()).filter(Boolean),
    [ids]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as {
        preventDuplicates?: boolean;
        excludeAllPlaylists?: boolean;
        sortKey?: SortKey;
        sortDir?: SortDir;
        keyConfig?: Partial<KeyConfig>;
      };
      if (typeof parsed.preventDuplicates === "boolean") {
        setPreventDuplicates(parsed.preventDuplicates);
      }
      if (typeof parsed.excludeAllPlaylists === "boolean") {
        setExcludeAllPlaylists(parsed.excludeAllPlaylists);
      }
      if (parsed.sortKey) {
        setSortKey(parsed.sortKey);
      }
      if (parsed.sortDir) {
        setSortDir(parsed.sortDir);
      }
      if (parsed.keyConfig) {
        setKeyConfig((prev) => ({ ...prev, ...parsed.keyConfig }));
      }
    } catch {
      // ignore invalid storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        preventDuplicates,
        excludeAllPlaylists,
        sortKey,
        sortDir,
        keyConfig,
      })
    );
  }, [preventDuplicates, excludeAllPlaylists, sortKey, sortDir, keyConfig]);

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
    const shouldUseCachedPlaylists = hasCache && (isFresh || inCooldown);
    if (hasCache) {
      const filtered = (cachedPlaylists ?? []).filter((p) =>
        selectedIds.includes(p.id)
      );
      setPlaylists(filtered);
    }
    let active = true;
    let loadingComplete = false;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let nudgeInterval: ReturnType<typeof setInterval> | null = null;

    progressRef.current = 0;
    progressTargetRef.current = 0;
    setLoadProgress(0);

    const finalizeLoading = () => {
      if (!active) return;
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
        setTarget(8);
        startNudges(92);
        let tracksRes: Response;
        let playlistsData: { playlists: Playlist[] };
        if (shouldUseCachedPlaylists) {
          tracksRes = await fetch("/api/liked-tracks", { cache: "no-store" });
          setTarget(18);
          if (!tracksRes.ok) {
            if (tracksRes.status === 401) {
              if (active) {
                setSessionExpired(true);
                setError(null);
                setIsLoading(false);
              }
              return;
            }
            const body = await tracksRes.text();
            throw new Error(body || "Failed to load sorter data");
          }
          playlistsData = { playlists: cachedPlaylists ?? [] };
        } else {
          const [tracksResponse, playlistsResponse] = await Promise.all([
            fetch("/api/liked-tracks", { cache: "no-store" }),
            fetch("/api/playlists", { cache: "no-store" }),
          ]);
          tracksRes = tracksResponse;
          setTarget(18);
          if (!tracksRes.ok || !playlistsResponse.ok) {
            const statusCode = tracksRes.status || playlistsResponse.status;
            if (statusCode === 401) {
              if (active) {
                setSessionExpired(true);
                setError(null);
                setIsLoading(false);
              }
              return;
            }
            if (statusCode === 429) {
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
            throw new Error("Failed to load sorter data");
          }
          playlistsData = (await playlistsResponse.json()) as {
            playlists: Playlist[];
          };
        }
        const tracksData = (await tracksRes.json()) as { tracks: Track[] };
        const filtered = playlistsData.playlists.filter((p) =>
          selectedIds.includes(p.id)
        );
        if (active) {
          let nextTracks = tracksData.tracks;
          if (typeof window !== "undefined") {
            const stored = window.localStorage.getItem("sorted:selectedTracks");
            if (stored) {
              try {
                const parsed = JSON.parse(stored) as string[];
                if (parsed.length > 0) {
                  const filteredTracks = tracksData.tracks.filter((track) =>
                    parsed.includes(track.id)
                  );
                  if (filteredTracks.length > 0) {
                    nextTracks = filteredTracks;
                  }
                }
              } catch {
                nextTracks = tracksData.tracks;
              }
            }
          }
          const uniqueTracks = dedupeTracks(nextTracks);
          processedIdsRef.current = new Set();
          setAllTracks(uniqueTracks);
          setQueue(sortTracks(uniqueTracks, sortKey, sortDir));
          setPlaylists(filtered);
        }
        if (!shouldUseCachedPlaylists && typeof window !== "undefined") {
          window.localStorage.setItem(
            PLAYLIST_CACHE_KEY,
            JSON.stringify(playlistsData.playlists)
          );
          window.localStorage.setItem(
            PLAYLIST_CACHE_AT_KEY,
            String(Date.now())
          );
          window.localStorage.removeItem(PLAYLIST_RATE_LIMIT_AT_KEY);
        }
        setTarget(90);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (active) {
          loadingComplete = true;
          setTarget(100);
        }
      }
    }
    load();
    return () => {
      active = false;
      loadingComplete = true;
      if (tickInterval) clearInterval(tickInterval);
      if (nudgeInterval) clearInterval(nudgeInterval);
    };
  }, [selectedIds, authStatus]);

  useEffect(() => {
    if (!preventDuplicates) {
      playlistTrackIdsRef.current = new Map();
      setDuplicateReady(false);
      setPlaylistMapVersion((prev) => prev + 1);
      return;
    }
    if (playlists.length === 0) {
      setDuplicateReady(false);
      return;
    }
    let active = true;
    setDuplicateReady(false);
    const previousMap = playlistTrackIdsRef.current;
    const baseMap = new Map<string, Set<string>>();
    playlists.forEach((playlist) => {
      const existing = previousMap.get(playlist.id);
      baseMap.set(playlist.id, existing ? new Set(existing) : new Set());
    });
    playlistTrackIdsRef.current = baseMap;
    setPlaylistMapVersion((prev) => prev + 1);
    (async () => {
      try {
        const results = await Promise.allSettled(
          playlists.map(async (playlist) => {
            const res = await fetch(
              `/api/playlist-tracks?id=${playlist.id}`,
              { cache: "no-store" }
            );
            if (!res.ok) {
              if (res.status === 401) {
                throw new Error("unauthorized");
              }
              const body = await res.text();
              throw new Error(body || `Request failed: ${res.status}`);
            }
            const data = (await res.json()) as { tracks: PlaylistTrack[] };
            const uniqueTracks = dedupePlaylistTracks(data.tracks);
            return {
              playlistId: playlist.id,
              ids: new Set(uniqueTracks.map((track) => track.id)),
            };
          })
        );
        const map = new Map<string, Set<string>>(baseMap);
        let hasError = false;
        for (const result of results) {
          if (result.status === "fulfilled") {
            map.set(result.value.playlistId, result.value.ids);
          } else {
            if (result.reason instanceof Error && result.reason.message === "unauthorized") {
              if (active) {
                setSessionExpired(true);
                setError(null);
              }
              return;
            }
            hasError = true;
          }
        }
        if (!active) return;
        playlistTrackIdsRef.current = map;
        setDuplicateReady(!hasError);
        setPlaylistMapVersion((prev) => prev + 1);
        if (hasError) {
          setStatus("Could not load playlist contents.");
        }
      } catch (err) {
        if (!active) return;
        setStatus(err instanceof Error ? err.message : "Failed to load playlists");
        setDuplicateReady(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [preventDuplicates, playlists]);

  useEffect(() => {
    if (!preventDuplicates || !duplicateReady) return;
    if (playlistTrackIdsRef.current.size === 0) return;
    setAllTracks((prev) =>
      prev.map((track) => {
        let count = 0;
        playlistTrackIdsRef.current.forEach((ids) => {
          if (ids.has(track.id)) count += 1;
        });
        return { ...track, playlistCount: count };
      })
    );
  }, [preventDuplicates, duplicateReady]);

  useEffect(() => {
    if (!drag.active) return;
    const handleMove = (event: PointerEvent) => {
      dragPosRef.current = { x: event.clientX, y: event.clientY };
      if (dragRafRef.current !== null) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        dragRafRef.current = null;
        const { x, y } = dragPosRef.current;
        const deltaX = x - dragStartRef.current.x;
        const deltaY = y - dragStartRef.current.y;
        if (!dragStartedRef.current && Math.hypot(deltaX, deltaY) > 8) {
          dragStartedRef.current = true;
          setDragStarted(true);
        }
        setDrag((prev) => ({
          ...prev,
          deltaX,
          deltaY,
        }));
        let hovered: string | null = null;
        for (const [id, rect] of playlistRectsRef.current.entries()) {
          if (pointInRect(x, y, rect)) {
            hovered = id;
            break;
          }
        }
        if (hovered !== hoveredPlaylistRef.current) {
          hoveredPlaylistRef.current = hovered;
          setHoveredPlaylistId(hovered);
        }
        const skipRect = skipRectRef.current;
        const isOverSkip = skipRect ? pointInRect(x, y, skipRect) : false;
        if (isOverSkip !== hoveredSkipRef.current) {
          hoveredSkipRef.current = isOverSkip;
          setHoveredSkip(isOverSkip);
        }
      });
    };
    const handleUp = (event: PointerEvent) => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      handleDrop(event.clientX, event.clientY);
      setDrag({ active: false, deltaX: 0, deltaY: 0, startX: 0, startY: 0 });
      dragStartedRef.current = false;
      setDragStarted(false);
      hoveredPlaylistRef.current = null;
      hoveredSkipRef.current = false;
      setHoveredPlaylistId(null);
      setHoveredSkip(false);
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag.active]);

  useEffect(() => {
    if (drag.active) return;
    if (!pendingActionRef.current) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action.type === "skip") {
      handleSkip();
      return;
    }
    handleDropPlaylist(action.id);
  }, [drag.active]);

  const filteredTracks = useMemo(() => {
    const baseTracks = dedupeTracks(allTracks);
    if (
      !excludeAllPlaylists ||
      !preventDuplicates ||
      !duplicateReady ||
      playlists.length === 0
    ) {
      return baseTracks;
    }
    return baseTracks.filter((track) => {
      const count = playlistTrackIdsRef.current.size
        ? Array.from(playlistTrackIdsRef.current.values()).filter((ids) =>
            ids.has(track.id)
          ).length
        : track.playlistCount ?? 0;
      return count < playlists.length;
    });
  }, [
    allTracks,
    excludeAllPlaylists,
    preventDuplicates,
    duplicateReady,
    playlists.length,
  ]);

  const sortedTracks = useMemo(
    () => sortTracks(filteredTracks, sortKey, sortDir),
    [filteredTracks, sortKey, sortDir]
  );

  useEffect(() => {
    if (sortedTracks.length === 0) return;
    const processed = processedIdsRef.current;
    const remaining = sortedTracks.filter((track) => !processed.has(track.id));
    setQueue(dedupeTracks(remaining));
  }, [sortedTracks]);

  useEffect(() => {
    if (!skipToId) return;
    if (!sortedTracks.some((track) => track.id === skipToId)) {
      setSkipToId("");
    }
  }, [skipToId, sortedTracks]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const { left, right, bottom } = distributePlaylists(playlists);
  const dedupedQueue = useMemo(() => dedupeTracks(queue), [queue]);
  const stack = dedupedQueue.slice(0, 3);
  const topTrack = stack[0] ?? null;
  const playlistById = useMemo(() => {
    return new Map(playlists.map((p) => [p.id, p]));
  }, [playlists]);
  const keyMap = useMemo(
    () => buildKeyMapByLayout(left, right, bottom, playlists.length, keyConfig),
    [left, right, bottom, playlists.length, keyConfig]
  );
  const keyAvailability = useMemo(() => {
    const count = playlists.length;
    return {
      leftTop: count >= 5,
      leftBottom: count >= 1,
      rightTop: count >= 4,
      rightBottom: count >= 2,
      bottom: count >= 3,
      skip: true,
    };
  }, [playlists.length]);
  const keyTargetByField = useMemo(() => {
    const count = playlists.length;
    return {
      leftTop: count >= 5 ? left[0] ?? null : null,
      leftBottom: count >= 5 ? left[1] ?? null : left[0] ?? null,
      rightTop: count >= 4
        ? count >= 5
          ? right[0] ?? null
          : bottom[1] ?? null
        : null,
      rightBottom:
        count >= 5 ? right[1] ?? null : count >= 2 ? right[0] ?? null : null,
      bottom: count >= 3 ? bottom[0] ?? null : null,
      skip: null,
    };
  }, [left, right, bottom, playlists.length]);
  const keyByPlaylist = useMemo(() => {
    const map = new Map<string, string>();
    keyMap.forEach((playlistId, key) => {
      map.set(playlistId, key);
    });
    return map;
  }, [keyMap]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (keyAnim) return;
      if (showIntro) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      if (event.target instanceof HTMLSelectElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void handleUndoShortcut();
        return;
      }
      const key = normalizeKeyValue(event.key);
      if (!key) return;
      if (key === normalizeKeyValue(keyConfig.skip)) {
        startKeyAnimation("skip");
        return;
      }
      const playlistId = keyMap.get(key);
      if (playlistId) {
        startKeyAnimation("playlist", playlistId);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [keyMap, keyAnim, keyConfig.skip, showIntro, sortedHistory, drag.active, dragStarted]);

  useEffect(() => {
    if (!audioEnabled || dedupedQueue.length === 0) return;
    const missing = dedupedQueue
      .slice(0, 12)
      .filter((track) => previewById[track.id] === undefined)
      .map((track) => track.id);
    if (missing.length === 0) return;
    void requestPreviews(
      dedupedQueue.slice(0, 12).filter((track) => missing.includes(track.id))
    );
  }, [dedupedQueue, previewById]);

  useEffect(() => {
    if (!audioEnabled) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      activePreviewRef.current = { trackId: null, url: null };
      return;
    }
    if (!hasInteracted) return;
    if (!topTrack) return;
    const previewUrl = previewById[topTrack.id];
    if (previewUrl === undefined) {
      void requestPreviews([topTrack]);
      return;
    }
    if (!previewUrl || !audioRef.current) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      activePreviewRef.current = { trackId: topTrack.id, url: previewUrl ?? null };
      return;
    }
    const current = activePreviewRef.current;
    if (current.trackId === topTrack.id && current.url === previewUrl) {
      return;
    }
    activePreviewRef.current = { trackId: topTrack.id, url: previewUrl };
    audioRef.current.src = previewUrl;
    audioRef.current.currentTime = 0;
    const promise = audioRef.current.play();
    if (promise) {
      promise.catch(() => undefined);
    }
    return () => {
      audioRef.current?.pause();
    };
  }, [audioEnabled, hasInteracted, topTrack?.id, previewById[topTrack?.id ?? ""]]);

  useEffect(() => {
    if (processingRef.current) return;
    if (pendingAdds.length === 0) return;
    const { track, playlistId } = pendingAdds[0];
    processingRef.current = true;
    (async () => {
      try {
        await submitTrackToPlaylist(track, playlistId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setPendingAdds((prev) => prev.slice(1));
        processingRef.current = false;
      }
    })();
  }, [pendingAdds]);

  async function submitTrackToPlaylist(track: Track, playlistId: string) {
    const playlist = playlistById.get(playlistId);
    setStatus("Adding to playlist...");
    const res = await fetch("/api/add-to-playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId, trackUri: track.uri }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || "Failed to add track");
    }
    if (playlist) {
      setSortedHistory((prev) => [
        ...prev,
        {
          track,
          playlistId,
          playlistName: playlist.name,
        },
      ]);
    }
    setStatus(null);
  }

  async function handleDropPlaylist(playlistId: string) {
    if (!topTrack) return;
    const currentTrack = topTrack;
    if (preventDuplicates) {
      const ids = playlistTrackIdsRef.current.get(playlistId);
      if (!ids) {
        flashStatus("Loading playlist contents...");
        return;
      }
      if (ids.has(currentTrack.id)) {
        flashStatus("Already in this playlist.");
        return;
      }
      ids.add(currentTrack.id);
      setAllTracks((prev) =>
        prev.map((track) =>
          track.id === currentTrack.id
            ? { ...track, playlistCount: (track.playlistCount ?? 0) + 1 }
            : track
        )
      );
    }
    processedIdsRef.current.add(currentTrack.id);
    setQueue((prev) => prev.slice(1));
    setPendingAdds((prev) => [...prev, { track: currentTrack, playlistId }]);
  }

  function handleSkip() {
    if (!topTrack) return;
    processedIdsRef.current.add(topTrack.id);
    setQueue((prev) => prev.slice(1));
  }

  function flashStatus(message: string) {
    setStatus(message);
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      setStatus(null);
    }, 1800);
  }

  function updateKey(field: keyof KeyConfig, value: string) {
    const normalized = normalizeKeyValue(value);
    const next = normalized.slice(0, 10);
    setKeyConfig((prev) => {
      if (!next) {
        return { ...prev, [field]: "" };
      }
      const isDuplicate = Object.entries(prev).some(
        ([key, current]) => key !== field && current === next
      );
      if (isDuplicate) return prev;
      return { ...prev, [field]: next };
    });
  }

  function handleSkipTo(trackId: string) {
    if (!trackId) return;
    const index = sortedTracks.findIndex((track) => track.id === trackId);
    if (index === -1) return;
    const processed = processedIdsRef.current;
    for (let i = 0; i < index; i += 1) {
      processed.add(sortedTracks[i].id);
    }
    const remaining = sortedTracks.filter((track) => !processed.has(track.id));
    setQueue(remaining);
    setSkipToId(trackId);
  }

  async function performUndo(item: SortedItem) {
    try {
      const res = await fetch("/api/remove-from-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: item.playlistId, trackUri: item.track.uri }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "Failed to remove track");
      }
      setSortedHistory((prev) => prev.filter((row) => row !== item));
      if (preventDuplicates) {
        const ids = playlistTrackIdsRef.current.get(item.playlistId);
        if (ids) {
          ids.delete(item.track.id);
        }
        setAllTracks((prev) =>
          prev.map((track) =>
            track.id === item.track.id
              ? { ...track, playlistCount: Math.max(0, (track.playlistCount ?? 0) - 1) }
              : track
          )
        );
      }
      processedIdsRef.current.delete(item.track.id);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return false;
    }
  }

  async function handleUndo(item: SortedItem) {
    await performUndo(item);
  }

  function setPlaylistRef(id: string, node: HTMLDivElement | null) {
    if (!node) {
      playlistRefs.current.delete(id);
      return;
    }
    playlistRefs.current.set(id, node);
  }

  function handleDrop(x: number, y: number) {
    if (!topTrack) return;
    const skipRect = skipRectRef.current ?? skipRef.current?.getBoundingClientRect();
    if (skipRect && pointInRect(x, y, skipRect)) {
      pendingActionRef.current = { type: "skip" };
      return;
    }
    const rects =
      playlistRectsRef.current.size > 0
        ? playlistRectsRef.current
        : new Map(
            Array.from(playlistRefs.current.entries()).map(([id, node]) => [
              id,
              node.getBoundingClientRect(),
            ])
          );
    for (const [id, rect] of rects.entries()) {
      if (pointInRect(x, y, rect)) {
        pendingActionRef.current = { type: "playlist", id };
        return;
      }
    }
  }

  async function openPlaylist(playlistId: string) {
    if (drag.active || dragStarted) return;
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

  async function requestPreviews(tracks: Track[]) {
    if (!audioEnabled) return;
    const payload = tracks
      .filter((track) => {
        if (previewById[track.id] !== undefined) return false;
        if (previewLoadingRef.current.has(track.id)) return false;
        previewLoadingRef.current.add(track.id);
        return true;
      })
      .map((track) => ({
        id: track.id,
        name: track.name,
        artist: track.artists.split(",")[0]?.trim() ?? "",
      }));
    if (payload.length === 0) return;
    try {
      const res = await fetch("/api/track-previews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: payload }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as { previews: Record<string, string | null> };
      setPreviewById((prev) => ({ ...prev, ...data.previews }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      payload.forEach((track) => previewLoadingRef.current.delete(track.id));
    }
  }

  function startKeyAnimation(targetType: "playlist" | "skip", playlistId?: string) {
    if (!topTrack || keyAnim) return;
    const currentTrack = topTrack;
    if (targetType === "playlist" && playlistId && preventDuplicates) {
      const ids = playlistTrackIdsRef.current.get(playlistId);
      if (!ids) {
        flashStatus("Loading playlist contents...");
        return;
      }
      if (ids.has(currentTrack.id)) {
        flashStatus("Already in this playlist.");
        return;
      }
      ids.add(currentTrack.id);
      setAllTracks((prev) =>
        prev.map((track) =>
          track.id === currentTrack.id
            ? { ...track, playlistCount: (track.playlistCount ?? 0) + 1 }
            : track
        )
      );
    }
    processedIdsRef.current.add(currentTrack.id);
    setQueue((prev) => prev.slice(1));
    const fromNode = topCardRef.current;
    const toNode =
      targetType === "skip"
        ? skipRef.current
        : playlistId
        ? playlistRefs.current.get(playlistId)
        : null;
    if (!fromNode || !toNode) {
      if (targetType === "skip") return;
      if (playlistId) {
        void finalizeKeyPlaylist(currentTrack, playlistId);
      }
      return;
    }
    const fromRect = fromNode.getBoundingClientRect();
    const toRect = toNode.getBoundingClientRect();
    const fromX = fromRect.left + fromRect.width / 2;
    const fromY = fromRect.top + fromRect.height / 2;
    const toX = toRect.left + toRect.width / 2;
    const toY = toRect.top + toRect.height / 2;
    setKeyAnim({
      fromX,
      fromY,
      toX,
      toY,
      image: currentTrack.image ?? "/favicon.ico",
      targetType,
      playlistId,
      track: currentTrack,
      action: "add",
    });
    setKeyAnimActive(false);
    if (targetType === "skip") {
      setHoveredSkip(true);
    } else if (playlistId) {
      setHoveredPlaylistId(playlistId);
    }
    requestAnimationFrame(() => setKeyAnimActive(true));
  }

  function handleKeyAnimationEnd() {
    if (!keyAnim) return;
    if (keyAnim.action === "undo") {
      setKeyAnim(null);
      setKeyAnimActive(false);
      setHoveredPlaylistId(null);
      setHoveredSkip(false);
      setQueue((prev) => {
        return dedupeTracks([keyAnim.track, ...prev]);
      });
      return;
    }
    const targetId = keyAnim.playlistId;
    setKeyAnim(null);
    setKeyAnimActive(false);
    setHoveredPlaylistId(null);
    setHoveredSkip(false);
    if (keyAnim.targetType === "skip") {
      return;
    }
    if (targetId) {
      setPendingAdds((prev) => [...prev, { track: keyAnim.track, playlistId: targetId }]);
    }
  }

  function finalizeKeyPlaylist(track: Track, playlistId: string) {
    setPendingAdds((prev) => [...prev, { track, playlistId }]);
  }

  async function handleUndoShortcut() {
    if (keyAnim || drag.active || dragStarted) return;
    const item = sortedHistory[sortedHistory.length - 1];
    if (!item) return;
    const fromNode = playlistRefs.current.get(item.playlistId);
    const toNode = topCardRef.current ?? stackRef.current;
    if (!fromNode || !toNode) {
      setQueue((prev) => dedupeTracks([item.track, ...prev]));
      void performUndo(item);
      return;
    }
    const fromRect = fromNode.getBoundingClientRect();
    const toRect = toNode.getBoundingClientRect();
    setKeyAnim({
      fromX: fromRect.left + fromRect.width / 2,
      fromY: fromRect.top + fromRect.height / 2,
      toX: toRect.left + toRect.width / 2,
      toY: toRect.top + toRect.height / 2,
      image: item.track.image ?? "/favicon.ico",
      targetType: "undo",
      playlistId: item.playlistId,
      track: item.track,
      action: "undo",
    });
    setKeyAnimActive(false);
    requestAnimationFrame(() => setKeyAnimActive(true));
    void performUndo(item);
  }

  let body: ReactNode = null;
  if (sessionExpired) {
    body = <SessionExpiredModal />;
  } else if (error) {
    body = <p className="mt-4 text-sm text-red-600">{error}</p>;
  } else if (!topTrack) {
    body = <p className="mt-4 text-sm text-neutral-400">No tracks left.</p>;
  } else {
    body = (
      <div className="mt-4">
      <div className="relative h-[84vh] rounded-2xl border border-neutral-800 bg-neutral-950/40">
        <audio ref={audioRef} preload="auto" />
        <div className="absolute left-6 right-6 top-4 flex items-stretch gap-5">
          <button
            type="button"
            className={`flex w-36 flex-col items-center justify-center gap-1 rounded-xl border px-3 py-3 text-xs transition ${
              audioEnabled ? "||" : ">"
            }`}
            onClick={() => setAudioEnabled((prev) => !prev)}
            aria-label={audioEnabled ? "||" : ">"}
          >
            <span>Audio Previews</span>
            <span className="text-lg">{audioEnabled ? "||" : ">"}</span>
          </button>

          <div
            ref={skipRef}
            className={`relative flex-1 rounded-xl border border-dashed px-4 py-3 text-center text-sm text-neutral-300 transition origin-center ${
              hoveredSkip ? "border-red-400 bg-red-500/10 scale-105"
                : "border-neutral-600"
            }`}
          >
            <span>Drag here to skip</span>
            <span
              className={`skip-x absolute left-1/2 top-1/2 inline-flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white text-sm font-semibold ${
                hoveredSkip ? "skip-x-active" : ""
              }`}
            >
              X
            </span>
          </div>

          <button
            type="button"
            className="summary-cta w-36 text-xs shadow-lg"
            onClick={() => setShowSummary(true)}
          >
            Summary
          </button>
        </div>

        <div
          className={`absolute left-6 top-32 flex flex-col justify-between gap-5 ${
            bottom.length > 0 ? "bottom-40" : "bottom-24"
          }`}
        >
          {left.map((playlist) => (
          <div
            key={playlist.id}
            ref={(node) => setPlaylistRef(playlist.id, node)}
            role="button"
            tabIndex={0}
            onClick={() => openPlaylist(playlist.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPlaylist(playlist.id);
              }
            }}
            className={`group relative flex w-36 flex-1 flex-col items-center justify-center gap-2 rounded-xl border bg-neutral-900/70 p-3 text-center text-xs text-neutral-200 transition ${
              hoveredPlaylistId === playlist.id ? "border-green-400 scale-110"
                : "border-neutral-800"
            }`}
          >
            {preventDuplicates &&
            topTrack &&
            playlistTrackIdsRef.current
              .get(playlist.id)
              ?.has(topTrack.id) ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-red-600/40 text-[11px] font-semibold text-white">
                Already included
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-neutral-900/60 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <span className="rounded-full bg-neutral-200/90 px-3 py-1 text-[10px] font-semibold text-neutral-900">
                View songs
              </span>
            </div>
            {keyByPlaylist.get(playlist.id) ? (
              <span className="absolute right-2 top-2 rounded-md border border-neutral-700 bg-neutral-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-200">
                {keyByPlaylist.get(playlist.id)}
              </span>
            ) : null}
            <img
              src={playlist.image ?? "/favicon.ico"}
              alt={playlist.name}
              className="h-16 w-16 rounded-md object-cover aspect-square"
            />
            <span>{playlist.name}</span>
          </div>
        ))}
      </div>

        <div
          className={`absolute right-6 top-32 flex flex-col justify-between gap-5 ${
            bottom.length > 0 ? "bottom-40" : "bottom-24"
          }`}
        >
        {right.map((playlist) => (
          <div
            key={playlist.id}
            ref={(node) => setPlaylistRef(playlist.id, node)}
            role="button"
            tabIndex={0}
              onClick={() => openPlaylist(playlist.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPlaylist(playlist.id);
                }
              }}
            className={`group relative flex w-36 flex-1 flex-col items-center justify-center gap-2 rounded-xl border bg-neutral-900/70 p-3 text-center text-xs text-neutral-200 transition ${
              hoveredPlaylistId === playlist.id ? "border-green-400 scale-110"
                : "border-neutral-800"
            }`}
          >
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-neutral-900/60 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <span className="rounded-full bg-neutral-200/90 px-3 py-1 text-[10px] font-semibold text-neutral-900">
                View songs
              </span>
            </div>
            {keyByPlaylist.get(playlist.id) ? (
              <span className="absolute right-2 top-2 rounded-md border border-neutral-700 bg-neutral-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-200">
                {keyByPlaylist.get(playlist.id)}
              </span>
            ) : null}
            <img
              src={playlist.image ?? "/favicon.ico"}
              alt={playlist.name}
              className="h-16 w-16 rounded-md object-cover aspect-square"
            />
            <span>{playlist.name}</span>
          </div>
        ))}
      </div>

      <div className="absolute bottom-6 left-6 right-6 flex justify-center">
        <div className="flex w-full max-w-[calc(100%-18rem-2.5rem)] gap-5">
          {bottom.map((playlist) => (
            <div
              key={playlist.id}
              ref={(node) => setPlaylistRef(playlist.id, node)}
              role="button"
              tabIndex={0}
              onClick={() => openPlaylist(playlist.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPlaylist(playlist.id);
                }
              }}
              className={`group relative flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border bg-neutral-900/70 p-3 text-center text-xs text-neutral-200 transition origin-top ${
                hoveredPlaylistId === playlist.id ? "border-green-400 scale-[1.01]"
                  : "border-neutral-800"
              }`}
            >
              {preventDuplicates &&
              topTrack &&
              playlistTrackIdsRef.current
                .get(playlist.id)
                ?.has(topTrack.id) ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-red-600/40 text-[11px] font-semibold text-white">
                  Already included
                </div>
              ) : null}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-neutral-900/60 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <span className="rounded-full bg-neutral-200/90 px-3 py-1 text-[10px] font-semibold text-neutral-900">
                  View songs
                </span>
              </div>
              {keyByPlaylist.get(playlist.id) ? (
                <span className="absolute right-2 top-2 rounded-md border border-neutral-700 bg-neutral-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-200">
                  {keyByPlaylist.get(playlist.id)}
                </span>
              ) : null}
              <img
                src={playlist.image ?? "/favicon.ico"}
                alt={playlist.name}
                className="h-16 w-16 rounded-md object-cover aspect-square"
              />
              <span>{playlist.name}</span>
            </div>
          ))}
        </div>
      </div>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div ref={stackRef} className="relative h-[22rem] w-64 -translate-y-6">
            {stack
              .slice()
              .reverse()
              .map((track, index) => {
                const position = stack.length - 1 - index;
                const offset = (position * 12) - 20;
                let rotation = 0;
                if (position === 1) rotation = -12;
                if (position === 2) rotation = 12;
                const isTop = position === 0;
                const translateX = isTop ? drag.deltaX : 0;
                const translateY = (isTop ? drag.deltaY : 0) + offset;
                const scale = isTop && drag.active ? 0.9 : 1;

                return (
                  <div
                    key={track.id}
                    ref={isTop ? topCardRef : null}
                    className={`card-stack absolute left-0 top-0 h-[22rem] w-64 ${
                      isTop ? "cursor-grab pointer-events-auto" : "pointer-events-none"
                    } ${isTop && drag.active ? "opacity-95 dragging" : ""}`}
                    style={{
                      transform: `translate(${translateX}px, ${translateY}px) rotate(${rotation}deg) scale(${scale})`,
                    }}
                    onPointerDown={(event) => {
                      if (!isTop) return;
                      if (keyAnim) return;
                      event.preventDefault();
                      document.body.style.userSelect = "none";
                      dragStartRef.current = {
                        x: event.clientX,
                        y: event.clientY,
                      };
                      dragPosRef.current = {
                        x: event.clientX,
                        y: event.clientY,
                      };
                      const rects = new Map<string, DOMRect>();
                      for (const [id, node] of playlistRefs.current.entries()) {
                        rects.set(id, node.getBoundingClientRect());
                      }
                      playlistRectsRef.current = rects;
                      skipRectRef.current =
                        skipRef.current?.getBoundingClientRect() ?? null;
                      setDrag({
                        active: true,
                        deltaX: 0,
                        deltaY: 0,
                        startX: event.clientX,
                        startY: event.clientY,
                      });
                    }}
                  >
                    <div
                      className={`h-full w-full overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-xl card-shell ${
                        isTop && drag.active ? "card-shell-active" : ""
                      } ${isTop && drag.active && dragStarted ? "wiggle" : ""} ${
                        isTop && hoveredPlaylistId ? "card-shell-hover" : ""
                      }`}
                    >
                      <div className="flex h-full flex-col">
                        <div className="p-3">
                          <img
                            src={track.image ?? "/favicon.ico"}
                            alt={track.name}
                            className="w-full aspect-square rounded-xl object-cover"
                          />
                        </div>
                        <div className="flex flex-1 flex-col justify-between px-4 pb-4 text-neutral-100">
                          <div>
                            <p className="text-sm text-neutral-400">Up next</p>
                            <p className="text-lg font-semibold">{track.name}</p>
                            <p className="text-sm text-neutral-400">
                              {track.artists}
                            </p>
                          </div>
                          {isTop ? (
                            <p className="text-xs text-neutral-500">
                              Drag to a playlist or skip
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {showSummary ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-3xl rounded-xl bg-neutral-950 p-6 text-neutral-100 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Sorted this session</h2>
                <button
                  className="text-sm text-neutral-400"
                  onClick={() => setShowSummary(false)}
                >
                  Close
                </button>
              </div>
              <div className="mt-4 max-h-[50vh] overflow-y-auto">
                {sortedHistory.length === 0 ? (
                  <p className="text-sm text-neutral-400">No songs sorted yet.</p>
                ) : (
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800">
                        <th className="py-2 pr-4">Song</th>
                        <th className="py-2 pr-4">Playlist</th>
                        <th className="py-2 pr-4">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedHistory.map((item) => (
                        <tr key={`${item.track.id}-${item.playlistId}`} className="border-b border-neutral-900">
                          <td className="py-2 pr-4">
                            {item.track.name} - {item.track.artists}
                          </td>
                          <td className="py-2 pr-4">{item.playlistName}</td>
                          <td className="py-2 pr-4">
                            <button
                              className="rounded-md border border-neutral-700 px-2 py-1 text-xs"
                              onClick={() => handleUndo(item)}
                            >
                              Undo
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
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
                        className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2"
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

        {keyAnim ? (
          <div className="pointer-events-none fixed left-0 top-0 z-50">
            <div
              className="h-40 w-32 rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl"
              style={{
                transform: keyAnimActive ? `translate(${keyAnim.toX}px, ${keyAnim.toY}px) translate(-50%, -50%) scale(0.2)`
                  : `translate(${keyAnim.fromX}px, ${keyAnim.fromY}px) translate(-50%, -50%) scale(1)`,
                transition: "transform 260ms ease",
              }}
              onTransitionEnd={handleKeyAnimationEnd}
            >
              <img
                src={keyAnim.image ?? "/favicon.ico"}
                alt="Sorting card"
                className="h-full w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        ) : null}

        {status ? (
          <div className="absolute bottom-4 right-6 text-xs text-neutral-400">
            {status}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/80 text-neutral-200 shadow-lg transition hover:scale-105"
        onClick={() => setShowIntro(true)}
        aria-label="Open sorter settings"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 12a7.4 7.4 0 0 0 .05-.85l1.55-1.2-1.5-2.6-1.85.5a7.7 7.7 0 0 0-1.5-.85l-.3-1.9h-3l-.3 1.9a7.7 7.7 0 0 0-1.5.85l-1.85-.5-1.5 2.6 1.55 1.2a7.4 7.4 0 0 0 0 1.7l-1.55 1.2 1.5 2.6 1.85-.5a7.7 7.7 0 0 0 1.5.85l.3 1.9h3l.3-1.9a7.7 7.7 0 0 0 1.5-.85l1.85.5 1.5-2.6-1.55-1.2c.03-.28.05-.56.05-.85z" />
        </svg>
      </button>

      {showIntro ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-3xl rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
            <div className="flex flex-col gap-6">
              <div className="flex items-start justify-between">
                <h2 className="text-xl font-semibold text-center">How to sort</h2>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <p className="text-sm text-neutral-400">
                    Drag &amp; Drop
                  </p>
                  <p className="mt-3 text-sm text-neutral-200">
                    Click and drag the top card into any playlist tile to sort
                    it. Drag into the skip box to skip.
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <p className="text-sm text-neutral-400">
                    Arrow Keys
                  </p>
                  <p className="mt-3 text-sm text-neutral-200">
                    Use your keyboard to sort quickly
                  </p>
                  <p className="mt-2 text-xs text-neutral-500">
                    (Set your custom keys below)
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                <p className="text-sm text-neutral-200">Settings</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-neutral-200">
                    <input
                      type="checkbox"
                      checked={preventDuplicates}
                      onChange={(event) =>
                        setPreventDuplicates(event.target.checked)
                      }
                      className="toggle-dot h-4 w-4 appearance-none rounded-full border border-neutral-500 bg-neutral-400/40 transition-colors duration-200 checked:border-emerald-400 checked:bg-emerald-400"
                    />
                    <span>Prevent duplicate songs per playlist</span>
                  </label>
                    <label className="flex items-center gap-2 text-sm text-neutral-200">
                      <input
                        type="checkbox"
                        checked={excludeAllPlaylists}
                        onChange={(event) =>
                          setExcludeAllPlaylists(event.target.checked)
                        }
                        className="toggle-dot h-4 w-4 appearance-none rounded-full border border-neutral-500 bg-neutral-400/40 transition-colors duration-200 checked:border-emerald-400 checked:bg-emerald-400"
                      />
                      <span>Exclude tracks already in all playlists</span>
                    </label>
                  <div>
                    <p className="text-xs text-neutral-400">Sort order</p>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        className="w-full rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                        value={sortKey}
                        onChange={(event) =>
                          setSortKey(event.target.value as SortKey)
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
                        type="button"
                        className="rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-200"
                        onClick={() =>
                          setSortDir((prev) =>
                            prev === "asc" ? "desc" : "asc"
                          )
                        }
                      >
                        {sortDir === "asc" ? "Asc" : "Desc"}
                      </button>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-neutral-400">Start from...</p>
                    <select
                      className="mt-2 w-full rounded-md border border-neutral-800 bg-neutral-950/70 px-2 py-2 text-xs text-neutral-200"
                      value={skipToId}
                      onChange={(event) => handleSkipTo(event.target.value)}
                    >
                      <option value="">Select a track</option>
                      {sortedTracks.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.name} - {track.artists}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-neutral-400">Key configurator</p>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-[11px] text-neutral-300">
                      <div
                        className={`rounded-lg border p-2 text-center ${
                          keyAvailability.leftTop
                            ? "border-neutral-800 bg-neutral-950/60"
                            : "border-neutral-900 bg-neutral-950/30"
                        }`}
                      >
                        <p>{keyTargetByField.leftTop?.name ?? ""}</p>
                        {keyAvailability.leftTop ? (
                        <input
                          value={formatKeyLabel(keyConfig.leftTop)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" || event.key === "Delete") {
                              event.preventDefault();
                              updateKey("leftTop", "");
                              return;
                            }
                            if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === " ") {
                              event.preventDefault();
                              updateKey("leftTop", event.key);
                            }
                          }}
                          readOnly
                          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/80 px-2 py-1 text-center text-xs text-neutral-100"
                        />
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2 text-center">
                        <p>Skip</p>
                        <input
                          value={formatKeyLabel(keyConfig.skip)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" || event.key === "Delete") {
                              event.preventDefault();
                              updateKey("skip", "");
                              return;
                            }
                            if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === " ") {
                              event.preventDefault();
                              updateKey("skip", event.key);
                            }
                          }}
                          readOnly
                          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/80 px-2 py-1 text-center text-xs text-neutral-100"
                        />
                      </div>
                      <div
                        className={`rounded-lg border p-2 text-center ${
                          keyAvailability.rightTop
                            ? "border-neutral-800 bg-neutral-950/60"
                            : "border-neutral-900 bg-neutral-950/30"
                        }`}
                      >
                        <p>{keyTargetByField.rightTop?.name ?? ""}</p>
                        {keyAvailability.rightTop ? (
                        <input
                          value={formatKeyLabel(keyConfig.rightTop)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" || event.key === "Delete") {
                              event.preventDefault();
                              updateKey("rightTop", "");
                              return;
                            }
                            if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === " ") {
                              event.preventDefault();
                              updateKey("rightTop", event.key);
                            }
                          }}
                          readOnly
                          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/80 px-2 py-1 text-center text-xs text-neutral-100"
                        />
                        ) : null}
                      </div>
                      <div
                        className={`rounded-lg border p-2 text-center ${
                          keyAvailability.leftBottom
                            ? "border-neutral-800 bg-neutral-950/60"
                            : "border-neutral-900 bg-neutral-950/30"
                        }`}
                      >
                        <p>{keyTargetByField.leftBottom?.name ?? ""}</p>
                        {keyAvailability.leftBottom ? (
                        <input
                          value={formatKeyLabel(keyConfig.leftBottom)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" || event.key === "Delete") {
                              event.preventDefault();
                              updateKey("leftBottom", "");
                              return;
                            }
                            if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === " ") {
                              event.preventDefault();
                              updateKey("leftBottom", event.key);
                            }
                          }}
                          readOnly
                          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/80 px-2 py-1 text-center text-xs text-neutral-100"
                        />
                        ) : null}
                      </div>
                      <div
                        className={`rounded-lg border p-2 text-center ${
                          keyAvailability.bottom
                            ? "border-neutral-800 bg-neutral-950/60"
                            : "border-neutral-900 bg-neutral-950/30"
                        }`}
                      >
                        <p>{keyTargetByField.bottom?.name ?? ""}</p>
                        {keyAvailability.bottom ? (
                        <input
                          value={formatKeyLabel(keyConfig.bottom)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" || event.key === "Delete") {
                              event.preventDefault();
                              updateKey("bottom", "");
                              return;
                            }
                            if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === " ") {
                              event.preventDefault();
                              updateKey("bottom", event.key);
                            }
                          }}
                          readOnly
                          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/80 px-2 py-1 text-center text-xs text-neutral-100"
                        />
                        ) : null}
                      </div>
                      <div
                        className={`rounded-lg border p-2 text-center ${
                          keyAvailability.rightBottom
                            ? "border-neutral-800 bg-neutral-950/60"
                            : "border-neutral-900 bg-neutral-950/30"
                        }`}
                      >
                        <p>{keyTargetByField.rightBottom?.name ?? ""}</p>
                        {keyAvailability.rightBottom ? (
                        <input
                          value={formatKeyLabel(keyConfig.rightBottom)}
                          onKeyDown={(event) => {
                            if (event.key === "Backspace" || event.key === "Delete") {
                              event.preventDefault();
                              updateKey("rightBottom", "");
                              return;
                            }
                            if (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === " ") {
                              event.preventDefault();
                              updateKey("rightBottom", event.key);
                            }
                          }}
                          readOnly
                          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/80 px-2 py-1 text-center text-xs text-neutral-100"
                        />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-sm text-neutral-300">
                To undo any sorting, open the Summary tab.
              </p>
              <div className="flex justify-end">
                <button
                  className="cta text-sm"
                  onClick={() => {
                    setShowIntro(false);
                    setHasInteracted(true);
                  }}
                >
                  Get sorting
                </button>
              </div>
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
        message="Loading sorter..."
        progress={loadProgress}
        visible={isLoading && authStatus === "authenticated" && !sessionExpired}
      />
      {!isLoading ? body : null}
    </>
  );
}



