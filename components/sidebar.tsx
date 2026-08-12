"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";
import type { Role } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export function Sidebar({ role, name }: { role: Role; name: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-sand-200 bg-white">
      <div className="border-b border-sand-200 p-4">
        <Image
          src="/pugdundee-logo-horizontal.jpeg"
          alt="Pugdundee Safaris"
          width={180}
          height={48}
          className="h-10 w-auto object-contain"
          priority
        />
        <p className="mt-2 text-xs text-sand-500">LodgeIQ · Operations</p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {NAV.map((group) => {
          const items = group.items.filter(
            (i) => !i.roles || i.roles.includes(role)
          );
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-sand-400">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={
                          "block border-l-2 px-3 py-2 text-sm transition " +
                          (active
                            ? "border-gold-500 bg-olive-50 font-medium text-olive-800"
                            : "border-transparent text-sand-700 hover:bg-sand-50")
                        }
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sand-200 p-3">
        <div className="mb-2 px-2">
          <p className="truncate text-sm font-medium text-sand-800">{name}</p>
          <p className="text-xs capitalize text-sand-500">
            {role.replace("_", " ")}
          </p>
        </div>
        <form action={signOut}>
          <button className="w-full rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-50">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
