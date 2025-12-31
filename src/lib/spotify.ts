const SPOTIFY_API = "https://api.spotify.com/v1";

type SpotifyArtist = {
  id: string;
  name: string;
};

type SpotifyImage = {
  url: string;
  width: number | null;
  height: number | null;
};

type SpotifyTrack = {
  id: string | null;
  name: string;
  artists: SpotifyArtist[];
  album: { images: SpotifyImage[] };
  popularity: number;
  uri: string;
};

type LikedTrackItem = {
  track: SpotifyTrack;
  added_at: string;
};

type PlaylistSummary = {
  id: string;
  name: string;
  image: string | null;
};

export type TrackRow = {
  id: string;
  name: string;
  artists: string;
  image: string | null;
  popularity: number;
  savedAt: string;
  genres: string;
  uri: string;
  playlists: PlaylistSummary[];
  playlistCount: number;
};

type SpotifyPlaylist = {
  id: string;
  name: string;
  images: SpotifyImage[] | null;
  tracks: { total: number };
  owner: { display_name?: string | null };
};

type NormalizedPlaylist = {
  id: string;
  name: string;
  owner: string;
  total: number;
  image: string | null;
};

type SpotifyTrackDetails = {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: { images: SpotifyImage[] };
  uri: string;
};

type SpotifyArtistDetails = {
  id: string;
  genres: string[];
};

type SpotifyPlaylistTrackItem = {
  track: SpotifyTrackDetails | null;
};

type SpotifyPaged<T> = {
  items: T[];
  next: string | null;
};

const playlistCache = new Map<
  string,
  { data: NormalizedPlaylist[]; expiresAt: number }
>();
const playlistInFlight = new Map<
  string,
  Promise<NormalizedPlaylist[]>
