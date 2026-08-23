// Self-check for the only non-trivial logic in the project: the oklch -> sRGB
// conversion every colour in the UI passes through.
//   node src/theme.test.js
const assert = require('node:assert/strict');
const { oklch, alpha, C } = require('./theme');

// Anchors: oklch coordinates of the sRGB primaries.
assert.equal(oklch(1, 0, 0), 'rgb(255, 255, 255)');
assert.equal(oklch(0, 0, 0), 'rgb(0, 0, 0)');
assert.equal(oklch(0.62796, 0.25768, 29.234), 'rgb(255, 0, 0)');
assert.equal(oklch(0.86644, 0.29483, 142.495), 'rgb(0, 255, 0)');
assert.equal(oklch(0.45201, 0.31321, 264.052), 'rgb(0, 0, 255)');

// Out-of-gamut input clamps instead of producing NaN.
assert.match(oklch(0.5, 0.9, 200), /^rgb\(\d+, \d+, \d+\)$/);

// Alpha passthrough and re-tinting.
assert.equal(oklch(0, 0, 0, 0.5), 'rgba(0, 0, 0, 0.5)');
assert.equal(alpha(C.amber, 0.14), 'rgba(255, 175, 56, 0.14)');
assert.equal(alpha(oklch(0, 0, 0, 0.6), 0.2), 'rgba(0, 0, 0, 0.2)'); // replaces, does not append

console.log('theme: ok');
