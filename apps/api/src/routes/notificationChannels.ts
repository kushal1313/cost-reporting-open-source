import { encryptJson, prisma } from "@cost-reporting/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createChannelSchema = z.object({
  organizationId: z.string(),
  type: z.enum(["slack", "email", "webhook"]),
  name: z.string(),
  config: z.record(z.unknown()),
});

export async function notificationChannelRoutes(app: FastifyInstance) {
  app.get("/notification-channels", async (req) => {
    const { organizationId } = z.object({ organizationId: z.string() }).parse(req.query);
    return prisma.notificationChannel.findMany({
      where: { organizationId },
      select: { id: true, type: true, name: true, createdAt: true },
    });
  });

  app.post("/notification-channels", async (req, reply) => {
    const body = createChannelSchema.parse(req.body);
    const channel = await prisma.notificationChannel.create({
      data: {
        organizationId: body.organizationId,
        type: body.type,
        name: body.name,
        encryptedConfig: encryptJson(body.config),
      },
      select: { id: true, type: true, name: true, createdAt: true },
    });
    return reply.code(201).send(channel);
  });

  app.delete("/notification-channels/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.notificationChannel.delete({ where: { id } });
    return reply.code(204).send();
  });
}
