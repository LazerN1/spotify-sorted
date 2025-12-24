"use client";

import { signOut, useSession } from "next-auth/react";

export default function AccountMenu() {
  const { status } = useSession();

  if (status !== "authenticated") {
    return null;
  }

  return (
    <div className="group fixed right-6 top-6 z-50">
      <button className="rounded-md border border-neutral-300 bg-white/80 px-3 py-1 text-sm backdrop-blur">
        Account
      </button>
      <div className="absolute right-0 mt-2 hidden min-w-[120px] rounded-md border border-neutral-200 bg-white p-1 shadow-md group-hover:block">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
