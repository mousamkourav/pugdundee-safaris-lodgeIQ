"use server";

// Turn a quote's client links off or on (all its versions, old /i/ links too). The quote's own
// member or a Sales admin; the change is written to sales_link_audit (who, when).
import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesAdmin, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/sales/safe";

export async function setClientLink(queryId: string, on: boolean): Promise<{ ok?: true; error?: string }> {
  return safe("client link", async () => {
    const cu = await getCurrentUser();
    if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "Sales only." };
    if (!/^[0-9a-f-]{36}$/i.test(queryId)) return { error: "Unknown quote." };
    // the user must be able to open the quote (row level security), and own it or be a Sales admin
    const { data: q } = await (await createClient()).from("sales_queries").select("id, assigned_to, query_type").eq("id", queryId).is("deleted_at", null).maybeSingle();
    const row = q as { id: string; assigned_to: string | null; query_type?: string } | null;
    if (!row) return { error: "Quote not found." };
    if (row.assigned_to !== cu.user.id && !isSalesAdmin(cu.profile?.role)) return { error: "Only the quote's own member or a Sales admin can do this." };
    const db = createAdminClient();
    const { error } = await db
      .from("sales_queries")
      .update(on ? { share_disabled_at: null, share_disabled_by: null } : { share_disabled_at: new Date().toISOString(), share_disabled_by: cu.user.id })
      .eq("id", queryId);
    if (error) return { error: /share_disabled/.test(error.message) ? "Run supabase/sales_quote_links.sql in Supabase first." : error.message };
    await db.from("sales_link_audit").insert({ query_id: queryId, action: on ? "on" : "off", changed_by: cu.user.id }).then(() => undefined, () => undefined);
    revalidatePath(row.query_type === "red_panda" ? `/red-panda/quotes/${queryId}` : `/sales/queries/${queryId}`);
    return { ok: true };
  });
}
