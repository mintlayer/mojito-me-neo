import React, { useMemo } from 'react';
import { C } from '../theme';
import Svg, { Rect } from 'react-native-svg';

export function FakeQR({ seed }: { seed: string }) {
  const grid = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const rng = () => {
      h = (h * 1664525 + 1013904223) | 0;
      return ((h >>> 0) % 1000) / 1000;
    };
    const N = 25;
    const g = Array.from({ length: N }, () => Array.from({ length: N }, () => (rng() > 0.5 ? 1 : 0)));
    const finder = (r: number, c: number) => {
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 7; j++)
          g[r + i][c + j] = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4) ? 1 : 0;
    };
    finder(0, 0);
    finder(0, 18);
    finder(18, 0);
    for (let i = 9; i < 16; i++) for (let j = 9; j < 16; j++) g[i][j] = 0;
    return g;
  }, [seed]);

  const cell = 9;
  const n = grid.length * cell;
  return (
    <Svg width="100%" viewBox={`0 0 ${n} ${n}`} style={{ aspectRatio: 1 }}>
      {grid.flatMap((row, i) =>
        row.map((v, j) =>
          v ? <Rect key={`${i}-${j}`} x={j * cell + 1} y={i * cell + 1} width={cell - 2} height={cell - 2} rx={1.5} fill={C.ink} /> : null,
        ),
      )}
    </Svg>
  );
}

/** Geometric M with an orbiting dashed ring. */
