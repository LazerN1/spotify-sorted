import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SorterClient from "./sorter-client";

export default async function SorterPage() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-neutral-100">
      <h1 className="text-2xl font-semibold">Select your playlists</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Pick up to 5 playlists to sort into
      </p>
      <SorterClient />
    </main>
  );
}
