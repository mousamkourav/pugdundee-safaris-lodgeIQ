import Image from "next/image";
import { signOut } from "@/app/login/actions";

export default function AccountInactivePage() {
  return (
    <div className="min-h-screen grid place-items-center bg-sand-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-sand-200 bg-white p-8 text-center">
        <Image
          src="/pugdundee-logo-horizontal.jpeg"
          alt="Pugdundee Safaris"
          width={220}
          height={60}
          className="mx-auto h-12 w-auto object-contain"
          priority
        />
        <h1 className="mt-6 text-xl">Account deactivated</h1>
        <p className="mt-2 text-sm text-sand-600">
          Your access has been turned off. Contact an administrator if you think
          this is a mistake.
        </p>
        <form action={signOut} className="mt-6">
          <button className="w-full rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700">
            Return to sign in
          </button>
        </form>
      </div>
    </div>
  );
}
