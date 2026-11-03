"use client";

import { Icon } from "@/components/icons";
import { ui } from "@/components/ui";

export function PrintSection() {
  return (
    <button type="button" onClick={() => window.print()} className={`${ui.btnGhost} ${ui.btnSm}`}>
      <Icon name="fileText" className="h-4 w-4" />
      Print section
    </button>
  );
}
