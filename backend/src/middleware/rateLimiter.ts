import { Request, Response, NextFunction } from 'express';

/**
 * =============================================================================
 * MEDITRACK RATE LIMITER ARCHITECTURE
 * =============================================================================
 * DESIGN & LIMITATION NOTICE:
 *
 * The default `MemoryRateLimitStore` maintains counters in-process memory.
 * This is optimal, zero-dependency and sufficient for:
 *   1. Local execution & demonstrations
 *   2. Single-container / single-dyno production deployments
 *
 * ARCHITECTURAL LIMITATION:
 * In a distributed, multi-instance horizontal cluster (e.g. Kubernetes with
 * multiple pods or multi-node serverless), each instance maintains its own
 * in-memory map. A malicious client could round-robin between pods to multiply
 * its request threshold.
 *
 * For clustered enterprise deployments, implement `IRateLimitStore` backed by
 * Redis, Memcached, or PostgreSQL advisory counters without modifying controller logic.
 * =============================================================================
 */

export interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * Pluggable store interface supporting in-memory, Redis, or cloud KV stores.
 */
export interface IRateLimitStore {
  get(key: string): Promise<RateLimitRecord | undefined> | RateLimitRecord | undefined;
  increment(key: string, windowMs: number): Promise<RateLimitRecord> | RateLimitRecord;
  cleanup?(): Promise<void> | void;
}

/**
 * Robust in-memory rate limit store with TTL eviction and size limits.
 */
export class MemoryRateLimitStore implements IRateLimitStore {
  private store = new Map<string, RateLimitRecord>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;

    // Periodically sweep expired entries every 60 seconds
    setInterval(() => {
      this.cleanup();
    }, 60000).unref();
  }

  get(key: string): RateLimitRecord | undefined {
    const record = this.store.get(key);
    if (!record) return undefined;
    if (Date.now() > record.resetTime) {
      this.store.delete(key);
      return undefined;
    }
    return record;
  }

  increment(key: string, windowMs: number): RateLimitRecord {
    const now = Date.now();
    const existing = this.get(key);

    // If cache is unexpectedly large (e.g. distributed IP flood), prune expired entries immediately
    if (this.store.size >= this.maxEntries) {
      this.cleanup();
    }

    if (!existing || now > existing.resetTime) {
      const record: RateLimitRecord = { count: 1, resetTime: now + windowMs };
      this.store.set(key, record);
      return record;
    }

    existing.count += 1;
    return existing;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key);
      }
    }
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Resolves client IP address safely without trusting unvalidated proxy headers.
 */
export function getClientIp(req: Request): string {
  // If trust proxy is explicitly enabled on Express app, req.ip resolves the verified client address
  if (req.app && req.app.get('trust proxy')) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  // Without trusted proxy configuration, NEVER trust arbitrary X-Forwarded-For headers
  return req.socket.remoteAddress || 'unknown';
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  store?: IRateLimitStore;
  keyGenerator?: (req: Request) => string;
}) {
  const store = options.store || new MemoryRateLimitStore();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);
    const key = options.keyGenerator ? options.keyGenerator(req) : `${req.baseUrl || req.path}_${ip}`;
    const now = Date.now();

    const record = await store.increment(key, options.windowMs);

    res.setHeader('X-RateLimit-Limit', options.maxRequests);

    if (record.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      res.setHeader('Retry-After', retryAfterSec);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.status(429).json({
        success: false,
        error: options.message || 'Too many requests. Please try again later.',
        retryAfter: retryAfterSec,
      });
      return;
    }

    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.maxRequests - record.count));
    next();
  };
}

// 15 requests per 15 minutes for authentication endpoints (strict brute-force defense)
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 15,
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
});

// 180 requests per minute for general authenticated API
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 180,
  message: 'API rate limit exceeded. Please slow down your requests.',
});
