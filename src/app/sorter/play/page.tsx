import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import SorterPlayClient from "./sorter-play-client";

type SearchParams = {
  ids?: string;
};

export default async function SorterPlayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect("/");
  }

  const resolvedParams = await searchParams;
  const ids = resolvedParams.ids ?? "";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/sorter" className="text-sm text-neutral-600">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Sorter</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Drag the album art to a playlist bubble.
      </p>
      <SorterPlayClient ids={ids} />
    </main>
  );
}
