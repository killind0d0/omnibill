// ui/src/features/charts/scale.ts
// Pure integer coordinate scaling and nice-tick generation (zero float formatting)

export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number
): (val: number) => number {
  const domainDelta = domainMax - domainMin;
  const rangeDelta = rangeMax - rangeMin;

  if (domainDelta === 0) {
    return () => (rangeMin + rangeMax) / 2;
  }

  return (val: number) => {
    const ratio = (val - domainMin) / domainDelta;
    return rangeMin + ratio * rangeDelta;
  };
}

/**
 * Computes ascending nice integer ticks for chart axes.
 * e.g. niceTicks(0, 987, 5) -> [0, 200, 400, 600, 800, 1000]
 */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (min >= max) return [min];

  const span = max - min;
  const count = Math.max(2, targetCount);
  const roughStep = Math.max(1, Math.floor(span / count));

  // Determine power of 10
  let magnitude = 1;
  let temp = roughStep;
  while (temp >= 10) {
    temp = Math.floor(temp / 10);
    magnitude *= 10;
  }

  // Fraction within the magnitude
  const fraction = roughStep / magnitude;

  let niceStep = magnitude;
  if (fraction < 1.5) {
    niceStep = 1 * magnitude;
  } else if (fraction < 3.5) {
    niceStep = 2 * magnitude;
  } else if (fraction < 7.5) {
    niceStep = 5 * magnitude;
  } else {
    niceStep = 10 * magnitude;
  }

  if (niceStep < 1) niceStep = 1;

  const start = Math.floor(min / niceStep) * niceStep;
  const ticks: number[] = [];
  let current = start;

  while (current < max) {
    ticks.push(current);
    current += niceStep;
  }
  ticks.push(current);

  return ticks;
}
