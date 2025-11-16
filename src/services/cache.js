import NodeCache from 'node-cache';

export class CacheManager {
  constructor() {
    const ttl = process.env.CACHE_TTL || 3600; // 1 hour default
    this.cache = new NodeCache({ stdTTL: ttl, checkperiod: 120 });

    console.log(`📦 Cache initialized with TTL: ${ttl}s`);
  }

  get(key) {
    const value = this.cache.get(key);
    if (value) {
      console.log(`✅ Cache hit: ${key}`);
    } else {
      console.log(`❌ Cache miss: ${key}`);
    }
    return value;
  }

  set(key, value) {
    this.cache.set(key, value);
    console.log(`💾 Cached: ${key}`);
  }

  del(key) {
    this.cache.del(key);
    console.log(`🗑️  Deleted from cache: ${key}`);
  }

  flush() {
    this.cache.flushAll();
    console.log(`🧹 Cache flushed`);
  }

  getStats() {
    return this.cache.getStats();
  }
}
