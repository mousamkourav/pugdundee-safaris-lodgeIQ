import Image from "next/image";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen grid place-items-center bg-sand-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-sand-200 bg-white p-8">
        <Image
          src="/pugdundee-logo-horizontal.jpeg"
          alt="Pugdundee Safaris"
          width={220}
          height={60}
          className="mx-auto h-12 w-auto object-contain"
          priority
        />
        <h1 className="mt-6 text-center text-xl">Sign in to LodgeIQ</h1>
        <p className="mt-1 text-center text-sm text-sand-600">
          Lodge operations &amp; reporting
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}

        <form action={login} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-sand-700">Email</label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-sand-700">Password</label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
            />
          </div>
          <button className="w-full rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700">
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-sand-400">
          by Pugdundee Safaris
        </p>
      </div>
    </div>
  );
}
