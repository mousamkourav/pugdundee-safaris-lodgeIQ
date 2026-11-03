"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sopActor } from "@/lib/sop/server";
import { isUuid } from "@/lib/sop/content";

type Result = { ok: true } | { error: string };

// "I have read version N": only for the current version, only for yourself (RLS checks both too).
export async function acknowledgeSop(versionId: string): Promise<Result> {
  const cu = await getCurrentUser();
  if (!cu?.user) return { error: "Please sign in again." };
  const a = await sopActor();
  if ("error" in a) return a;
  if (!isUuid(versionId) || versionId !== a.status.versionId) return { error: "A newer version has been published. Please open the SOP again." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("sop_reads").upsert({ version_id: versionId, user_id: a.userId }, { onConflict: "version_id,user_id", ignoreDuplicates: true });
    if (error) return { error: "Could not save. Please try again." };
  } catch {
    return { error: "The database could not be reached. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
