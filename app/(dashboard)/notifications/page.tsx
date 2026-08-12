import { requireUser, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { runChecks, markRead } from "./actions";

const SEV: Record<string, { t: string; cls: string }> = {
  critical: { t: "Critical", cls: "bg-error-bg text-error" },
  warning: { t: "Warning", cls: "bg-warning-bg text-warning" },
  info: { t: "Info", cls: "bg-info-bg text-info" },
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; sent?: string }>;
}) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  const admin = isAdmin(profile?.role);

  const s = await createClient();
  const { data } = await s
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as Array<Record<string, string | string[]>>;
  const unread = rows.filter((r) => r.status === "pending" || r.status === "sent")
    .length;
  const critical = rows.filter((r) => r.severity === "critical").length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Service-expiry, bar rate changes and reminders. Alerts are emailed to the right people."
        action={
          admin ? (
            <form action={runChecks}>
              <button className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white hover:bg-olive-700">
                Run checks now
              </button>
            </form>
          ) : null
        }
      />

      {(sp.created !== undefined || sp.sent !== undefined) && (
        <p className="mb-6 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
          Scan complete — {sp.created ?? 0} new alert(s) created, {sp.sent ?? 0}{" "}
          email(s) sent.
        </p>
      )}

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Active alerts" value={unread} />
        <KpiCard label="Critical" value={critical} />
        <KpiCard label="Total (recent)" value={rows.length} />
      </div>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sand-500">
            No notifications yet. {admin ? 'Click "Run checks now" to scan.' : ""}
          </div>
        ) : (
          rows.map((r) => {
            const sev = SEV[r.severity as string] ?? SEV.info;
            const read = r.status === "read";
            return (
              <div
                key={String(r.id)}
                className={
                  "flex items-start justify-between gap-4 rounded-xl border p-4 " +
                  (read
                    ? "border-sand-200 bg-sand-50"
                    : "border-sand-200 bg-white")
                }
              >
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${sev.cls}`}
                    >
                      {sev.t}
                    </span>
                    <span className="font-medium text-sand-800">{r.title}</span>
                  </div>
                  <p className="text-sm text-sand-600">{r.body}</p>
                  <p className="mt-1 text-xs text-sand-400">
                    {String(r.created_at).slice(0, 16).replace("T", " ")} ·{" "}
                    {r.status}
                  </p>
                </div>
                {!read && (
                  <form action={markRead}>
                    <input type="hidden" name="id" value={String(r.id)} />
                    <button className="whitespace-nowrap text-xs text-olive-700 hover:underline">
                      Mark read
                    </button>
                  </form>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
