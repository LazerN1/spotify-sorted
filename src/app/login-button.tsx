"use client";

import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button
      onClick={() => signIn("spotify")}
      className="cta"
    >
      Connect Spotify
    </button>
  );
}
