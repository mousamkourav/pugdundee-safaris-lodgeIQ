import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { MasterForm } from "@/components/sales/master-form";
import { SETTINGS_FIELDS, getPath } from "@/lib/sales/master/settings";
import { saveSettings } from "../actions";

export default async function SalesSettingsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle();
  const stored = ((data as { data?: unknown } | null)?.data ?? {}) as Record<string, unknown>;

  const values: Record<string, unknown> = {};
  for (const f of SETTINGS_FIELDS) {
    const v = getPath(stored, f.path);
    values[f.name] = v === undefined ? f.initial : v;
  }
  // The client form only needs plain field definitions.
  const fields = SETTINGS_FIELDS.map((f) => ({ ...f, path: undefined }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
        <h1 className="mt-1 text-2xl">Sales settings</h1>
        <p className="mt-1 text-sm text-sand-500">Company details, currency, markup, quote validity, payment schedule and cancellation charges.</p>
      </div>
      {error && <p className={ui.alertError}>Could not load settings: {error.message}</p>}
      {!data && !error && <p className={ui.alertError}>The settings row is missing. Re-run the seed part of sales_module_v1.sql.</p>}
      <MasterForm fields={fields} values={values} action={saveSettings} backHref="/sales/admin" submitLabel="Save settings" />
    </div>
  );
}
