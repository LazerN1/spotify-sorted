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
    <main className="mx-auto max-w-6xl px-6 pb-6 pt-4 text-neutral-100">
      <SorterPlayClient ids={ids} />
    </main>
  );
}
