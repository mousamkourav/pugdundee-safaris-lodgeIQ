"use client";

import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";

// Contents as a dropdown (phones).
export function TocSelect({ basePath, toc, current, q }: { basePath: string; toc: { id: string; title: string }[]; current: string; q: string }) {
  const router = useRouter();
  return (
    <label className="block">
      <span className={ui.label}>Section</span>
      <select
        className={`${ui.select} w-full`}
        value={current}
        onChange={(e) => router.push(`${basePath}?s=${encodeURIComponent(e.target.value)}${q ? `&q=${encodeURIComponent(q)}` : ""}`)}
      >
        {!current && <option value="">Choose a section</option>}
        {toc.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
    </label>
  );
}
