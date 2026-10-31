// Master data is read on every builder page and server action (rates, lodges, places...),
// but changes rarely. It is kept for a short while (MASTER_TTL) and dropped at once when
// anything in Master data is saved (revalidateMasterData), so a new rate is used straight away.
import { revalidateTag } from "next/cache";

export const MASTER_TAG = "sales-master";
export const MASTER_TTL = 300; // seconds

export function revalidateMasterData() {
  try {
    revalidateTag(MASTER_TAG);
  } catch {
    // outside a request (tests): nothing is cached there
  }
}
