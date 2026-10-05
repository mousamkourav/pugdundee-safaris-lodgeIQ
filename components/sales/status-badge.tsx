import { Badge } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE, type QueryStatus } from "@/lib/sales/status";

export function StatusBadge({ status }: { status: QueryStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
