// Gate scan for U+2014 (em dash) and U+2013 (en dash) across app source
// (decision D9: no dash characters anywhere in specs or code).
//   npx tsx scripts/no-em-dash.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_ROOTS = ['src', 'modules', 'specs'];
const SCAN_FILES = ['App.tsx', 'eslint.config.js', 'nativewind-env.d.ts'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.json', '.md'];

const offenders: string[] = [];

const scanFile = (path: string): void => {
  const text = readFileSync(path, 'utf8');
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x2014 || code === 0x2013) {
      const line = text.slice(0, i).split('\n').length;
      offenders.push(`${path}:${line}`);
      break;
    }
  }
};

const walk = (dir: string): void => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // optional root, e.g. specs/ may not exist in the repo yet
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === '.expo' || entry === 'dist') continue;
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path);
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      scanFile(path);
    }
  }
};

for (const root of SCAN_ROOTS) walk(root);
for (const file of SCAN_FILES) {
  try {
    scanFile(file);
  } catch {
    // optional root-level file
  }
}

if (offenders.length > 0) {
  console.error(`no-em-dash: ${offenders.length} file(s) contain em or en dashes:`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log('no-em-dash: ok');
