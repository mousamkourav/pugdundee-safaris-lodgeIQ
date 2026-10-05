import { ui } from "@/components/ui";

export function ComingSoon({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl">{title}</h1>
      <div className={ui.empty}>{children ?? "This screen is being built next."}</div>
    </div>
  );
}
