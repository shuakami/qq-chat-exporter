/**
 * Bounded LRU of measured item heights plus a running average used as the
 * estimate for unmeasured items. Memory stays O(capacity) regardless of the
 * dataset size, which is what keeps 10^8-item sources at a few MB of heap.
 */
export class HeightCache {
  private readonly map = new Map<number, number>();
  private sum = 0;
  private n = 0;
 
  constructor(
    private readonly fallback: number,
    private readonly capacity = 5000,
  ) {}
 
  set(index: number, height: number): void {
    if (height <= 0) return;
    const prev = this.map.get(index);
    if (prev === undefined) {
      this.sum += height;
      this.n += 1;
      if (this.map.size >= this.capacity) {
        const oldest = this.map.keys().next();
        if (!oldest.done) {
          const evicted = this.map.get(oldest.value);
          this.map.delete(oldest.value);
          if (evicted !== undefined) {
            this.sum -= evicted;
            this.n -= 1;
          }
        }
      }
    } else {
      this.sum += height - prev;
      this.map.delete(index); // refresh LRU position
    }
    this.map.set(index, height);
  }
 
  get(index: number): number {
    return this.map.get(index) ?? this.average();
  }
 
  has(index: number): boolean {
    return this.map.has(index);
  }
 
  average(): number {
    return this.n > 0 ? this.sum / this.n : this.fallback;
  }
 
  get size(): number {
    return this.map.size;
  }
}
