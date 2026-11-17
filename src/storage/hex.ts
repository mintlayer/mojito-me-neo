// Neutral hex codecs for the storage layer. They live here rather than being
// imported from modules/mojito-core so storage never couples to bindings
// error types: the native core keeps its own binding-flavored codecs, and the
// memory test double throws plain errors from these.

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0) throw new Error('odd-length hex string');
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}
