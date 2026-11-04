import { redirect } from "next/navigation";

// Old address (before the SOP became one page): editing is on the SOP page itself.
export default function Page() {
  redirect("/sop?edit=1");
}
