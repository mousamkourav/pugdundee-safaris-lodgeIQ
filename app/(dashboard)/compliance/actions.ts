"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function back(lodge: string) {
  revalidatePath("/compliance");
  redirect(`/compliance?lodge=${lodge}`);
}

function orNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

export async function addDocument(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const supabase = await createClient();
  await supabase.from("compliance_documents").insert({
    lodge_id,
    doc_type: String(formData.get("doc_type") ?? "insurance"),
    title: String(formData.get("title")),
    authority: orNull(formData.get("authority")),
    reference_no: orNull(formData.get("reference_no")),
    issue_date: orNull(formData.get("issue_date")),
    expiry_date: String(formData.get("expiry_date")),
    notes: orNull(formData.get("notes")),
    created_by: cu.user.id,
  });
  back(lodge_id);
}

export async function deleteDocument(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("compliance_documents")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")));
}

// Renewal: push the expiry date forward (and clear any prior "sent" alerts is
// handled by dedupe window in the scanner). Keeps the same document row.
export async function renewDocument(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const expiry = orNull(formData.get("expiry_date"));
  if (!expiry) back(String(formData.get("lodge_id")));
  const supabase = await createClient();
  await supabase
    .from("compliance_documents")
    .update({ expiry_date: expiry })
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")));
}
