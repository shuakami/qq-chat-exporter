/**
 * Bloom filter matching the QCE chunked export bit-level semantics:
 * FNV-1a 32-bit over UTF-16 code units, bit index (h1 + i*h2) % bits,
 * base64-encoded byte array, 2/3-gram tokenization of lowercased text.
 */

export function fnv1a32(units: ArrayLike<number>, from: number, to: number, seed: number): number {
  let h = seed === 0 ? 0x811c9dc5 : seed;
  for (let k = from; k < to; k++) {
    h ^= units[k]! & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function toUnits(s: string): Uint16Array {
  const u = new Uint16Array(s.length);
  for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k);
  return u;
}

const H2_SEED = (0x811c9dc5 ^ 0x5bd1e995) >>> 0;

export class BloomFilter {
  readonly bits: number;
  readonly hashes: number;
  readonly bytes: Uint8Array;

  constructor(bits: number, hashes: number, bytes?: Uint8Array) {
    this.bits = bits;
    this.hashes = hashes;
    this.bytes = bytes ?? new Uint8Array(Math.ceil(bits / 8));
  }

  addRange(units: Uint16Array, from: number, to: number): void {
    if (to <= from || this.bits === 0) return;
    const h1 = fnv1a32(units, from, to, 0x811c9dc5);
    const h2 = fnv1a32(units, from, to, H2_SEED);
    for (let i = 0; i < this.hashes; i++) {
      const idx = (h1 + i * h2) % this.bits >>> 0;
      this.bytes[idx >> 3]! |= 1 << (idx & 7);
    }
  }

  hasRange(units: Uint16Array, from: number, to: number): boolean {
    if (to <= from) return true;
    const h1 = fnv1a32(units, from, to, 0x811c9dc5);
    const h2 = fnv1a32(units, from, to, H2_SEED);
    for (let i = 0; i < this.hashes; i++) {
      const idx = (h1 + i * h2) % this.bits >>> 0;
      if (!(this.bytes[idx >> 3]! & (1 << (idx & 7)))) return false;
    }
    return true;
  }

  /** Adds all 2-grams and 3-grams of the text, QCE `addTextToBloom` semantics. */
  addText(textLower: string): void {
    const units = toUnits(textLower);
    for (const n of [2, 3]) {
      if (units.length < n) continue;
      for (let i = 0; i + n <= units.length; i++) this.addRange(units, i, i + n);
    }
  }

  /** May-contain test: every 2/3-gram of the query must be present. */
  mayContain(queryLower: string): boolean {
    const units = toUnits(queryLower);
    if (units.length < 2) return true;
    for (const n of [2, 3]) {
      if (units.length < n) continue;
      for (let i = 0; i + n <= units.length; i++) {
        if (!this.hasRange(units, i, i + n)) return false;
      }
    }
    return true;
  }

  /** Whole-token may-contain test (e.g. sender uid tokens). */
  mayContainToken(token: string): boolean {
    if (!token) return true;
    const units = toUnits(token);
    return this.hasRange(units, 0, units.length);
  }

  toBase64(): string {
    let bin = '';
    for (const b of this.bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  static fromBase64(b64: string, bits: number, hashes: number): BloomFilter {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return new BloomFilter(bits, hashes, bytes);
  }
}
