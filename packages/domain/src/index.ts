/** Converts a distance in metres to kilometres. */
export function metresToKilometres(metres: number): number {
  return metres / 1000;
}

// Deliberate type error: acceptance probe for task 0.5a (#7). Never merge.
export const probe: number = metresToKilometres('1000');
