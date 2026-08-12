"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export async function createLodge(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase.from("lodges").insert({
    name: String(formData.get("name") ?? ""),
    location: (String(formData.get("location") ?? "") || null) as string | null,
    room_count: formData.get("room_count")
      ? Number(formData.get("room_count"))
      : null,
    capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
    created_by: cu.user.id,
  });

  if (error) {
    redirect("/lodges/new?error=" + encodeURIComponent(error.message));
  }
  revalidatePath("/lodges");
  redirect("/lodges");
}

export async function updateLodge(id: string, formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase
    .from("lodges")
    .update({
      name: String(formData.get("name") ?? ""),
      location: (String(formData.get("location") ?? "") || null) as
        | string
        | null,
      room_count: formData.get("room_count")
        ? Number(formData.get("room_count"))
        : null,
      capacity: formData.get("capacity")
        ? Number(formData.get("capacity"))
        : null,
      status: String(formData.get("status") ?? "active"),
    })
    .eq("id", id);

  if (error) {
    redirect(`/lodges/${id}?error=` + encodeURIComponent(error.message));
  }
  revalidatePath("/lodges");
  redirect("/lodges");
}
