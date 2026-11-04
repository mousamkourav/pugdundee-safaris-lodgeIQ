import { redirect } from "next/navigation";

// Old address (before the SOP became one page): version history is on Access & reading.
export default function Page() {
  redirect("/sop/access#versions");
}
