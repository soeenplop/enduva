export interface DistanceBadgeProps {
  distance: number;
  unit: 'km' | 'mi';
}

export function DistanceBadge({ distance, unit }: DistanceBadgeProps) {
  return (
    <span data-testid="distance">
      {distance.toFixed(2)} {unit}
    </span>
  );
}
