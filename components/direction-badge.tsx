import { Badge } from "@/components/ui/badge";

export type Direction = "outflow" | "inflow" | "transfer";

export function directionLabel(direction: Direction): string {
  switch (direction) {
    case "outflow":
      return "Outflow";
    case "inflow":
      return "Inflow";
    case "transfer":
      return "Transfer";
  }
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  const label = directionLabel(direction);
  if (direction === "outflow") {
    return <Badge variant="destructive">{label}</Badge>;
  }
  if (direction === "inflow") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        {label}
      </Badge>
    );
  }
  return <Badge variant="secondary">{label}</Badge>;
}
