import { prisma } from "@cost-reporting/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createOrgSchema = z.object({ name: z.string() });

/**
 * Minimal org bootstrap so the app is usable before real auth (SSO/OIDC) lands.
 * Every other route takes an organizationId rather than deriving it from a
 * session, which is the seam a future auth middleware will fill in.
 */
export async function organizationRoutes(app: FastifyInstance) {
  app.get("/organizations", async () => prisma.organization.findMany());

  app.post("/organizations", async (req, reply) => {
    const body = createOrgSchema.parse(req.body);
    const org = await prisma.organization.create({ data: body });
    return reply.code(201).send(org);
  });
}
