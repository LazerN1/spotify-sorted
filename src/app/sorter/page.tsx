import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import SorterClient from "./sorter-client";

export default async function SorterPage() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/me" className="text-sm text-neutral-600">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Sorter</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Pick up to 6 playlists to sort into.
      </p>
      <SorterClient />
    </main>
  );
}
