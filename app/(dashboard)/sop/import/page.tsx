import { redirect } from "next/navigation";

// Old address (before the SOP became one page): Import SOP is on the SOP page itself.
export default function Page() {
  redirect("/sop?import=1");
}
