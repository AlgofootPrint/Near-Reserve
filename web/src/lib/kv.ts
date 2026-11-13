import "server-only";

/**
 * Tiny JSON key-value store. Upstash Redis (REST) when configured, process memory otherwise.
 * Memory is fine for local dev; deployments with several instances need Redis.
 */

const URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = Boolean(URL && TOKEN);

async function redis<T = unknown>(command: (string | number)[]): Promise<T> {
  const res = await fetch(URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const body = (await res.json()) as { result: T; error?: string };
  if (!res.ok || body.error) throw new Error(`Redis: ${body.error ?? res.status}`);
  return body.result;
}

const mem = globalThis as unknown as { __kv?: Map<string, { v: string; exp?: number }> };
const local = (mem.__kv ??= new Map());

function localGet(key: string) {
  const hit = local.get(key);
  if (hit?.exp && hit.exp < Date.now()) {
    local.delete(key);
    return null;
  }
  return hit?.v ?? null;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = useRedis ? await redis<string | null>(["GET", key]) : localGet(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setJson(key: string, value: unknown, ttlSec?: number) {
  const v = JSON.stringify(value);
  if (useRedis) {
    await redis(ttlSec ? ["SET", key, v, "EX", ttlSec] : ["SET", key, v]);
  } else {
    local.set(key, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
  }
}

/** Best-effort mutex so only one request advances the game at a time. */
export async function tryLock(key: string, ttlMs: number): Promise<boolean> {
  if (useRedis) return (await redis<string | null>(["SET", key, "1", "NX", "PX", ttlMs])) === "OK";
  if (localGet(key)) return false;
  local.set(key, { v: "1", exp: Date.now() + ttlMs });
  return true;
}

export async function unlock(key: string) {
  if (useRedis) await redis(["DEL", key]);
  else local.delete(key);
}

/** Fixed-window rate limit. Returns true when over the limit. */
export async function rateLimited(key: string, max: number, windowSec: number) {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  if (useRedis) {
    const n = await redis<number>(["INCR", bucket]);
    if (n === 1) await redis(["EXPIRE", bucket, windowSec]);
    return n > max;
  }
  const n = Number(localGet(bucket) ?? 0) + 1;
  local.set(bucket, { v: String(n), exp: Date.now() + windowSec * 1000 });
  return n > max;
}
