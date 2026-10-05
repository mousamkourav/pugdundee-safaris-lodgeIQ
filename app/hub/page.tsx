import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin, homePathFor, ROLE_LABELS, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icons";
import { ui } from "@/components/ui";

// Module picker shown after sign-in to super roles. Everyone else is sent
// straight to their own module.
export default async function HubPage() {
  const { profile } = await requireUser();
  const role = profile?.role as Role | undefined;
  if (!isSuperAdmin(role)) redirect(homePathFor(role));

  const supabase = await createClient();
  const { count: openCount } = await supabase
    .from("sales_queries")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  const name: string = profile?.full_name || "there";
  const first = name.split(" ")[0];
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date())
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const cards = [
    {
      href: "/dashboard",
      title: "Lodge Reporting",
      body: "Monthly reports, dashboards, compliance, trips and tasks for all lodges.",
      icon: "barChart",
      band: "bg-olive-800",
      stat: null as string | null,
    },
    {
      href: "/sales",
      title: "Sales & Itinerary",
      body: "Build itineraries, track queries and review team performance.",
      icon: "route",
      band: "bg-olive-600",
      stat: `${openCount ?? 0} open ${openCount === 1 ? "query" : "queries"}`,
    },
  ];

  return (
    <div className="min-h-screen bg-sand-50">
      <header className="flex h-16 items-center justify-between border-b border-sand-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Image
            src="/pugdundee-logo-circle.jpeg"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-full border border-sand-200 object-cover"
            priority
          />
          <div className="leading-tight">
            <p className="font-display text-lg font-bold text-olive-800">LodgeIQ</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-700">Pugdundee Safaris</p>
          </div>
        </div>
        <p className="text-sm text-sand-500">
          <span className="font-semibold text-olive-800">{name}</span>
          {role && <span className="hidden sm:inline"> &middot; {ROLE_LABELS[role]}</span>}
        </p>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl">
          {greeting}, {first}
        </h1>
        <p className="mt-2 text-sm text-sand-500">
          Choose where you want to work. You can switch anytime from the top bar.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={`${ui.card} ${ui.cardHover} group overflow-hidden hover:border-olive-600`}
            >
              <div className={`flex h-32 items-end p-6 ${c.band}`}>
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/15 text-white">
                  <Icon name={c.icon} className="h-6 w-6" />
                </span>
              </div>
              <div className="p-6">
                <h2 className="text-lg">{c.title}</h2>
                <p className="mt-1 text-sm text-sand-500">{c.body}</p>
                <div className="mt-5 flex items-center justify-between border-t border-sand-200 pt-4">
                  <span className="text-sm text-sand-500">{c.stat ?? ""}</span>
                  <span className={`${ui.btnPrimary} ${ui.btnSm}`}>Open</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
