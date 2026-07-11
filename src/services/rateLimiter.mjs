// ============================================================
// Token Bucket Rate Limiter
// Per-client and per-supplier TPS (Transactions Per Second) enforcement
// Designed for 1000+ clients and 1000+ suppliers simultaneously
// ============================================================

class TokenBucket {
  constructor(maxTokens, refillRatePerSecond) {
    this.maxTokens = maxTokens;           // burst capacity
    this.tokens = maxTokens;              // current tokens
    this.refillRate = refillRatePerSecond; // tokens per second
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** Returns true if a token was consumed (allowed), false if throttled */
  tryConsume(count = 1) {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** Returns ms to wait before next token is available */
  getWaitMs() {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate * 1000);
  }

  getAvailable() {
    this.refill();
    return Math.floor(this.tokens);
  }
}

class RateLimiter {
  constructor() {
    // Per-client rate limiters: keyed by client_id
    this.clientBuckets = new Map();
    // Per-supplier rate limiters: keyed by supplier_id
    this.supplierBuckets = new Map();
    // Default TPS if not configured
    this.defaultClientTPS = 100;
    this.defaultSupplierTPS = 200;
    // Cleanup stale entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /** Register/update a client's TPS limit */
  configureClient(clientId, maxTps) {
    const tps = parseInt(maxTps) || this.defaultClientTPS;
    const existing = this.clientBuckets.get(clientId);
    if (existing) {
      existing.maxTokens = tps;
      existing.refillRate = tps;
      existing.tokens = Math.min(existing.tokens, tps);
    } else {
      this.clientBuckets.set(clientId, new TokenBucket(tps, tps));
    }
  }

  /** Register/update a supplier's pipeline TPS limit */
  configureSupplier(supplierId, maxTps) {
    const tps = parseInt(maxTps) || this.defaultSupplierTPS;
    const existing = this.supplierBuckets.get(supplierId);
    if (existing) {
      existing.maxTokens = tps;
      existing.refillRate = tps;
      existing.tokens = Math.min(existing.tokens, tps);
    } else {
      this.supplierBuckets.set(supplierId, new TokenBucket(tps, tps));
    }
  }

  /** Check if a client can send more messages. Returns { allowed, waitMs } */
  checkClient(clientId) {
    let bucket = this.clientBuckets.get(clientId);
    if (!bucket) {
      // Auto-create with default TPS
      bucket = new TokenBucket(this.defaultClientTPS, this.defaultClientTPS);
      this.clientBuckets.set(clientId, bucket);
    }
    const allowed = bucket.tryConsume(1);
    return { allowed, waitMs: allowed ? 0 : bucket.getWaitMs() };
  }

  /** Check if a supplier pipeline can send more messages */
  checkSupplier(supplierId) {
    let bucket = this.supplierBuckets.get(supplierId);
    if (!bucket) {
      bucket = new TokenBucket(this.defaultSupplierTPS, this.defaultSupplierTPS);
      this.supplierBuckets.set(supplierId, bucket);
    }
    const allowed = bucket.tryConsume(1);
    return { allowed, waitMs: allowed ? 0 : bucket.getWaitMs() };
  }

  /** Bulk consume N tokens from client bucket (for batch submission checks) */
  tryConsumeClientBatch(clientId, count) {
    let bucket = this.clientBuckets.get(clientId);
    if (!bucket) {
      bucket = new TokenBucket(this.defaultClientTPS, this.defaultClientTPS);
      this.clientBuckets.set(clientId, bucket);
    }
    return bucket.tryConsume(count);
  }

  /** Get stats for dashboard */
  getStats() {
    let totalClients = this.clientBuckets.size;
    let totalSuppliers = this.supplierBuckets.size;
    let throttledClients = 0;
    let throttledSuppliers = 0;
    
    for (const b of this.clientBuckets.values()) {
      if (b.getAvailable() === 0) throttledClients++;
    }
    for (const b of this.supplierBuckets.values()) {
      if (b.getAvailable() === 0) throttledSuppliers++;
    }
    
    return {
      activeClients: totalClients,
      throttledClients,
      activeSuppliers: totalSuppliers,
      throttledSuppliers,
      defaultClientTPS: this.defaultClientTPS,
      defaultSupplierTPS: this.defaultSupplierTPS,
    };
  }

  /** Remove entries not accessed in last 10 minutes */
  cleanup() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, bucket] of this.clientBuckets) {
      if (bucket.lastRefill < cutoff) this.clientBuckets.delete(id);
    }
    for (const [id, bucket] of this.supplierBuckets) {
      if (bucket.lastRefill < cutoff) this.supplierBuckets.delete(id);
    }
    console.log(`[RateLimiter] Cleanup: ${this.clientBuckets.size} client buckets, ${this.supplierBuckets.size} supplier buckets remaining`);
  }

  shutdown() {
    clearInterval(this.cleanupInterval);
  }
}

// Global singleton
const rateLimiter = new RateLimiter();
export default rateLimiter;
