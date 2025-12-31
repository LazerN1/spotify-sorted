"use client";

import { signOut, useSession } from "next-auth/react";

export default function AccountMenu() {
  const { status } = useSession();

  if (status !== "authenticated") {
    return null;
  }

  return (
    <div className="account-menu group relative">
      <button className="account-trigger">
        Account
      </button>
      <div className="account-dropdown">
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
