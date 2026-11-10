"use client";

// "Download for Excel": the internal price check as plain numbers (lib/sales/pricing/price-csv.ts).
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { priceCheckCsv } from "@/lib/sales/pricing/price-csv";
import type { DetailRow } from "@/lib/sales/pricing/breakdown";

export function PriceCheckDownload({ rows, total, dateless, fileName }: { rows: DetailRow[]; total: number; dateless?: boolean; fileName: string }) {
  return (
    <button
      type="button"
      className={`${ui.btnSecondary} ${ui.btnSm}`}
      onClick={() => {
        const blob = new Blob([priceCheckCsv(rows, { total, dateless })], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName.replace(/[^\w.-]+/g, "_")}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      <Icon name="fileText" className="h-4 w-4" />
      Download for Excel
    </button>
  );
}
