import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import MeClient from "./me-client";

export default async function MePage() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/" className="text-sm text-neutral-600">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Your Liked Songs</h1>
      <MeClient />
    </main>
  );
}
