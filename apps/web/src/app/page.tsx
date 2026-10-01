import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold text-ink">Mechanic Pulse</h1>
      <p className="text-brass">
        Placeholder — real Home page per docs/mechanic-pulse-frontend-spec.md is next iteration.
      </p>
      <Link href="/login" className="rounded-lg bg-brass text-white px-4 py-2.5 font-medium">
        Mechanic login
      </Link>
    </main>
  );
}
