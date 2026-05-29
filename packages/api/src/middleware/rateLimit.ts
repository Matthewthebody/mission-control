import type { NextFunction, Request, Response } from "express";

type Entry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Entry>();

export function createRateLimiter(options: {
  bucket: string;
  windowMs: number;
  max: number;
  key: (req: Request) => string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const bucketKey = `${options.bucket}:${options.key(req)}`;
    const existing = buckets.get(bucketKey);
    if (!existing || existing.resetAt <= now) {
      buckets.set(bucketKey, {
        count: 1,
        resetAt: now + options.windowMs
      });
      return next();
    }
    existing.count += 1;
    if (existing.count > options.max) {
      return res.status(429).json({ error: "Too many requests" });
    }
    return next();
  };
}
