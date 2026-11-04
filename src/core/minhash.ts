/**
 * MinHash over word unigrams + bigrams. Signatures are small and contain no text,
 * so MindStash can remember what the user deleted without keeping the content.
 */

export const SIG_SIZE = 64;

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can do does for from has have he her his i if in into is it its ' +
    'me my no not of on or our she so than that the their them then there these they this to too us ' +
    'was we were what when where which who will with would you your should must also just only very'
  ).split(' '),
);

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function features(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>(w);
  for (let i = 0; i + 1 < w.length; i++) out.add(w[i] + ' ' + w[i + 1]);
  return out;
}

/** FNV-1a followed by a murmur3 finalizer, so similar strings spread well. */
function hash32(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function signature(text: string): number[] {
  const sig = new Array<number>(SIG_SIZE).fill(0xffffffff);
  for (const f of features(text)) {
    // Two base hashes give SIG_SIZE hash functions (Kirsch–Mitzenmacher).
    const h1 = hash32(f, 0x9747b28c);
    const h2 = hash32(f, 0x5bd1e995) | 1;
    for (let k = 0; k < SIG_SIZE; k++) {
      const h = (h1 + Math.imul(k, h2)) >>> 0;
      if (h < sig[k]!) sig[k] = h;
    }
  }
  return sig;
}

/** Estimated Jaccard similarity, 0..1. */
export function similarity(a: number[], b: number[]): number {
  let same = 0;
  for (let k = 0; k < SIG_SIZE; k++) if (a[k] === b[k]) same++;
  return same / SIG_SIZE;
}

/** Texts with too few words give unreliable signatures. */
export function comparable(text: string): boolean {
  return words(text).length >= 8;
}
