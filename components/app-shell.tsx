"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";
import { Icon } from "./icons";
import type { Role } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}

export function AppShell({
  role,
  name,
  children,
}: {
  role: Role;
  name: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen bg-sand-50">
      {/* mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* sidebar — fixed width, no collapse */}
      <aside
        className={
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sand-200 bg-white transition-transform duration-200 " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")
        }
      >
        <div className="flex h-14 shrink-0 items-center border-b border-sand-200 px-4">
          <Image
            src="/pugdundee-logo-horizontal.jpeg"
            alt="Pugdundee Safaris"
            width={160}
            height={40}
            className="h-8 w-auto object-contain"
            priority
          />
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sand-400">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={
                          "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition " +
                          (active
                            ? "bg-olive-50 font-medium text-olive-800"
                            : "text-sand-600 hover:bg-sand-50 hover:text-sand-800")
                        }
                      >
                        <Icon
                          name={item.icon}
                          className={
                            "h-[18px] w-[18px] shrink-0 " +
                            (active
                              ? "text-olive-700"
                              : "text-sand-400 group-hover:text-sand-600")
                          }
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* quiet user footer */}
        <div className="shrink-0 border-t border-sand-200 p-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-olive-600 text-xs font-semibold text-white">
              {initials(name) || "U"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sand-800">{name}</p>
              <p className="truncate text-xs capitalize text-sand-400">
                {role.replace(/_/g, " ")}
              </p>
            </div>
          </div>
          <form action={signOut}>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-50">
              <Icon name="logout" className="h-[18px] w-[18px] text-sand-400" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* top bar */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-sand-200 bg-white/90 px-4 backdrop-blur lg:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-sand-600 hover:bg-sand-50 lg:hidden"
            aria-label="Open menu"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/notifications"
              className="rounded-lg p-2 text-sand-500 transition hover:bg-sand-50 hover:text-sand-800"
              title="Notifications"
            >
              <Icon name="bell" className="h-[18px] w-[18px]" />
            </Link>

            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-sand-50">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-olive-600 text-xs font-semibold text-white">
                  {initials(name) || "U"}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium leading-tight text-sand-800">
                    {name}
                  </span>
                  <span className="block text-xs capitalize leading-tight text-sand-400">
                    {role.replace(/_/g, " ")}
                  </span>
                </span>
              </summary>
              <div className="absolute right-0 mt-1 w-44 rounded-xl border border-sand-200 bg-white p-1 shadow-lg">
                <form action={signOut}>
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-50">
                    <Icon name="logout" className="h-[18px] w-[18px] text-sand-400" />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-5 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
