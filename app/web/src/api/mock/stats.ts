// basic stats helpers for the mock

export const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

export function variance(values: number[]) {
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
}

export function linearFit(x: number[], y: number[]) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residual = Math.max(syy - slope * sxy, 0);
  const se = Math.sqrt(residual / (n - 2) / sxx);
  const r = sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, se, r };
}

function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const y = 1 - poly * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export const twoSidedP = (z: number) => 1 - erf(Math.abs(z) / Math.SQRT2);

export function rollingMean(values: number[], window: number): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    if (i < half || i >= values.length - half) return null;
    return mean(values.slice(i - half, i + half + 1));
  });
}

export const round = (value: number, digits = 3) => Number(value.toFixed(digits));
