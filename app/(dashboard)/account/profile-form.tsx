"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "./actions";

const inputCls = "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-sand-800 outline-none transition focus:border-olive-600 focus:ring-2 focus:ring-gold-500";
const labelCls = "mb-1 block text-sm font-medium text-sand-700";

async function compressAvatar(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const scale = Math.min(1, 512 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  URL.revokeObjectURL(url);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let quality = 0.8;
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  while (blob && blob.size > 200 * 1024 && quality > 0.4) {
    quality -= 0.15;
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  }
  if (!blob) throw new Error("Could not process image");
  return blob;
}

export function ProfileForm({ userId, fullName, designation, phone, avatarUrl }: { userId: string; fullName: string; designation: string; phone: string; avatarUrl: string; }) {
  const [preview, setPreview] = useState(avatarUrl);
  const [uploadedUrl, setUploadedUrl] = useState(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const blob = await compressAvatar(file);
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setUploadedUrl(data.publicUrl);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const initials = (fullName || "U").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join("");

  return (
    <form action={updateProfile} className="space-y-4">
      <input type="hidden" name="avatar_url" value={uploadedUrl} />
      <div className="flex items-center gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-olive-600 text-lg font-semibold text-white">
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
        <div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-lg border border-sand-300 px-3 py-1.5 text-sm font-medium text-sand-700 hover:bg-sand-50 disabled:opacity-60">
            {busy ? "Uploading..." : "Change photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          {err && <p className="mt-1 text-xs text-error">{err}</p>}
        </div>
      </div>
      <div>
        <label className={labelCls}>Full name</label>
        <input name="full_name" defaultValue={fullName} required maxLength={120} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Designation</label>
        <input name="designation" defaultValue={designation} maxLength={120} placeholder="e.g. Chef, Lodge Manager" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Mobile number</label>
        <input name="phone" defaultValue={phone} maxLength={30} inputMode="tel" placeholder="e.g. +91 98765 43210" className={inputCls} />
      </div>
      <button disabled={busy} className="rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white hover:bg-olive-700 disabled:opacity-60">Save profile</button>
    </form>
  );
}
