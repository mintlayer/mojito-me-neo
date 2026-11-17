// Secret-logging guard: no console.* anywhere in the native module facade
// or the key modules. Binding calls carry key blobs, and the security note
// is "never log": the check fails the build instead of trusting review to
// catch a stray debug line. Test sources are exempt: they run in the Node
// gate and their stdout is the harness output.
//   tsx scripts/no-console.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCAN_ROOTS = ['modules/mojito-core', 'src/keys'];

const failures: string[] = [];

const walk = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx|kt|swift|js)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      const text = readFileSync(path, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (/\bconsole\.(log|info|warn|error|debug|trace)\b/.test(line)) {
          failures.push(`${path}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
};

for (const root of SCAN_ROOTS) {
  try {
    walk(root);
  } catch {
    failures.push(`scan root missing: ${root}`);
  }
}

if (failures.length > 0) {
  console.error('no-console: console use is not allowed in these modules:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('no-console: clean');
