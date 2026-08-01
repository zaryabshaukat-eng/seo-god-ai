import { PrismaClient } from '@prisma/client';

let cached: PrismaClient | undefined;

/** Creates a PrismaClient that logs warnings and errors to the logger. */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ log: ['warn', 'error'] });
}

/** Process-wide PrismaClient singleton. Call once at boot. */
export function getPrismaClient(): PrismaClient {
  cached ??= createPrismaClient();
  return cached;
}

/** Disconnects and clears the cached client. Safe to call repeatedly. */
export async function disconnectPrisma(): Promise<void> {
  if (cached === undefined) return;
  const client = cached;
  cached = undefined;
  await client.$disconnect();
}
