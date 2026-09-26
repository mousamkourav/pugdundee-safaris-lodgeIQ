"use client";

import { useEffect, useState } from "react";
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

const roleLabel = (role: string) => role.replace(/_/g, " ");

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

  // Close the drawer on navigation (covers back/forward too).
  useEffect(() => setMobileOpen(false), [pathname]);

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
          className="fixed inset-0 z-30 bg-olive-800/35 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* sidebar: fixed 280px rail on desktop, off-canvas drawer below lg */}
      <aside
        className={
          "fixed inset-y-0 left-0 z-40 flex w-[280px] max-w-[85vw] flex-col border-r border-sand-200 bg-sand-100 transition-transform duration-200 " +
          (mobileOpen ? "translate-x-0 shadow-overlay" : "-translate-x-full lg:translate-x-0")
        }
      >
        <div className="flex h-20 shrink-0 items-center gap-3 px-5">
          <Image
            src="/pugdundee-logo-circle.jpeg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-full border border-sand-200 object-cover"
            priority
          />
          <div className="min-w-0 leading-tight">
            <p className="font-display text-xl font-bold text-olive-800">LodgeIQ</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-700">
              Pugdundee Safaris
            </p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-lg p-2 text-sand-500 hover:bg-sand-200 lg:hidden"
            aria-label="Close menu"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sand-500">
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
                        aria-current={active ? "page" : undefined}
                        className={
                          "group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition " +
                          (active
                            ? "bg-olive-600 font-semibold text-white shadow-card"
                            : "text-sand-700 hover:bg-white/70 hover:text-olive-800")
                        }
                      >
                        <Icon
                          name={item.icon}
                          className={
                            "h-[18px] w-[18px] shrink-0 " +
                            (active
                              ? "text-white"
                              : "text-sand-500 group-hover:text-olive-600")
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

        {/* user footer */}
        <div className="shrink-0 p-3">
          <div className="rounded-xl border border-sand-200 bg-white/70 p-3">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-olive-600 text-xs font-semibold text-white">
                {initials(name) || "U"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-olive-800">{name}</p>
                <p className="flex items-center gap-1.5 truncate text-xs capitalize text-sand-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                  {roleLabel(role)}
                </p>
              </div>
            </div>
            <form action={signOut}>
              <button className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm font-medium text-sand-700 transition hover:border-sand-500 hover:bg-sand-100">
                <Icon name="logout" className="h-[18px] w-[18px] text-sand-500" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-h-screen flex-col lg:pl-[280px] print:pl-0">
        {/* top bar */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-sand-200 bg-sand-50/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="-ml-1 rounded-lg p-2 text-sand-600 hover:bg-sand-100 lg:hidden"
            aria-label="Open menu"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <span className="font-display text-lg font-bold text-olive-800 lg:hidden">
            LodgeIQ
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link
              href="/notifications"
              className={
                "relative rounded-full p-2.5 transition hover:bg-sand-100 " +
                (isActive("/notifications") ? "text-olive-700" : "text-sand-600 hover:text-olive-800")
              }
              title="Notifications"
              aria-label="Notifications"
            >
              <Icon name="bell" className="h-5 w-5" />
            </Link>

            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-full py-1 pl-1 pr-1 transition hover:bg-sand-100 sm:pr-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-olive-600 text-xs font-semibold text-white ring-2 ring-white">
                  {initials(name) || "U"}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-semibold leading-tight text-olive-800">
                    {name}
                  </span>
                  <span className="block text-xs capitalize leading-tight text-sand-500">
                    {roleLabel(role)}
                  </span>
                </span>
              </summary>
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-sand-200 bg-white p-1 shadow-overlay">
                <Link
                  href="/account"
                  onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-100"
                >
                  <Icon name="userCog" className="h-[18px] w-[18px] text-sand-500" />
                  My account
                </Link>
                <form action={signOut}>
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-100">
                    <Icon name="logout" className="h-[18px] w-[18px] text-sand-500" />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
