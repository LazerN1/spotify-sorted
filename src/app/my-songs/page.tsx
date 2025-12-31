import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import MeClient from "./me-client";

export default async function MePage() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-neutral-100">
      <h1 className="text-2xl font-semibold">Your Liked Songs</h1>
      <MeClient />
    </main>
  );
}
