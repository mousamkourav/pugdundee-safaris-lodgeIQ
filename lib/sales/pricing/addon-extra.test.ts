// Safari breakfast for outside jeeps (BAR sheets 2026-27): Rs 1,000 for up to 2 guests in a jeep,
// + Rs 500 for each further guest, + 18% GST. On the owner's real Master data with that rule set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip } from "./engine";
import { realCtx } from "@/lib/sales/plan/real-fixture";
import type { PricingData } from "./types";

const data: PricingData = {
  ...realCtx.pricing,
  addons: realCtx.pricing.addons.map((a) => (a.name === "Safari breakfast (outside jeeps)" ? { ...a, included_guests: 2, extra_guest_rate: 500 } : a)),
};
const breakfast = data.addons.find((a) => a.name === "Safari breakfast (outside jeeps)")!;
const price = (adults: number, children: number[], jeeps?: number) =>
  priceTrip(
    { adults, children, nationality: "indian", stays: [], safaris: [{ date: "2027-02-10", park_id: "P_kanha_national_park", zone: "core", session: "morning", ...(jeeps ? { vehicles: jeeps } : {}) }], transfers: [], addons: [{ addon_id: breakfast.id, date: "2027-02-10" }], booking_date: "2026-11-03" },
    data
  ).lines.find((l) => l.ref_id === breakfast.id)!;

test("safari breakfast: Rs 1,000 a jeep for 2 guests, + Rs 500 each further guest, + 18%", () => {
  assert.equal(price(2, []).amount, 1180); // 1,000 + 18%
  assert.equal(price(4, []).amount, Math.round((1000 + 2 * 500) * 1.18)); // 2,360
  assert.equal(price(4, [8, 3]).amount, Math.round((1000 + 3 * 500) * 1.18)); // a child of 8 counts, under 5 does not: 2,950
  assert.equal(price(4, [], 2).amount, 2360); // two jeeps of 2: 2 x 1,000, no extra guest
  assert.match(price(4, []).description, /\(\+2 extra guests\)$/);
});
