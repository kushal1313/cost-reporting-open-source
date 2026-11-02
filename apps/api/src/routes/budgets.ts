import { prisma, type Prisma } from "@cost-reporting/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { evaluateAllBudgets, evaluateBudget } from "../lib/budgetEngine.js";

const createBudgetSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  period: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
  scopeFilter: z.record(z.unknown()).default({}),
});

const createAlertRuleSchema = z.object({
  notificationChannelId: z.string(),
  condition: z
    .enum(["THRESHOLD_PERCENT", "FORECASTED_OVERSPEND", "ANOMALY_SPIKE"])
    .default("THRESHOLD_PERCENT"),
  thresholdPercent: z.number().int().min(1).max(500).optional(),
});

const orgQuerySchema = z.object({ organizationId: z.string() });
const idParamsSchema = z.object({ id: z.string() });

/**
 * Routes keyed by a budget id also require the caller's organizationId and
 * only match budgets in that org — an id alone must never reach another org's
 * data. Returns null (caller replies 404) rather than revealing that the id
 * exists elsewhere.
 */
async function findOrgBudget(id: string, organizationId: string) {
  return prisma.budget.findFirst({ where: { id, organizationId }, select: { id: true } });
}

export async function budgetRoutes(app: FastifyInstance) {
  app.get("/budgets", async (req) => {
    const { organizationId } = orgQuerySchema.parse(req.query);
    return prisma.budget.findMany({
      where: { organizationId },
      include: {
        alertRules: { include: { notificationChannel: { select: { id: true, name: true, type: true } } } },
      },
    });
  });

  app.post("/budgets", async (req, reply) => {
    const body = createBudgetSchema.parse(req.body);
    const budget = await prisma.budget.create({
      data: { ...body, scopeFilter: body.scopeFilter as Prisma.InputJsonValue },
    });
    return reply.code(201).send(budget);
  });

  app.get("/budgets/:id/status", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    if (!(await findOrgBudget(id, organizationId))) {
      return reply.code(404).send({ error: "Budget not found" });
    }
    return evaluateBudget(id);
  });

  app.post("/budgets/:id/alert-rules", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const body = createAlertRuleSchema.parse(req.body);

    if (!(await findOrgBudget(id, organizationId))) {
      return reply.code(404).send({ error: "Budget not found" });
    }

    // The channel must belong to the budget's org, otherwise one org's budget
    // alerts could be routed to (and leak spend figures into) another org's
    // Slack/email/webhook.
    const channel = await prisma.notificationChannel.findFirst({
      where: { id: body.notificationChannelId, organizationId },
      select: { id: true },
    });
    if (!channel) {
      return reply.code(400).send({
        error: `No notification channel with id "${body.notificationChannelId}" in this organization`,
      });
    }

    const rule = await prisma.alertRule.create({ data: { budgetId: id, ...body } });
    return reply.code(201).send(rule);
  });

  app.delete("/budgets/:id", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { organizationId } = orgQuerySchema.parse(req.query);
    const { count } = await prisma.budget.deleteMany({ where: { id, organizationId } });
    if (count === 0) return reply.code(404).send({ error: "Budget not found" });
    return reply.code(204).send();
  });

  // Manual trigger for now; wire this to a scheduler (cron/Temporal) in production.
  app.post("/budgets/evaluate", async (req) => {
    const { organizationId } = orgQuerySchema.parse(req.query);
    return evaluateAllBudgets(organizationId);
  });
}
