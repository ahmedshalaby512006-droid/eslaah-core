import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export class DistributedLockService {
  constructor(private readonly redis: Redis) {}

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const lockToken = randomUUID();
    const acquired = await this.redis.set(key, lockToken, 'PX', ttlMs, 'NX');
    return acquired === 'OK' ? lockToken : null;
  }

  async releaseLock(key: string, lockToken: string): Promise<boolean> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(luaScript, 1, key, lockToken);
    return result === 1;
  }
}