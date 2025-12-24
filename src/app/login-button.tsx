"use client";

import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button
      onClick={() => signIn("spotify")}
      className="rounded-md bg-black px-5 py-2 text-white"
    >
      Connect Spotify
    </button>
  );
}
