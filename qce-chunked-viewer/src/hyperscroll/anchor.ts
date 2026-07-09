import type { Anchor } from './types.js';
 
/** Reads the pixel height of item `index`; must return a positive number. */
export type HeightFn = (index: number) => number;
 
/**
 * Normalize an anchor whose offset has drifted outside the anchor item's
 * height (after a wheel/touch delta), walking the anchor index forward or
 * backward and clamping to [0, count).
 *
 * Pure and iterative: heights are supplied by `heightAt`, so this works
 * identically against real DOM measurements and test fixtures.
 */
export function normalizeAnchor(anchor: Anchor, count: number, heightAt: HeightFn): Anchor {
  let { index, offset } = anchor;
  if (count <= 0) return { index: 0, offset: 0 };
  if (index < 0) return { index: 0, offset: 0 };
  if (index >= count) return { index: count - 1, offset: 0 };
 
  while (offset < 0) {
    if (index === 0) return { index: 0, offset: 0 };
    index -= 1;
    offset += heightAt(index);
  }
  for (;;) {
    const h = heightAt(index);
    if (offset < h) break;
    if (index === count - 1) return { index, offset: 0 };
    offset -= h;
    index += 1;
  }
  return { index, offset };
}
 
/** Map a scrollbar position to an item index (coarse navigation path). */
export function scrollTopToIndex(scrollTop: number, maxScrollTop: number, count: number): number {
  if (count <= 1 || maxScrollTop <= 0) return 0;
  const frac = Math.min(Math.max(scrollTop / maxScrollTop, 0), 1);
  return Math.round(frac * (count - 1));
}
 
/** Map an item index back to a scrollbar position (keeps the thumb honest). */
export function indexToScrollTop(index: number, maxScrollTop: number, count: number): number {
  if (count <= 1 || maxScrollTop <= 0) return 0;
  const frac = Math.min(Math.max(index / (count - 1), 0), 1);
  return frac * maxScrollTop;
}
