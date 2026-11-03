import type { VersionDiff } from "@/lib/sop/content";
import { diffIsEmpty } from "@/lib/sop/content";

// "What changed": sections added, removed, edited, renamed, moved.
export function DiffView({ diff, empty = "No changes." }: { diff: VersionDiff; empty?: string }) {
  if (diffIsEmpty(diff)) return <p className="text-sm text-sand-500">{empty}</p>;
  const Row = ({ label, items, tone }: { label: string; items: string[]; tone: string }) =>
    items.length ? (
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>
          {label} ({items.length})
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-sand-700">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="space-y-3">
      <Row label="Added" items={diff.added} tone="text-success" />
      <Row label="Removed" items={diff.removed} tone="text-error" />
      <Row label="Edited" items={diff.edited} tone="text-warning" />
      <Row label="Renamed" items={diff.renamed.map((r) => `${r.from} -> ${r.to}`)} tone="text-info" />
      <Row label="Moved" items={diff.moved} tone="text-sand-500" />
    </div>
  );
}
