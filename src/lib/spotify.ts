const SPOTIFY_API = "https://api.spotify.com/v1";

type SpotifyArtist = {
  id: string;
  name: string;
};

type SpotifyTrack = {
  id: string | null;
  name: string;
  artists: SpotifyArtist[];
};

type LikedTrackItem = {
  track: SpotifyTrack;
};

export type TrackRow = {
  id: string;
  name: string;
  artists: string;
};

type SpotifyPlaylist = {
  id: string;
  name: string;
  tracks: { total: number };
  owner: { display_name?: string | null };
};

type SpotifyImage = {
  url: string;
  width: number | null;
  height: number | null;
};

type SpotifyTrackDetails = {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: { images: SpotifyImage[] };
  uri: string;
};

async function spotifyFetch<T>(url: string, accessToken: string): Promise<T> {
  if (!accessToken) {
    throw new Error(`Spotify access token missing for request: ${url}`);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Spotify API error ${res.status} for ${url}: ${body || "No body"}`
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchLikedTracks(
  accessToken: string
): Promise<TrackRow[]> {
  const likedTracks: SpotifyTrack[] = [];
  let url: string | null = `${SPOTIFY_API}/me/tracks?limit=50`;

  while (url) {
    const data = await spotifyFetch<{
      items: LikedTrackItem[];
      next: string | null;
    }>(url, accessToken);
    for (const item of data.items) {
      if (item.track) likedTracks.push(item.track);
    }
    url = data.next;
  }

  return likedTracks.map((track) => {
    const id = track.id ?? `${track.name}-${track.artists[0]?.name ?? "unknown"}`;

    return {
      id,
      name: track.name,
      artists: track.artists.map((a) => a.name).join(", "),
    };
  });
}

export async function fetchPlaylists(accessToken: string) {
  const playlists: SpotifyPlaylist[] = [];
  let url: string | null = `${SPOTIFY_API}/me/playlists?limit=50`;

  while (url) {
    const data = await spotifyFetch<{
      items: SpotifyPlaylist[];
      next: string | null;
    }>(url, accessToken);
    playlists.push(...data.items);
    url = data.next;
  }

  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner?.display_name ?? "Unknown",
    total: playlist.tracks.total,
  }));
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
