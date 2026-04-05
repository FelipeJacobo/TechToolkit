import IORedis from "ioredis";

const Redis = IORedis.default ?? IORedis;

export interface IdempotencyStore {
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private seenMap = new Map<string, number>();

  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.seenMap.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }
    this.seenMap.set(key, now + ttlSeconds * 1000);
    return true;
  }
}

export class RedisIdempotencyStore implements IdempotencyStore {
  private client: IORedis.Redis;
  constructor(private url: string) {
    this.client = new Redis(url);
  }

  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }
}
