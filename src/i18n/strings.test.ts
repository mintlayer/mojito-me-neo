// i18n completeness gate: every t() key referenced in source exists in en.ts,
// every en key is referenced (or lives under a dynamic namespace), no
// placeholder values, and interpolation works.
//   npx tsx src/i18n/strings.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert/strict';

import { t } from './index';
import { en } from './strings/en';

const SCAN_ROOTS = ['src'];
const EXTRA_FILES = ['App.tsx'];

// Files whose quoted strings are not UI copy: fixtures, the dictionary itself,
// and test sources.
const SKIP_EXACT = new Set([
  'src/data.ts',
  'src/onboarding/data.ts',
  'src/i18n/strings/en.ts',
  'src/storage/keys.ts',
]);
const SKIP_TEST = /\.test\.tsx?$/;

// Dynamic namespaces constructed from template keys at call sites.
const DYNAMIC_PREFIXES = ['home.ranges.', 'send.fee.', 'send.fee.eta.'];

const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/;

const files: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === 'node_modules') continue;
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
};
for (const root of SCAN_ROOTS) walk(root);
for (const extra of EXTRA_FILES) files.push(extra);

const referenced = new Set<string>();
const dynamic = new Set<string>();

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const skip = SKIP_EXACT.has(file.replace(/\\/g, '/')) || SKIP_TEST.test(file);
  if (skip) continue;
  // Direct calls with literal keys.
  for (const match of text.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) referenced.add(match[1]);
  // Template keys: capture the static prefix before the interpolation.
  for (const match of text.matchAll(/\bt\(`([a-zA-Z0-9_.]+)\.\$\{/g)) dynamic.add(`${match[1]}.`);
  // Keys passed as identifiers (label maps, ternaries): any quoted,
  // dot-namespaced literal in app source counts as a key reference.
  for (const match of text.matchAll(/'([a-zA-Z0-9_.]+)'/g)) {
    if (KEY_SHAPE.test(match[1])) referenced.add(match[1]);
  }
}

const enKeys = Object.keys(en);
const failures: string[] = [];

// 1. Every referenced key must exist.
for (const key of referenced) {
  if (!(key in en)) failures.push(`missing key referenced by t(): ${key}`);
}

// 2. Every dynamic namespace must have at least one key.
for (const prefix of dynamic) {
  if (!enKeys.some((key) => key.startsWith(prefix))) {
    failures.push(`dynamic namespace has no keys: ${prefix}`);
  }
}

// 3. Orphan scan: no unreferenced keys outside dynamic namespaces.
const prefixes = [...dynamic, ...DYNAMIC_PREFIXES];
for (const key of enKeys) {
  const isReferenced = referenced.has(key) || prefixes.some((p) => key.startsWith(p));
  if (!isReferenced) failures.push(`orphan key never referenced: ${key}`);
}

// 4. Value sanity: non-empty, no leftover placeholders, valid interpolation.
for (const [key, value] of Object.entries(en)) {
  if (value.trim().length === 0) failures.push(`empty value: ${key}`);
  if (/TODO|TBD|FIXME/.test(value)) failures.push(`placeholder text in value: ${key}`);
  const opens = (value.match(/\{/g) ?? []).length;
  const closes = (value.match(/\}/g) ?? []).length;
  if (opens !== closes) failures.push(`unbalanced braces: ${key}`);
  for (const token of value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(token[1])) failures.push(`bad interpolation name in ${key}: {${token[1]}}`);
  }
}

// 5. Runtime smoke: lookups and interpolation.
assert.equal(t('common.cancel'), 'Cancel');
assert.equal(t('home.networks.active', { count: 5 }), '5 active');
assert.equal(t('onboarding.pin.wrongAttempts', { left: 1 }), 'Wrong PIN. Attempts left: 1');
assert.throws(() => t('definitely.missing' as never), /missing translation/);

if (failures.length > 0) {
  console.error(`i18n: ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`i18n: ok (${enKeys.length} keys, ${referenced.size} references, ${dynamic.size} dynamic namespaces)`);
