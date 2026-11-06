"use server";

// Red Panda server actions. Each one checks the user first (rpActor / rpEditor, guard() below);
// the database checks again (RLS on rp_* and sales_*). A quote is saved as a Sales query of type
// "red_panda" with a version (plan kind "red_panda"), priced here from Master data: the browser's
// numbers are never trusted.
import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/sales/safe";
import { makeShareSlug } from "@/lib/sales/share-slug";
import { MEDIA_BUCKET } from "@/lib/sales/master/types";
import { todayIST } from "@/lib/sales/plan/load-context";
import { loadRpMaster, rpActor, rpEditor } from "@/lib/redpanda/server";
import { priceRedPanda } from "@/lib/redpanda/pricing";
import { readSettings, sanitizeRpPlan } from "@/lib/redpanda/plan";
import { checkSettingsInput, checkMoneyInput, RP_IMAGE_PREFIX } from "@/lib/redpanda/master";
import { RP_GRANTABLE_ROLES } from "@/lib/redpanda/access";

type Fail = { error: string };

// The signed-in user with Red Panda access who is also a Sales user (a quote is a Sales query).
async function guard(): Promise<Fail | { userId: string }> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };
  const a = await rpActor();
  if ("error" in a) return a;
  return { userId: a.userId };
}

export type RpSaveResult = { id?: string; error?: string; problems?: string[] };

async function insertVersion(supabase: Awaited<ReturnType<typeof createClient>>, queryId: string, queryNo: string, guestName: string, version: Record<string, unknown>) {
  let res = await supabase.from("sales_itinerary_versions").insert({ query_id: queryId, ...version, share_slug: makeShareSlug(guestName, queryNo) });
  if (res.error && /share_slug|duplicate key/i.test(res.error.message)) {
    res = await supabase.from("sales_itinerary_versions").insert({ query_id: queryId, ...version, share_slug: makeShareSlug(guestName, queryNo) });
  }
  return res;
}

// mode "draft": saved as it is (not for the guest yet). "final": every check, then Open with a link.
// An existing quote always gets a new version (new link), like the Safari builder's default.
export async function saveRpQuote(planJson: string, queryId: string | null, mode: "draft" | "final"): Promise<RpSaveResult> {
  return safe("red panda save", async () => {
    const g = await guard();
    if ("error" in g) return g;
    let raw: unknown;
    try {
      raw = JSON.parse(planJson);
    } catch {
      return { error: "The quote could not be read. Reload the page and try again." };
    }
    const plan = sanitizeRpPlan(raw);
    const { master, error } = await loadRpMaster();
    if (!master) return { error: "Could not load Red Panda Master data: " + (error ?? "") };
    const price = priceRedPanda(plan, master);
    const today = todayIST();
    if (mode === "final") {
      if (!plan.guest.name) return { error: "Enter the guest name." };
      if (!price.ok) return { problems: price.errors };
    }
    const queryFields = {
      guest_name: plan.guest.name || `Untitled draft ${today}`,
      guest_email: plan.guest.email || null,
      guest_phone: plan.guest.phone || null,
      nationality: plan.guest.nationality,
      adults: plan.guest.adults,
      children: plan.guest.child_ages,
      rooms: price.rooms || 1,
      source: plan.guest.booked_by === "agent" ? "Travel agent" : "Direct",
      agent_name: plan.guest.booked_by === "agent" ? plan.guest.agent_name || null : null,
      arrival_date: price.arrival,
      departure_date: price.departure,
      parks: ["Red Panda Outpost"],
    };
    const version = { plan, pricing: { ...price, priced_on: today }, total_amount: price.totals.grand, currency: "INR" };
    const supabase = await createClient();

    if (queryId) {
      if (!/^[0-9a-f-]{36}$/i.test(queryId)) return { error: "Query not found." };
      const { data: existing } = await supabase.from("sales_queries").select("id, status, query_no, query_type").eq("id", queryId).is("deleted_at", null).maybeSingle();
      const ex = existing as { status: string; query_no: string; query_type: string } | null;
      if (!ex) return { error: "Query not found, or it is not assigned to you." };
      if (ex.query_type !== "red_panda") return { error: "This is not a Red Panda quote." };
      if (ex.status === "lost" || ex.status === "cancelled") return { error: "Reopen this query before creating a new version." };
      if (mode === "draft" && ex.status !== "draft") return { error: "This quote has already been sent, so it cannot go back to draft." };
      const up = await supabase.from("sales_queries").update(queryFields).eq("id", queryId);
      if (up.error) return { error: up.error.message };
      const ins = await insertVersion(supabase, queryId, ex.query_no, queryFields.guest_name, version);
      if (ins.error) return { error: ins.error.message };
      if (mode === "final" && ex.status === "draft") {
        const fin = await supabase.from("sales_queries").update({ status: "open" }).eq("id", queryId);
        if (fin.error) return { error: "Saved, but the draft could not be finalised: " + fin.error.message };
      }
      revalidatePath(`/red-panda/quotes/${queryId}`);
      revalidatePath("/sales", "layout");
      revalidatePath("/red-panda");
      return { id: queryId };
    }

    const q = await supabase
      .from("sales_queries")
      .insert({ ...queryFields, query_type: "red_panda", status: mode === "draft" ? "draft" : "open" })
      .select("id, query_no")
      .single();
    if (q.error) return { error: /query_type/.test(q.error.message) ? "Run supabase/red_panda.sql in Supabase first." : q.error.message };
    const id = (q.data as { id: string }).id;
    const ins = await insertVersion(supabase, id, (q.data as { query_no: string }).query_no, queryFields.guest_name, version);
    if (ins.error) {
      await createAdminClient().from("sales_queries").delete().eq("id", id); // members cannot delete queries
      return { error: "Could not save the quote: " + ins.error.message };
    }
    revalidatePath("/sales", "layout");
    revalidatePath("/red-panda");
    return { id };
  });
}

