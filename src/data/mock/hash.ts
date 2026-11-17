// FNV-1a (32-bit) for the mock layer: deterministic seeds and ids without a
// crypto dependency. Not for real secrets; the storage test double keeps its
// own copy on purpose (see secureStore.ts).

/** Hash a string (per character code) or a byte array, from `seed`. */
export function fnv1a(data: string | number[], seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  if (typeof data === 'string') {
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  } else {
    for (const byte of data) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h;
}
