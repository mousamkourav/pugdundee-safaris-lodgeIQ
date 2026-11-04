import { redirect } from "next/navigation";

// Old address (before the SOP became one page): who has read is on Access & reading.
export default function Page() {
  redirect("/sop/access#reading");
}
