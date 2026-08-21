import { requireUser, isAdmin } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { SECTIONS, getPath, type Field, type ArrayBlock } from "@/lib/monthly";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { saveDraft, submitReport, reopenReport, deleteReport } from "./actions";

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500 disabled:bg-sand-50 disabled:text-sand-500";

function inputType(t: string): string {
  if (t === "number" || t === "rating") return "number";
  if (t === "date") return "date";
  return "text";
}

function ScalarField({
  f,
  data,
  locked,
}: {
  f: Field;
  data: Record<string, unknown>;
  locked: boolean;
}) {
  const v = getPath(data, f.path);
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-sand-500">{f.label}</span>
      <input
        name={`d:${f.path}`}
        type={inputType(f.type)}
        step={f.type === "rating" ? "0.1" : f.type === "number" ? "0.01" : undefined}
        defaultValue={v === undefined || v === null ? "" : String(v)}
        disabled={locked}
        className={inputCls}
      />
    </label>
  );
}

function ArrayField({
  block,
  data,
  locked,
}: {
  block: ArrayBlock;
  data: Record<string, unknown>;
  locked: boolean;
}) {
  const rows = (getPath(data, block.path) as Array<Record<string, unknown>>) ?? [];
  return (
    <div className="mb-2">
      <p className="mb-2 text-sm font-medium text-sand-700">{block.label}</p>
      <div className="space-y-2">
        {Array.from({ length: block.rows }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
          >
            {block.columns.map((c) => {
              const cur = rows[i]?.[c.key];
              return (
                <input
                  key={c.key}
                  name={`d:${block.path}[${i}].${c.key}`}
                  type={inputType(c.type)}
                  step={c.type === "number" ? "0.01" : undefined}
                  placeholder={c.label}
                  defaultValue={cur === undefined || cur === null ? "" : String(cur)}
                  disabled={locked}
                  className={inputCls}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Monthly report" />;

  const { start, label } = monthRange(month);
  const admin = isAdmin(profile?.role);
  const s = await createClient();
  const { data: rowData } = await s
    .from("monthly_submissions")
    .select("*")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .maybeSingle();

  const row = rowData as Record<string, unknown> | null;
  const data = (row?.data as Record<string, unknown>) ?? {};
  const status = (row?.status as string) ?? "none";
  const submitted = status === "submitted";
  // Managers get read-only once submitted; admins can always edit.
  const locked = submitted && !admin;
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";

  return (
    <div>
      <PageHeader
        title="Monthly report"
        description={`${lodgeName} · ${label}`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {/* status banner */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-sand-200 bg-white p-4">
        <span className="text-sm text-sand-600">Status:</span>
        <span
          className={
            "rounded-full px-3 py-1 text-xs capitalize " +
            (submitted
              ? "bg-success-bg text-success"
              : status === "draft"
              ? "bg-warning-bg text-warning"
              : "bg-sand-100 text-sand-600")
          }
        >
          {status === "none" ? "Not started" : status}
        </span>
        {locked && (
          <span className="text-sm text-sand-500">
            Submitted and locked. Contact an administrator to make changes.
          </span>
        )}
        {admin && row && (
          <div className="ml-auto flex gap-2">
            {submitted && (
              <form action={reopenReport}>
                <input type="hidden" name="id" value={String(row.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50">
                  Reopen for editing
                </button>
              </form>
            )}
            {profile?.role === "super_admin" && (
              <form action={deleteReport}>
                <input type="hidden" name="id" value={String(row.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className="rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error-bg">
                  Delete
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <form action={saveDraft}>
        <input type="hidden" name="lodge_id" value={lodge} />
        <input type="hidden" name="month" value={month} />

        <div className="space-y-6">
          {SECTIONS.map((sec) => (
            <section
              key={sec.key}
              className="rounded-xl border border-sand-200 bg-white p-5"
            >
              <h2 className="mb-4 text-base">{sec.title}</h2>
              {sec.fields && sec.fields.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {sec.fields.map((f) => (
                    <ScalarField key={f.path} f={f} data={data} locked={locked} />
                  ))}
                </div>
              )}
              {sec.arrays?.map((b) => (
                <ArrayField key={b.path} block={b} data={data} locked={locked} />
              ))}
            </section>
          ))}
        </div>

        {!locked && (
          <div className="sticky bottom-4 mt-6 flex gap-3 rounded-xl border border-sand-200 bg-white/95 p-4 shadow-sm backdrop-blur">
            <button
              formAction={saveDraft}
              className="rounded-lg border border-sand-200 px-5 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
            >
              Save draft
            </button>
            <button
              formAction={submitReport}
              className="rounded-lg bg-olive-600 px-5 py-2 text-sm font-medium text-white hover:bg-olive-700"
            >
              {admin ? "Save & mark submitted" : "Submit (locks report)"}
            </button>
            <span className="self-center text-xs text-sand-500">
              {admin
                ? "As admin you can edit anytime."
                : "Once submitted you can't edit — an admin can reopen it if needed."}
            </span>
          </div>
        )}
      </form>
    </div>
  );
}
