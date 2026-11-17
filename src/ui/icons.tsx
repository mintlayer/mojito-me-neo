import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Line-icon set, ported 1:1 from the design's components.jsx. All glyphs live on
// a 24x24 grid and inherit stroke width / colour from the <Icon> wrapper.
const PATHS = {
  home: ['M3 11l9-8 9 8', 'M5 9v12h14V9'],
  swap: ['M4 7h13l-3-3', 'M20 17H7l3 3'],
  bridge: ['M3 12c3 0 4-4 9-4s6 4 9 4', 'M3 17h18', 'M7 17v-3M11 17v-4M15 17v-4M19 17v-3'],
  chart: ['M4 19V5', 'M4 19h16', 'M8 15l3-3 3 2 5-6'],
  settings: [
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  ],
  arrow_up: ['M12 19V5', 'M5 12l7-7 7 7'],
  arrow_dn: ['M12 5v14', 'M5 12l7 7 7-7'],
  arrow_r: ['M5 12h14', 'M12 5l7 7-7 7'],
  arrow_l: ['M19 12H5', 'M12 5l-7 7 7 7'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  scan: ['M4 7V5a1 1 0 0 1 1-1h2', 'M17 4h2a1 1 0 0 1 1 1v2', 'M20 17v2a1 1 0 0 1-1 1h-2', 'M7 20H5a1 1 0 0 1-1-1v-2', 'M4 12h16'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10 21a2 2 0 0 0 4 0'],
  shield: ['M12 3l8 3v6c0 4-3 8-8 9-5-1-8-5-8-9V6z', 'M9 12l2 2 4-4'],
  flash: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  history: ['M3 12a9 9 0 1 0 3-7', 'M3 4v5h5', 'M12 7v5l3 2'],
  eye: ['M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z'],
  eye_off: ['M9.9 4.2A10 10 0 0 1 22 12s-1 2-3 4', 'M6 6c-2 1.5-4 6-4 6s4 8 10 8a10 10 0 0 0 6-2', 'M3 3l18 18'],
  fingerprint: ['M12 2a10 10 0 0 0-10 10', 'M22 12a10 10 0 0 0-10-10', 'M7 12a5 5 0 0 1 10 0v3a3 3 0 0 1-6 0', 'M12 12v6'],
  chevron_r: ['M9 18l6-6-6-6'],
  check: ['M4 12l5 5L20 6'],
  face: [
    'M4 8V6a2 2 0 0 1 2-2h2',
    'M16 4h2a2 2 0 0 1 2 2v2',
    'M20 16v2a2 2 0 0 1-2 2h-2',
    'M8 20H6a2 2 0 0 1-2-2v-2',
    'M9 9.5v1.2',
    'M15 9.5v1.2',
    'M9.5 14.5s.9 1.1 2.5 1.1 2.5-1.1 2.5-1.1',
  ],
  backspace: ['M21 4H8l-7 8 7 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z', 'M18 9l-6 6M12 9l6 6'],
} as const;

export type IconName = keyof typeof PATHS | 'qr' | 'lock' | 'card';

/** PATHS lacks the three shape-drawn glyphs (qr/lock/card), which Icon draws
 *  by hand below; the predicate splits the union for the path renderer. */
const hasPaths = (name: IconName): name is keyof typeof PATHS => name in PATHS;

export function Icon({
  name,
  size = 20,
  color = '#fff',
  stroke = 1.6,
}: {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
}) {
  const s = { stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Glyphs needing a shape other than <path>. */}
      {name === 'qr' && (
        <>
          <Rect x={3} y={3} width={7} height={7} {...s} />
          <Rect x={14} y={3} width={7} height={7} {...s} />
          <Rect x={3} y={14} width={7} height={7} {...s} />
          <Path d="M14 14h3v3h-3z" {...s} />
          <Path d="M20 14v3" {...s} />
          <Path d="M14 20h7" {...s} />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect x={4} y={11} width={16} height={10} rx={2} {...s} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...s} />
        </>
      )}
      {name === 'card' && (
        <>
          <Rect x={2} y={5} width={20} height={14} rx={2} {...s} />
          <Path d="M2 10h20" {...s} />
          <Path d="M6 15h4" {...s} />
        </>
      )}
      {(name === 'eye' || name === 'settings') && <Circle cx={12} cy={12} r={3} {...s} />}
      {hasPaths(name) &&
        PATHS[name].map((d, i) => (
          <Path key={i} d={d} {...s} />
        ))}
    </Svg>
  );
}
