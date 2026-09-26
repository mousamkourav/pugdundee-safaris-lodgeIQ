import { PageHeader } from "./page-header";

export function NoLodge({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-sand-600">
        No lodge available yet. Add a lodge (or ask an admin for access) to start
        entering data.
      </div>
    </div>
  );
}
