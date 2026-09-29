import { PrismaClient } from "../generated/client/index.js";

// Reuse a single client across hot reloads / lambda invocations.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/client/index.js";
export * from "./crypto.js";
