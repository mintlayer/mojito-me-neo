// Static size report for the M6 release gate (spec M6 deliverable 5).
// Machine-static by design: it inventories the shipped bytes that exist in
// the repo (app source, runtime dependency trees, vendored bindings
// artifacts) and evaluates the JS-bundle budget ONLY against a measured
// metro export (dist/ from `npx expo export`), never an estimate dressed up
// as a measurement. No device and no native build is involved here; the
// installed-size checks are recorded from real build artifacts by hand in
// docs/MANUAL-QA.md and docs/REVIEW-RUNBOOK.md.
//   npx expo export --platform android   (machine step, produces the export)
//   node scripts/size-report.mjs [exportDir]   (default dist/, or $SIZE_REPORT_DIR)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MB = 1024 * 1024;
// Spec M6 size budgets: JS bundle under 4 MB, installed app under 90 MB on
// iOS and 60 MB on Android (bindings artifacts count against it).
const JS_BUDGET = 4 * MB;
const IOS_INSTALL_BUDGET = 90 * MB;
const ANDROID_INSTALL_BUDGET = 60 * MB;

const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.cjs', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.expo', 'dist', '.git', '__tests__']);

const fails = [];

function walkBytes(root, extensions) {
  let bytes = 0;
  let files = 0;
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        visit(path);
      } else if (extensions.has(entry.slice(entry.lastIndexOf('.')))) {
        bytes += stats.size;
        files += 1;
      }
    }
  };
  visit(root);
  return { bytes, files };
}

function dirBytes(root) {
  try {
    statSync(root);
  } catch {
    return null; // absent tree: the caller reports NOT MEASURED
  }
  let bytes = 0;
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) visit(path);
      else bytes += stats.size;
    }
  };
  visit(root);
  return bytes;
}

const fmt = (n) => (n === null ? 'not present' : `${(n / MB).toFixed(2)} MB`);

// Export directory: argv wins over the SIZE_REPORT_DIR env var over the
// default dist/ (where `npx expo export` writes). CI points the gate at the
// export it just produced; locally the default keeps the check honest when
// no export exists yet.
const exportDir = process.argv[2] ?? process.env.SIZE_REPORT_DIR ?? 'dist';

// 1. Measured metro export (the only number evaluated against the JS budget).
//    The export dir is gitignored: without an export the report says NOT
//    MEASURED and stays informational; a present export that breaches the
//    budget fails the gate (waivers live in docs/REVIEW-RUNBOOK.md, in
//    writing).
const distJs = dirBytes(join(exportDir, '_expo/static/js'));
const distAssets = dirBytes(join(exportDir, 'assets'));
if (distJs === null) {
  console.warn(`size-report: no export found in ${exportDir}; JS bundle NOT MEASURED (machine step: npx expo export --platform android)`);
} else if (distJs >= JS_BUDGET) {
  fails.push(`measured JS bundle ${(distJs / MB).toFixed(2)} MB is over the 4 MB budget (spec M6); waive in writing in docs/REVIEW-RUNBOOK.md or trim`);
}

// 2. App-authored source inventory (what this repo ships and controls).
const appSource = walkBytes('src', JS_EXT).bytes + walkBytes('modules', JS_EXT).bytes;
for (const f of ['App.tsx', 'index.js']) {
  try {
    appSource += statSync(f).size;
  } catch {
    // optional file
  }
}

// 3. Runtime dependency upper bound (unminified JS-relevant bytes; context
// only, never graded: the bundler tree-shakes and minifies this inventory).
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let depBytes = 0;
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  depBytes += walkBytes(join('node_modules', dep), JS_EXT).bytes;
}

// 4. Vendored bindings artifacts (they count against the installed budgets).
const aar = statSync('vendor/mintlayer/mintlayer-wallet-bindings-0.1.0.aar').size;
const iosDevice = dirBytes('vendor/mintlayer/MintlayerWalletBindings.xcframework/ios-arm64');
const iosSim = dirBytes('vendor/mintlayer/MintlayerWalletBindings.xcframework/ios-arm64-simulator');

console.log('size report (static inventory + measured export)');
console.log('------------------------------------------------');
console.log(`measured JS bundle (${exportDir}, Hermes): ${fmt(distJs)}  budget < 4 MB  ${distJs === null ? 'NOT MEASURED' : distJs < JS_BUDGET ? 'pass' : 'FAIL'}`);
console.log(`measured export assets:            ${fmt(distAssets)}`);
console.log(`app source (src + modules):        ${fmt(appSource)}`);
console.log(`runtime deps inventory:            ${fmt(depBytes)} (direct deps, unminified; not graded)`);
console.log(`bindings AAR (all ABIs):           ${fmt(aar)} (app bundles split per ABI: arm64-v8a, armeabi-v7a, x86_64)`);
console.log(`bindings iOS device slice:         ${fmt(iosDevice)} (ships in the installed app)`);
console.log(`bindings iOS simulator slice:      ${fmt(iosSim)} (never ships; build-time only)`);
console.log(`installed-size budgets (${IOS_INSTALL_BUDGET / MB} MB iOS, ${ANDROID_INSTALL_BUDGET / MB} MB Android) are graded`);
console.log('build artifacts only; record the numbers in docs/REVIEW-RUNBOOK.md.');

if (fails.length > 0) {
  console.error('size-report: budget gate FAILED');
  for (const f of fails) console.error(`  ${f}`);
  process.exit(1);
}
console.log('size-report: gate pass');
