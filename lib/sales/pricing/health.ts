// Finds gaps in master data that would stop the pricing engine from quoting.
import type { ISODate, PricingData } from "./types";
import { addDays } from "./dates";

export interface HealthIssue {
  level: "error" | "warning";
  message: string;
  href?: string; // where to fix it
}

export function checkData(d: PricingData, today: ISODate): HealthIssue[] {
  const out: HealthIssue[] = [];
  const horizon = addDays(today, 365);

  for (const p of d.properties) {
    const rooms = d.rooms.filter((r) => r.property_id === p.id);
    if (!rooms.length) {
      out.push({ level: "error", message: `${p.name}: no room categories.`, href: `/sales/admin/rooms?f_property_id=${p.id}` });
      continue;
    }
    for (const r of rooms) {
      const rates = d.roomRates.filter((x) => x.room_category_id === r.id);
      if (!rates.length) {
        out.push({ level: "error", message: `${p.name} - ${r.name}: no room rates.`, href: `/sales/admin/room-rates?f_room_category_id=${r.id}` });
      } else if (!rates.some((x) => x.valid_to >= today)) {
        out.push({ level: "error", message: `${p.name} - ${r.name}: all rates have expired.`, href: `/sales/admin/room-rates?f_room_category_id=${r.id}` });
      } else if (!rates.some((x) => x.valid_to >= horizon)) {
        const last = rates.map((x) => x.valid_to).sort().slice(-1)[0];
        out.push({ level: "warning", message: `${p.name} - ${r.name}: rates end on ${last}. Add next season's rates.`, href: `/sales/admin/room-rates?f_room_category_id=${r.id}` });
      }
    }
    const loc = d.locations.find((l) => l.property_id === p.id);
    const hasRoute = loc && d.transferRates.some((t) => t.from_location_id === loc.id || t.to_location_id === loc.id);
    if (!hasRoute) out.push({ level: "warning", message: `${p.name}: no transfer routes to or from it.`, href: "/sales/admin/transfers" });
  }

  for (const park of d.parks) {
    const lodges = d.properties.filter((p) => p.park_id === park.id);
    const rates = d.safariRates.filter((s) => s.park_id === park.id);
    if (!lodges.length) out.push({ level: "warning", message: `${park.name}: no lodge is linked to this park.`, href: "/sales/admin/properties" });
    if (!rates.length) out.push({ level: "error", message: `${park.name}: no safari rates.`, href: `/sales/admin/safari-rates?f_park_id=${park.id}` });
    else if (!rates.some((s) => s.valid_to >= today)) out.push({ level: "error", message: `${park.name}: all safari rates have expired.`, href: `/sales/admin/safari-rates?f_park_id=${park.id}` });
    if (!d.closures.some((c) => c.park_id === park.id)) out.push({ level: "warning", message: `${park.name}: no closures entered (weekly core closure, Holi, Diwali).`, href: `/sales/admin/closures?f_park_id=${park.id}` });
  }

  if (!d.settings.fx?.USD) out.push({ level: "warning", message: "No USD exchange rate in Sales settings, so USD quotes are not possible.", href: "/sales/admin/settings" });
  const slabs = d.settings.payment_slabs;
  if (slabs && slabs.length && Math.abs(slabs.reduce((t, s) => t + s.pct, 0) - 100) > 0.001) {
    out.push({ level: "error", message: "Payment schedule percentages do not add up to 100.", href: "/sales/admin/settings" });
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}
