// Static startup-path review for the M6 release gate (spec M6 deliverable 5,
// static scope: no device runs in this repo's gate). The timing budgets
// below are graded ONLY from recorded device numbers (docs/MANUAL-QA.md,
// 360x740 baseline); this script grades the code-level startup properties
// that keep those budgets reachable and fails when they regress.
//   node scripts/perf.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const notes = [];

// Timing budgets (spec M6): graded from device runs, never here.
const TIMING_BUDGETS = [
  'cold start to interactive Home under 2500 ms',
  'tab switch under 250 ms',
  'Send sheet open under 400 ms',
  'QR render under 300 ms',
  'scan-ready camera under 1200 ms',
];

const app = readFileSync('App.tsx', 'utf8');
const providers = readFileSync('src/data/providers/index.ts', 'utf8');

// Check 1: the splash covers startup until the shell is ready (App keeps the
// Splash layer up via splashDone; removing it would expose the pre-data UI).
// Match the stable tokens (the gate variable and the Splash element) instead
// of a formatting-sensitive source literal: a benign reformat must not fail
// the gate, removing either token still does.
const splashGate = app.includes('splashDone');
const splashElement = app.includes('<Splash');
if (!splashGate || !splashElement) {
  fails.push('App.tsx no longer gates the Splash layer behind splashDone (startup regression)');
} else {
  notes.push('splash covers startup until the shell reports ready (App.tsx splashDone gate)');
}

// Check 2: the native bindings load stays a lazy require inside loadBindings.
// A top-level require would pull expo-modules-core (and react-native) into
// every Node-side import of the provider module and slow the JS start.
// Stable tokens again: exactly one require, located after loadBindings
// starts. A local variable rename must not matter; hoisting the require
// above the function (out of loadBindings) does.
const requires = [...providers.matchAll(/\brequire\s*\(/g)];
const fnStart = providers.indexOf('function loadBindings');
const requireAt = providers.search(/\brequire\s*\(/);
if (requires.length !== 1 || fnStart < 0 || requireAt < fnStart) {
  fails.push('src/data/providers/index.ts must keep exactly one lazy require inside loadBindings');
} else {
  notes.push('bindings require stays lazy inside loadBindings (no top-level native pull)');
}

// Check 3: provider construction stays synchronous. The useMemo in
// ProvidersProvider runs on the first render; an async step there would
// stall the first frame behind network or storage I/O. (Nested async
// closures inside createProviders are lazy callbacks and are expected.)
const context = readFileSync('src/data/providers/context.tsx', 'utf8');
if (/export async function createProviders/.test(providers)) {
  fails.push('createProviders must not be async: construction returns the provider set synchronously');
}
const ctxStart = context.indexOf('export function ProvidersProvider');
const ctxEnd = context.indexOf('\nexport function', ctxStart + 1);
const ctxBody = ctxStart >= 0 ? context.slice(ctxStart, ctxEnd === -1 ? undefined : ctxEnd) : '';
if (ctxBody.length === 0) {
  fails.push('ProvidersProvider not found in src/data/providers/context.tsx');
} else if (/\bawait\b/.test(ctxBody) || /\.then\(/.test(ctxBody)) {
  fails.push('ProvidersProvider contains await/then: construction must stay synchronous (first-frame cost)');
} else {
  notes.push('provider construction is synchronous closure wiring; reads start behind usePoll/useData after mount');
}

// Check 4 (informational): eager screen imports. Every tab and overlay ships
// in one bundle by design (1488 modules measured by the export step); lazy
// screens are the first post-release trim lever if the budgets slip.
const eagerImports = [...app.matchAll(/^import .+ from '(.+)';$/gm)].length;
notes.push(`App.tsx carries ${eagerImports} eager static imports (all screens in one bundle; lazy screens are the first trim lever)`);

console.log('startup-path review (static) + timing budget status');
console.log('---------------------------------------------------');
for (const n of notes) console.log(`note: ${n}`);
console.log('timing budgets (graded from recorded device runs only):');
for (const b of TIMING_BUDGETS) console.log(`  NOT MEASURED here - ${b} (record numbers in docs/REVIEW-RUNBOOK.md)`);

if (fails.length > 0) {
  console.error('perf: startup-path gate FAILED');
  for (const f of fails) console.error(`  ${f}`);
  process.exit(1);
}
console.log('perf: startup-path gate pass');
