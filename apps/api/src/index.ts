import cors from "@fastify/cors";
import Fastify from "fastify";
import { budgetRoutes } from "./routes/budgets.js";
import { connectorRoutes } from "./routes/connectors.js";
import { costRoutes } from "./routes/costs.js";
import { healthRoutes } from "./routes/health.js";
import { notificationChannelRoutes } from "./routes/notificationChannels.js";
import { organizationRoutes } from "./routes/organizations.js";

const app = Fastify({ logger: true });

// @fastify/cors only allows GET/HEAD/POST by default, which silently blocks the
// web app's DELETE calls (removing connectors, budgets, channels) at preflight.
await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "DELETE"] });

await app.register(healthRoutes);
await app.register(organizationRoutes);
await app.register(connectorRoutes);
await app.register(costRoutes);
await app.register(budgetRoutes);
await app.register(notificationChannelRoutes);

const port = Number(process.env.API_PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
