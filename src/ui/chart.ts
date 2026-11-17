/** Normalised polyline points, shared by Sparkline and AreaChart. */
export const points = (data: number[], w: number, h: number) => {
  const min = Math.min(...data);
  const range = Math.max(...data) - min || 1;
  const step = data.length - 1 || 1; // a single point maps to x = 0, not NaN
  return data.map((v, i) => `${(i / step) * w},${h - ((v - min) / range) * h}`).join(' ');
};
