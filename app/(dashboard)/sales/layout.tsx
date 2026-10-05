import { redirect } from "next/navigation";
import { requireUser, isSalesUser } from "@/lib/auth";

// Every /sales page is limited to super roles and sales members.
// Pages still re-check finer permissions themselves (e.g. master data).
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  if (!isSalesUser(profile?.role)) redirect("/dashboard");
  return <>{children}</>;
}
