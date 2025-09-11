import { prisma } from "@repo/db";

// Fallback in-process lock to reduce duplicate starts in a single process when DB advisory locks are unavailable
const inProcessRepoLocks = new Set<string>();

function getLockSql(repoFullName: string) {
  // Use Postgres advisory locks with hashtext to derive a stable key from repoFullName
  return {
    tryLock: prisma.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      repoFullName
    ),
    unlock: prisma.$queryRawUnsafe<{ unlocked: boolean }[]>(
      `SELECT pg_advisory_unlock(hashtext($1)) AS unlocked`,
      repoFullName
    ),
  };
}

export async function tryAcquireRepoLock(
  repoFullName: string
): Promise<boolean> {
  try {
    const { tryLock } = getLockSql(repoFullName);
    const result = await tryLock;
    const locked = Array.isArray(result) && result[0]?.locked === true;
    if (locked) return true;
  } catch (err) {
    // Fall through to in-process lock on any failure (e.g., non-Postgres DB)
    console.warn(
      `[REPO_LOCK] Falling back to in-process lock for ${repoFullName}:`,
      err
    );
  }

  if (inProcessRepoLocks.has(repoFullName)) return false;
  inProcessRepoLocks.add(repoFullName);
  return true;
}

export async function releaseRepoLock(repoFullName: string): Promise<void> {
  try {
    const { unlock } = getLockSql(repoFullName);
    await unlock;
  } catch {
    // Ignore errors; still release in-process lock
  } finally {
    inProcessRepoLocks.delete(repoFullName);
  }
}
