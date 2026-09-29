# platform-dashboard

[![CI](https://github.com/YOUR_ORG/platform-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/platform-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Update `YOUR_ORG` above once this is pushed to its real GitHub location — same placeholder is used in `package.json`'s `repository`/`homepage`/`bugs` fields.

Open-source, self-hosted platform dashboard. Built as a set of modules, each surfaced as its own section in the sidebar:

- **Cost Reporting** (implemented) — unified cost dashboards, budgets, and Slack/email/webhook alerting across AWS, Azure, GCP, Datadog, Grafana Cloud, Snowflake, and Databricks.
- **Security Score** (stub) — vulnerability/posture scoring across connected accounts. Not built yet; see `apps/web/src/app/security/page.tsx`.

Cost data from every source is normalized into [FOCUS](https://focus.finops.org/) (the FinOps Open Cost and Usage Specification) so the cost dashboard, budgets, and alerts are provider-agnostic. Adding a new cost source is a matter of writing one connector, not redesigning the schema. Repo/package names still say `cost-reporting-*` internally — that's the original module and hasn't been renamed to avoid unnecessary churn.

**Status:** early scaffold. AWS, Datadog, and Grafana Cloud connectors are implemented; Azure, GCP, Snowflake, and Databricks follow the same `CostConnector` interface and are natural next additions.

## Architecture

```
apps/
  api/              Fastify backend — connector sync, cost queries, budgets, alerting
  web/              Next.js dashboard
packages/
  focus-schema/     Shared FOCUS types (the normalized cost record shape)
  connectors/
    core/            CostConnector interface + registry
    aws/              Cost Explorer
    datadog/           Usage/Cost API
    grafana-cloud/      Billing API
  notifications/     Slack / email / generic webhook senders
  db/                 Prisma schema (Postgres) + credential encryption
infra/
  docker-compose.yml  Postgres + api + web for self-hosting
```

Each connector implements:

```ts
interface CostConnector<TConfig> {
  provider: string;
  validateCredentials(config: TConfig): Promise<boolean>;
  listScopes(config: TConfig): Promise<Scope[]>;
  syncCosts(config: TConfig, range: DateRange): AsyncGenerator<FocusRecord>;
}
```

Budgets are scoped with a simple filter (e.g. `{ "providerName": "AWS" }`) and evaluated against normalized `CostRecord`s; alert rules fire through the notification channel abstraction (Slack webhook, email/SMTP, or a generic webhook) when a threshold is crossed.

There's no auth yet — every API route takes an `organizationId` explicitly. That's the seam a future auth middleware (OIDC/SSO) plugs into; the web app currently just remembers the selected org in `localStorage`.

## Getting started

### 1. Postgres

```bash
docker compose -f infra/docker-compose.yml up -d postgres
```

### 2. Install & configure

```bash
npm install
cp .env.example .env
# generate a real key: openssl rand -base64 32
```

Set `DATABASE_URL` and `ENCRYPTION_KEY` in `.env`.

### 3. Database

```bash
npm run db:migrate -w @cost-reporting/db
```

### 4. Run

```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000
```

Open `http://localhost:3000`, create an organization, add a connector (AWS/Datadog/Grafana Cloud credentials — read-only, see `.env.example` for the shape each provider expects), sync it, and set a budget with an alert rule.

### Full self-hosted stack

```bash
docker compose -f infra/docker-compose.yml up -d
```

## Adding a new provider

1. Create `packages/connectors/<provider>/` implementing `CostConnector`, mapping that provider's billing API/export into `FocusRecord`s (see `packages/connectors/aws` for a full example).
2. Register it in `apps/api/src/lib/connectorRegistry.ts`.
3. Add it to the `PROVIDERS` list in `apps/web/src/app/connectors/page.tsx`.

No schema or dashboard changes required — everything downstream already speaks FOCUS.

## Roadmap

- Azure, GCP, Snowflake, Databricks connectors
- Security Score module (currently a stub page — see `apps/web/src/app/security`)
- Auth (OIDC/SSO) + RBAC enforcement
- Scheduled syncs (currently manual/on-demand — see the "Evaluate now" button on Budgets)
- Anomaly detection, cost forecasting
- Tag-based budget scoping (currently limited to provider/service/account)
- MS Teams / PagerDuty notification channels
- Automated test suite (none yet — see [CONTRIBUTING.md](CONTRIBUTING.md#testing))

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — covers local setup, code style, and how to add a new connector.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process and this project's trust model (what's encrypted, what auth doesn't exist yet, etc.) — worth reading before self-hosting this anywhere reachable by untrusted users.

## License

[MIT](LICENSE)
