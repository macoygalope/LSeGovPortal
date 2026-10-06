import { randomBytes } from "node:crypto";

// What the admin API (admin-api.ts) keeps in memory about who is signed in:
// the sessions it hands out once a citizen is on the whitelist, and a count of
// failed sign-ins. Both are gone when the server stops, so a restart signs
// everyone out.

export interface Session {
  citizenId: string;
  expiresAt: number;
}

export interface SessionOptions {
  /** How long a sign-in lasts. */
  ttlMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

export const DEFAULT_SESSION_MS = 12 * 60 * 60 * 1000;

export function createSessions({ ttlMs = DEFAULT_SESSION_MS, now = Date.now }: SessionOptions = {}) {
  const sessions = new Map<string, Session>();

  return {
    /** Signs a citizen in: returns the token to send with every later request. */
    start(citizenId: string): { token: string; expiresAt: number } {
      for (const [token, session] of sessions) {
        if (session.expiresAt <= now()) sessions.delete(token);
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now() + ttlMs;
      sessions.set(token, { citizenId, expiresAt });
      return { token, expiresAt };
    },

    /** The session a token belongs to, or undefined if it is unknown or has run out. */
    find(token: string): Session | undefined {
      const session = sessions.get(token);
      if (!session) return undefined;
      if (session.expiresAt <= now()) {
        sessions.delete(token);
        return undefined;
      }
      return session;
    },

    /** Signs a token out. */
    end(token: string): void {
      sessions.delete(token);
    },

    get size(): number {
      return sessions.size;
    },
  };
}

export type Sessions = ReturnType<typeof createSessions>;

export interface LimiterOptions {
  /** Failures allowed within the window before further attempts are refused. */
  max?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Counts failed sign-ins per address. A citizenid is not a secret, so this
 * is all that slows down someone trying ids one after another.
 */
export function createLoginLimiter({ max = 5, windowMs = 60_000, now = Date.now }: LimiterOptions = {}) {
  const failures = new Map<string, number[]>();

  function recent(address: string): number[] {
    const kept = (failures.get(address) ?? []).filter((at) => now() - at < windowMs);
    if (kept.length > 0) failures.set(address, kept);
    else failures.delete(address);
    return kept;
  }

  return {
    /** Seconds until this address may try again, or 0 if it may try now. */
    retryAfter(address: string): number {
      const kept = recent(address);
      if (kept.length < max) return 0;
      return Math.max(1, Math.ceil((kept[0]! + windowMs - now()) / 1000));
    },

    fail(address: string): void {
      failures.set(address, [...recent(address), now()]);
    },

    clear(address: string): void {
      failures.delete(address);
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
