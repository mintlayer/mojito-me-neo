/** Normalised polyline points, shared by Sparkline and AreaChart. */
export const points = (data: number[], w: number, h: number) => {
  const min = Math.min(...data);
  const range = Math.max(...data) - min || 1;
  return data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
};
