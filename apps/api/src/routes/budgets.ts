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

export async function budgetRoutes(app: FastifyInstance) {
  app.get("/budgets", async (req) => {
    const { organizationId } = z.object({ organizationId: z.string() }).parse(req.query);
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

  app.get("/budgets/:id/status", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return evaluateBudget(id);
  });

  app.post("/budgets/:id/alert-rules", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = createAlertRuleSchema.parse(req.body);

    const channel = await prisma.notificationChannel.findUnique({
      where: { id: body.notificationChannelId },
    });
    if (!channel) {
      return reply
        .code(400)
        .send({ error: `No notification channel with id "${body.notificationChannelId}"` });
    }

    const rule = await prisma.alertRule.create({ data: { budgetId: id, ...body } });
    return reply.code(201).send(rule);
  });

  app.delete("/budgets/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.budget.delete({ where: { id } });
    return reply.code(204).send();
  });

  // Manual trigger for now; wire this to a scheduler (cron/Temporal) in production.
  app.post("/budgets/evaluate", async () => {
    return evaluateAllBudgets();
  });
}
