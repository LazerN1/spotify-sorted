"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";

export default function SessionExpiredModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-neutral-900 shadow-lg">
        <h2 className="text-lg font-semibold">Session expired</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Please log back in to refresh your Spotify access.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            className="rounded-md bg-black px-4 py-2 text-sm text-white"
            onClick={() => signIn("spotify")}
          >
            Log in again
          </button>
          <Link
            href="/"
            className="btn-outline rounded-md border border-neutral-300 px-4 py-2 text-sm"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}