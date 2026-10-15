f = r"app/(dashboard)/monthly/page.tsx"
t = open(f, encoding="utf-8").read()
orig = t

def repl(old, new, label):
    global t
    if old not in t:
        print("!! MISSING:", label); return
    t = t.replace(old, new, 1); print("ok:", label)

# 1. imports: add lodgeSlug + Icon
repl(
'import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";',
'import { getAccessibleLodges, resolveLodge, lodgeSlug } from "@/lib/lodges";\nimport { Icon } from "@/components/icons";',
"imports")

# 2. drafts query - add right after `const data = ...` line
repl(
'''  const row = rowData as Record<string, unknown> | null;
  const data = (row?.data as Record<string, unknown>) ?? {};''',
'''  const row = rowData as Record<string, unknown> | null;
  const data = (row?.data as Record<string, unknown>) ?? {};

  // Drafts in progress (user's accessible lodges via RLS), newest first.
  const { data: draftRows } = await s
    .from("monthly_submissions")
    .select("lodge_id, month")
    .eq("status", "draft")
    .order("month", { ascending: false })
    .limit(24);
  const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const drafts = ((draftRows ?? []) as Array<{ lodge_id: string; month: string }>).map((dr) => {
    const ln = lodges.find((l) => l.id === dr.lodge_id)?.name ?? "Lodge";
    const ym = String(dr.month).slice(0, 7);
    const [yy, mmv] = ym.split("-");
    return { key: dr.lodge_id + ym, lodgeName: ln, slug: lodgeSlug(ln), ym, label: `${MONTH_NAMES[Number(mmv)] ?? mmv} ${yy}` };
  });''',
"drafts query")

# 3. banner after the picker
repl(
'''      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {/* status banner */}''',
'''      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {drafts.length > 0 && (
        <div className="mb-6 rounded-xl border border-pending-border bg-pending-bg/40 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
            <Icon name="clock" className="h-4 w-4" />
            Drafts in progress - continue where you left off
          </p>
          <div className="flex flex-wrap gap-2">
            {drafts.map((dr) => (
              <a
                key={dr.key}
                href={`/monthly?lodge=${encodeURIComponent(dr.slug)}&month=${dr.ym}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm font-medium text-sand-700 transition hover:border-olive-600 hover:text-olive-800"
              >
                {dr.lodgeName} - {dr.label}
                <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* status banner */}''',
"banner")

open(f, "w", encoding="utf-8").write(t)
print("changed:", t != orig)