// ------------------------------------------------------------------ Master data (super admin)

async function editor(): Promise<Fail | { userId: string }> {
  const e = await rpEditor();
  return e;
}

export async function saveTariffRate(id: string, perPax: unknown, active: boolean): Promise<{ ok?: true; error?: string }> {
  return safe("red panda tariff", async () => {
    const e = await editor();
    if ("error" in e) return e;
    const v = checkMoneyInput(perPax);
    if (v == null || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "Type the rate in rupees (0 or more)." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("rp_tariff").update({ per_pax: v, active, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Not saved (only the super admin can change rates)." };
    revalidatePath("/red-panda/master");
    return { ok: true };
  });
}

export async function saveSupplement(id: string, amount: unknown, active: boolean): Promise<{ ok?: true; error?: string }> {
  return safe("red panda supplement", async () => {
    const e = await editor();
    if ("error" in e) return e;
    const v = checkMoneyInput(amount);
    if (v == null || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "Type the amount in rupees (0 or more)." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("rp_supplements").update({ amount: v, active, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Not saved (only the super admin can change rates)." };
    revalidatePath("/red-panda/master");
    return { ok: true };
  });
}

// A new year: a copy of the latest year's tariff and supplements with new dates (rates to edit).
export async function addTariffYear(season: string, from: string, to: string): Promise<{ ok?: true; error?: string }> {
  return safe("red panda new year", async () => {
    const e = await editor();
    if ("error" in e) return e;
    const s = String(season ?? "").trim().slice(0, 40);
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return { error: "Give the year's name and its first and last dates." };
    const supabase = await createClient();
    const { data: rows } = await supabase.from("rp_tariff").select("valid_from, market, guests, per_pax").order("valid_from", { ascending: false });
    const all = (rows ?? []) as { valid_from: string; market: string; guests: number; per_pax: number }[];
    if (!all.length) return { error: "There is no tariff to copy." };
    if (all.some((r) => String(r.valid_from).slice(0, 10) === from)) return { error: "A year starting on that date is already there." };
    const latest = String(all[0].valid_from).slice(0, 10);
    const copy = all.filter((r) => String(r.valid_from).slice(0, 10) === latest).map((r) => ({ season: s, valid_from: from, valid_to: to, market: r.market, guests: r.guests, per_pax: r.per_pax }));
    const ins = await supabase.from("rp_tariff").insert(copy);
    if (ins.error) return { error: ins.error.message };
    const { data: sup } = await supabase.from("rp_supplements").select("market, kind, amount").eq("valid_from", latest);
    if (sup?.length) {
      const s2 = await supabase.from("rp_supplements").insert((sup as { market: string; kind: string; amount: number }[]).map((r) => ({ ...r, season: s, valid_from: from, valid_to: to })));
      if (s2.error) return { error: s2.error.message };
    }
    revalidatePath("/red-panda/master");
    return { ok: true };
  });
}

export async function saveRpSettings(json: string): Promise<{ ok?: true; error?: string; problems?: string[] }> {
  return safe("red panda settings", async () => {
    const e = await editor();
    if ("error" in e) return e;
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { error: "The settings could not be read." };
    }
    const checked = checkSettingsInput(raw);
    if (checked.problems.length) return { problems: checked.problems };
    const supabase = await createClient();
    const { data: cur } = await supabase.from("rp_settings").select("data").eq("id", 1).maybeSingle();
    // keep anything the screen does not edit
    const data = { ...(((cur as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>), ...checked.data };
    const { data: up, error } = await supabase.from("rp_settings").upsert({ id: 1, data, updated_at: new Date().toISOString() }).select("id");
    if (error) return { error: error.message };
    if (!up?.length) return { error: "Not saved (only the super admin can change this)." };
    readSettings(data); // throws nothing; a sanity read
    revalidatePath("/red-panda/master");
    return { ok: true };
  });
}

// Photos: a signed upload link into the public sales-media bucket under red-panda/, then a row.
export async function rpImageUploadUrl(fileName: string, size: number): Promise<{ path?: string; token?: string; error?: string }> {
  return safe("red panda photo link", async () => {
    const e = await editor();
    if ("error" in e) return e;
    const ext = (/\.(jpe?g|png|webp)$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
    if (!ext) return { error: "Photos only: JPG, PNG or WebP." };
    if (!(Number(size) > 0) || Number(size) > 8 * 1024 * 1024) return { error: "A photo must be under 8 MB." };
    const path = `${RP_IMAGE_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext === "jpeg" ? "jpg" : ext}`;
    const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { error: error?.message ?? "Could not get an upload link." };
    return { path, token: data.token };
  });
}

export async function addRpImage(path: string, caption: string): Promise<{ ok?: true; error?: string }> {
  return safe("red panda photo", async () => {
    const e = await editor();
    if ("error" in e) return e;
    if (!new RegExp(`^${RP_IMAGE_PREFIX}[0-9]+-[0-9a-f]{8}\\.(jpg|png|webp)$`).test(String(path))) return { error: "Unknown photo." };
    const supabase = await createClient();
    const { count } = await supabase.from("rp_images").select("id", { count: "exact", head: true });
    const { error } = await supabase.from("rp_images").insert({ storage_path: path, caption: String(caption ?? "").trim().slice(0, 200) || null, is_cover: !count, sort: (count ?? 0) + 1 });
    if (error) return { error: error.message };
    revalidatePath("/red-panda/master");
    return { ok: true };
  });
}

export async function updateRpImage(id: string, change: { cover?: boolean; caption?: string; sort?: number; remove?: boolean }): Promise<{ ok?: true; error?: string }> {
  return safe("red panda photo change", async () => {
    const e = await editor();
    if ("error" in e) return e;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown photo." };
    const supabase = await createClient();
    if (change.remove) {
      const { data } = await supabase.from("rp_images").delete().eq("id", id).select("storage_path");
      const p = (data?.[0] as { storage_path?: string } | undefined)?.storage_path;
      if (p && p.startsWith(RP_IMAGE_PREFIX)) await createAdminClient().storage.from(MEDIA_BUCKET).remove([p]);
    } else if (change.cover) {
      await supabase.from("rp_images").update({ is_cover: false }).neq("id", id);
      await supabase.from("rp_images").update({ is_cover: true }).eq("id", id);
    } else {
      const upd: Record<string, unknown> = {};
      if (typeof change.caption === "string") upd.caption = change.caption.trim().slice(0, 200) || null;
      if (Number.isFinite(change.sort)) upd.sort = Math.max(0, Math.min(1000, Math.floor(Number(change.sort))));
      if (Object.keys(upd).length) {
        const { error } = await supabase.from("rp_images").update(upd).eq("id", id);
        if (error) return { error: error.message };
      }
    }
    revalidatePath("/red-panda/master");
    return { ok: true };
  });
}

// ------------------------------------------------------------------ access (super admin)

export async function grantRpAccess(kind: "user" | "role", value: string): Promise<{ ok?: true; error?: string }> {
  return safe("red panda grant", async () => {
    const e = await editor();
    if ("error" in e) return e;
    const supabase = await createClient();
    if (kind === "role") {
      if (!(RP_GRANTABLE_ROLES as readonly string[]).includes(value)) return { error: "Red Panda access is for Sales roles." };
      const { error } = await supabase.from("rp_access").insert({ role: value });
      if (error && !/duplicate/i.test(error.message)) return { error: error.message };
    } else {
      if (!/^[0-9a-f-]{36}$/i.test(value)) return { error: "Choose a person." };
      const { data: p } = await createAdminClient().from("profiles").select("role").eq("id", value).maybeSingle();
      if (!isSalesUser((p as { role?: string } | null)?.role)) return { error: "Red Panda quotes are Sales queries: give access to Sales users only." };
      const { error } = await supabase.from("rp_access").insert({ user_id: value });
      if (error && !/duplicate/i.test(error.message)) return { error: error.message };
    }
    revalidatePath("/red-panda/access");
    return { ok: true };
  });
}

export async function revokeRpAccess(id: string): Promise<{ ok?: true; error?: string }> {
  return safe("red panda revoke", async () => {
    const e = await editor();
    if ("error" in e) return e;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown access row." };
    const { error } = await (await createClient()).from("rp_access").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/red-panda/access");
    return { ok: true };
  });
}
