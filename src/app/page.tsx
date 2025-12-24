import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import LoginButton from "./login-button";
import Link from "next/link";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="badge">Personal Spotify sorter</div>
        <h1 className="landing-title">Sorted</h1>
        <p className="landing-subtitle">
          Sort your newest likes into the right playlists with a simple drag.
          Clean, fast, and built for momentum.
        </p>
        <div className="landing-actions">
          {session?.accessToken ? (
            <Link href="/me" className="cta">
              Let&apos;s go
            </Link>
          ) : (
            <LoginButton />
          )}
          <span className="landing-note">
            You choose the playlists. Nothing is moved without your drag.
          </span>
        </div>
        <div className="landing-stats">
          <div className="stat">
            <p className="stat-label">Flow</p>
            <p className="stat-value">Pick up to 6 playlists</p>
          </div>
          <div className="stat">
            <p className="stat-label">Speed</p>
            <p className="stat-value">Latest like on deck</p>
          </div>
          <div className="stat">
            <p className="stat-label">Control</p>
            <p className="stat-value">Drag to add, skip to pass</p>
          </div>
        </div>
      </section>

      <section className="landing-card">
        <div className="card-top">
          <div>
            <p className="card-title">Sorter Preview</p>
            <p className="card-subtitle">Your latest like, ready to place.</p>
          </div>
          <span className="card-pill">Live</span>
        </div>
        <div className="album-art">
          <img src="/spotify_logo.svg" alt="Spotify logo" />
        </div>
        <div className="track-row">
          <div>
            <p className="track-title">Most recent like</p>
            <p className="track-artist">Artist name</p>
          </div>
          <span className="track-tag">Drag me</span>
        </div>
        <div className="bubble-row">
          <span className="bubble">Chill</span>
          <span className="bubble">Drive</span>
          <span className="bubble">Focus</span>
          <span className="bubble">Dance</span>
          <span className="bubble">New</span>
          <span className="bubble">Late</span>
        </div>
      </section>
    </main>
  );
}
