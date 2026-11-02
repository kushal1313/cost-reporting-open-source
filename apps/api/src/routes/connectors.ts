import { decryptJson, encryptJson, prisma } from "@cost-reporting/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { connectorRegistry } from "../lib/connectorRegistry.js";
import { importConnectorFile, syncConnectorInstance } from "../lib/syncService.js";

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

const seatPlanSchema = z.object({
  seatPricePerMonth: z.number().nonnegative().nullable(),
  seatCount: z.number().int().positive().nullable(),
});

const importSchema = z.object({ content: z.string().min(1) });

// Exports for a month of per-user usage can run to several MB.
const IMPORT_BODY_LIMIT = 25 * 1024 * 1024;

const orgQuerySchema = z.object({ organizationId: z.string() });
const idParamsSchema = z.object({ id: z.string() });

export async function connectorRoutes(app: FastifyInstance) {
  app.get("/connectors", async (req) => {
    const { organizationId } = orgQuerySchema.parse(req.query);
    const instances = await prisma.connectorInstance.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        lastSyncAt: true,
        lastSyncError: true,
        seatPricePerMonth: true,
        seatCount: true,
        createdAt: true,
      },
    });
    return instances.map((i) => ({
      ...i,
      seatPricePerMonth: i.seatPricePerMonth == null ? null : Number(i.seatPricePerMonth),
      ingestion: connectorRegistry.get(i.provider).ingestion ?? "api",
    }));
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

  // Routes keyed by a connector id also require organizationId and only match
  // connectors in that org, so an id alone can't read, sync or delete another
  // org's connector (and its decrypted credentials).
  app.get("/connectors/:id/scopes", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const instance = await prisma.connectorInstance.findFirst({ where: { id, organizationId } });
    if (!instance) return reply.code(404).send({ error: "Connector not found" });
    const connector = connectorRegistry.get(instance.provider);
    const config = decryptJson(instance.encryptedConfig);
    return connector.listScopes(config);
  });

  app.post("/connectors/:id/sync", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const { start, end } = syncSchema.parse(req.body);
    const instance = await prisma.connectorInstance.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!instance) return reply.code(404).send({ error: "Connector not found" });
    try {
      await syncConnectorInstance(id, { start, end });
      return reply.send({ status: "ok" });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Sync failed" });
    }
  });

  // Seat plan for seat-licensed products; applied on the next sync or import.
  app.post("/connectors/:id/seat-plan", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const body = seatPlanSchema.parse(req.body);
    const { count } = await prisma.connectorInstance.updateMany({
      where: { id, organizationId },
      data: body,
    });
    if (count === 0) return reply.code(404).send({ error: "Connector not found" });
    return reply.send({ status: "ok" });
  });

  app.post("/connectors/:id/import", { bodyLimit: IMPORT_BODY_LIMIT }, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const { content } = importSchema.parse(req.body);
    const instance = await prisma.connectorInstance.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!instance) return reply.code(404).send({ error: "Connector not found" });
    try {
      const range = await importConnectorFile(id, content);
      return reply.send({ status: "ok", start: range.start, end: range.end });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Import failed" });
    }
  });

  app.delete("/connectors/:id", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const { count } = await prisma.connectorInstance.deleteMany({ where: { id, organizationId } });
    if (count === 0) return reply.code(404).send({ error: "Connector not found" });
    return reply.code(204).send();
  });
}
