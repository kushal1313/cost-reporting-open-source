import { decryptJson, encryptJson, prisma } from "@cost-reporting/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { connectorRegistry } from "../lib/connectorRegistry.js";
import { syncConnectorInstance } from "../lib/syncService.js";

const createConnectorSchema = z.object({
  organizationId: z.string(),
  provider: z.string(),
  name: z.string(),
  config: z.record(z.unknown()),
});

const syncSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});

export async function connectorRoutes(app: FastifyInstance) {
  app.get("/connectors", async (req) => {
    const { organizationId } = z.object({ organizationId: z.string() }).parse(req.query);
    const instances = await prisma.connectorInstance.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        lastSyncAt: true,
        lastSyncError: true,
        createdAt: true,
      },
    });
    return instances;
  });

  app.post("/connectors", async (req, reply) => {
    const body = createConnectorSchema.parse(req.body);
    const connector = connectorRegistry.get(body.provider);

    let isValid: boolean;
    try {
      isValid = await connector.validateCredentials(body.config);
    } catch (err) {
      // A network/TLS/DNS failure while validating (bad hostname, unreachable
      // API, etc.) isn't the same as "credentials are wrong" — surface the
      // real cause instead of letting it fall through as an opaque 500.
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: `Could not reach ${connector.displayName}: ${message}` });
    }
    if (!isValid) {
      return reply.code(400).send({ error: "Credential validation failed for this provider" });
    }

    const instance = await prisma.connectorInstance.create({
      data: {
        organizationId: body.organizationId,
        provider: body.provider,
        name: body.name,
        encryptedConfig: encryptJson(body.config),
        status: "PENDING",
      },
      select: { id: true, provider: true, name: true, status: true, createdAt: true },
    });
    return reply.code(201).send(instance);
  });

  app.get("/connectors/:id/scopes", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const instance = await prisma.connectorInstance.findUniqueOrThrow({ where: { id } });
    const connector = connectorRegistry.get(instance.provider);
    const config = decryptJson(instance.encryptedConfig);
    return connector.listScopes(config);
  });

  app.post("/connectors/:id/sync", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { start, end } = syncSchema.parse(req.body);
    try {
      await syncConnectorInstance(id, { start, end });
      return reply.send({ status: "ok" });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Sync failed" });
    }
  });

  app.delete("/connectors/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.connectorInstance.delete({ where: { id } });
    return reply.code(204).send();
  });
}
