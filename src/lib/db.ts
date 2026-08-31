import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool };

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Recycle connections before the server has a chance to drop them itself —
    // an idle client whose server-side connection was closed throws an unhandled
    // 'error' on the pool otherwise (see node-postgres pooling docs).
    idleTimeoutMillis: 20_000,
  });
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});
const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}