>();
const PLAYLIST_CACHE_TTL_MS = 30_000;

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function spotifyFetch<T>(url: string, accessToken: string): Promise<T> {
  if (!accessToken) {
    throw new Error(`Spotify access token missing for request: ${url}`);
  }
  const fetchOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    const res = await fetchOnce();
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const retryDelay = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 800;
        if (retryDelay <= 1500) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          const retryRes = await fetchOnce();
          if (retryRes.ok) {
            return retryRes.json() as Promise<T>;
          }
          const retryBody = await retryRes.text();
          throw new Error(
            `Spotify API error ${retryRes.status} for ${url}: ${
              retryBody || "No body"
            }`
          );
        }
      }
      throw new Error(
        `Spotify API error ${res.status} for ${url}: ${body || "No body"}`
      );
    }
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Spotify API timeout for ${url}`);
    }
    throw error;
  }
}

export async function fetchLikedTracks(
  accessToken: string,
  options?: { includePlaylists?: boolean }
): Promise<TrackRow[]> {
  const likedItems: LikedTrackItem[] = [];
  let url: string | null = `${SPOTIFY_API}/me/tracks?limit=50`;

  while (url) {
    const data: SpotifyPaged<LikedTrackItem> = await spotifyFetch<
      SpotifyPaged<LikedTrackItem>
    >(url, accessToken);
    for (const item of data.items) {
      if (item.track) likedItems.push(item);
    }
    url = data.next;
  }

  const mainArtistIds = Array.from(
    new Set(
      likedItems
        .map((item) => item.track.artists[0]?.id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const artistGenres = new Map<string, string[]>();
  for (const ids of chunk(mainArtistIds, 50)) {
    const data = await spotifyFetch<{ artists: SpotifyArtistDetails[] }>(
      `${SPOTIFY_API}/artists?ids=${ids.join(",")}`,
      accessToken
    );
    for (const artist of data.artists) {
      artistGenres.set(artist.id, artist.genres);
    }
  }

  const includePlaylists = options?.includePlaylists ?? false;
  const trackPlaylists = new Map<string, PlaylistSummary[]>();
  if (includePlaylists) {
    try {
      const playlists = await fetchPlaylists(accessToken);
      const likedIds = new Set(
        likedItems.map((item) => item.track.id).filter(Boolean) as string[]
      );
      for (const group of chunk(playlists, 5)) {
        const results = await Promise.all(
          group.map(async (playlist) => ({
            playlist,
            trackIds: await fetchPlaylistTrackIds(
              accessToken,
              playlist.id,
              likedIds
            ),
          }))
        );
        for (const { playlist, trackIds } of results) {
          for (const trackId of trackIds) {
            const entry = trackPlaylists.get(trackId) ?? [];
            entry.push({
              id: playlist.id,
              name: playlist.name,
              image: playlist.image ?? null,
            });
            trackPlaylists.set(trackId, entry);
          }
        }
      }
    } catch (error) {
      console.error("Failed to map playlists for liked tracks", error);
    }
  }

  return likedItems.map((item) => {
    const track = item.track;
    const id = track.id ?? `${track.name}-${track.artists[0]?.name ?? "unknown"}`;
    const image = track.album.images[0]?.url ?? null;
    const savedAt = item.added_at ?? "";
    const mainArtistId = track.artists[0]?.id;
    const genres =
      (mainArtistId ? artistGenres.get(mainArtistId) : undefined) ?? [];
    const playlistsForTrack = track.id ? trackPlaylists.get(track.id) ?? [] : [];

    return {
      id,
      name: track.name,
      artists: track.artists.map((a) => a.name).join(", "),
      image,
      popularity: track.popularity ?? 0,
      savedAt,
      genres: genres.slice(0, 3).join(", "),
      uri: track.uri,
      playlists: playlistsForTrack,
      playlistCount: playlistsForTrack.length,
    };
  });
}

async function fetchPlaylistTrackIds(
  accessToken: string,
  playlistId: string,
  likedSet?: Set<string>
): Promise<string[]> {
  const ids = new Set<string>();
  let url: string | null = `${SPOTIFY_API}/playlists/${playlistId}/tracks?limit=100&fields=items(track(id)),next`;
  while (url) {
    const data: SpotifyPaged<{ track: { id: string | null } | null }> =
      await spotifyFetch<SpotifyPaged<{ track: { id: string | null } | null }>>(
        url,
        accessToken
      );
    for (const item of data.items) {
      const trackId = item.track?.id;
      if (!trackId) continue;
      if (likedSet && !likedSet.has(trackId)) continue;
      ids.add(trackId);
    }
    url = data.next;
  }
  return Array.from(ids);
}

function normalizePlaylists(playlists: SpotifyPlaylist[]): NormalizedPlaylist[] {
  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner?.display_name ?? "Unknown",
    total: playlist.tracks.total,
    image: playlist.images?.[0]?.url ?? null,
  }));
}

export async function fetchPlaylists(accessToken: string) {
  const cacheKey = accessToken;
  const cached = playlistCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  const existing = playlistInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const playlists: SpotifyPlaylist[] = [];
    let url: string | null = `${SPOTIFY_API}/me/playlists?limit=50`;

    while (url) {
      const data: SpotifyPaged<SpotifyPlaylist> = await spotifyFetch<
        SpotifyPaged<SpotifyPlaylist>
      >(url, accessToken);
      playlists.push(...data.items);
      url = data.next;
    }
    const normalized = normalizePlaylists(playlists);
    playlistCache.set(cacheKey, {
      data: normalized,
      expiresAt: Date.now() + PLAYLIST_CACHE_TTL_MS,
    });
    return normalized;
  })();

  playlistInFlight.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("429")) {
      if (cached) return cached.data;
      throw new Error("Spotify rate limited (429)");
    }
    throw error;
  } finally {
    playlistInFlight.delete(cacheKey);
  }
}

export async function createPlaylist(
  accessToken: string,
  name: string
): Promise<{ id: string; name: string }> {
  const me = await spotifyFetch<{ id: string }>(`${SPOTIFY_API}/me`, accessToken);
  const res = await fetch(`${SPOTIFY_API}/users/${me.id}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${body || "No body"}`);
  }
  const playlist = (await res.json()) as { id: string; name: string };
  return { id: playlist.id, name: playlist.name };
}

export async function fetchPlaylistTracks(
  accessToken: string,
  playlistId: string
) {
  const tracks: SpotifyTrackDetails[] = [];
  let url: string | null = `${SPOTIFY_API}/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const data: SpotifyPaged<SpotifyPlaylistTrackItem> = await spotifyFetch<
      SpotifyPaged<SpotifyPlaylistTrackItem>
    >(url, accessToken);
    for (const item of data.items) {
      if (item.track) tracks.push(item.track);
    }
    url = data.next;
  }

  return tracks.map((track) => ({
    id: track.id ?? `${track.name}-${track.artists[0]?.name ?? "unknown"}`,
    name: track.name,
    artists: track.artists.map((artist) => artist.name).join(", "),
    image: track.album.images[0]?.url ?? null,
  }));
}

export async function fetchMostRecentLikedTrack(accessToken: string) {
  const data = await spotifyFetch<{ items: { track: SpotifyTrackDetails }[] }>(
    `${SPOTIFY_API}/me/tracks?limit=1`,
    accessToken
  );
  const track = data.items[0]?.track;
  if (!track) {
    return null;
  }
  const image = track.album.images[0]?.url ?? null;
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map((a) => a.name).join(", "),
    image,
    uri: track.uri,
  };
}

export async function addTrackToPlaylist(
  accessToken: string,
  playlistId: string,
  trackUri: string
) {
  const res = await fetch(
    `${SPOTIFY_API}/playlists/${playlistId}/tracks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [trackUri] }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${body || "No body"}`);
  }
}

export async function removeTrackFromPlaylist(
  accessToken: string,
  playlistId: string,
  trackUri: string
) {
  const res = await fetch(
    `${SPOTIFY_API}/playlists/${playlistId}/tracks`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tracks: [{ uri: trackUri }] }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${body || "No body"}`);
  }
}
