"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

// doc_type is constrained to 'insurance' | 'licence'. We keep the human category
// (License/Insurance/AMC/Fitness/Pollution) as a [Category] prefix in notes.
const CAT_TO_DOCTYPE: Record<string, string> = {
  License: "licence",
  AMC: "licence",
  Insurance: "insurance",
  Fitness: "insurance",
  Pollution: "insurance",
  Other: "licence",
};

function buildNotes(category: string, remark: string): string {
  const c = category.trim() || "Other";
  const r = remark.trim();
  return r ? `[${c}] ${r}` : `[${c}]`;
}

function back(lodge: string) {
  revalidatePath("/compliance");
  redirect(`/compliance?lodge=${lodge}`);
}

export async function addDoc(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge = String(fd.get("lodge") ?? "");
  const category = String(fd.get("category") ?? "Other");
  const title = String(fd.get("title") ?? "").trim();
  const issue = String(fd.get("issue_date") ?? "") || null;
  const expiry = String(fd.get("expiry_date") ?? "") || null;
  const remark = String(fd.get("remark") ?? "");
  if (!title) back(lodge);

  const s = await createClient();
  await s.from("compliance_documents").insert({
    lodge_id: lodge,
    doc_type: CAT_TO_DOCTYPE[category] ?? "licence",
    title,
    issue_date: issue,
    // expiry_date is NOT NULL in the table; use far-future placeholder when blank.
    expiry_date: expiry ?? "2099-12-31",
    notes: buildNotes(category, remark),
  });
  back(lodge);
}

export async function updateDoc(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const id = String(fd.get("id") ?? "");
  const lodge = String(fd.get("lodge") ?? "");
  const category = String(fd.get("category") ?? "Other");
  const title = String(fd.get("title") ?? "").trim();
  const issue = String(fd.get("issue_date") ?? "") || null;
  const expiry = String(fd.get("expiry_date") ?? "") || null;
  const remark = String(fd.get("remark") ?? "");

  const s = await createClient();
  await s
    .from("compliance_documents")
    .update({
      doc_type: CAT_TO_DOCTYPE[category] ?? "licence",
      title,
      issue_date: issue,
      expiry_date: expiry ?? "2099-12-31",
      notes: buildNotes(category, remark),
    })
    .eq("id", id);
  back(lodge);
}

export async function deleteDoc(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const id = String(fd.get("id") ?? "");
  const lodge = String(fd.get("lodge") ?? "");
  const s = await createClient();
  await s.from("compliance_documents").delete().eq("id", id);
  back(lodge);
}
