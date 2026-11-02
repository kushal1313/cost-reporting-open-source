# platform-dashboard

[![CI](https://github.com/YOUR_ORG/platform-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/platform-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Update `YOUR_ORG` above once this is pushed to its real GitHub location — same placeholder is used in `package.json`'s `repository`/`homepage`/`bugs` fields.

Open-source, self-hosted platform dashboard. Built as a set of modules, each surfaced as its own section in the sidebar:

- **Cost Reporting** (implemented) — unified cost dashboards, budgets, and Slack/email/webhook alerting across cloud, observability, and AI tools: AWS, Datadog, Grafana Cloud, Claude Enterprise and ChatGPT Enterprise today, with Azure, GCP, Snowflake, and Databricks planned. For per-user AI tools it also shows seat vs. usage cost, cost by team, and the top 10 people.
- **Security Score** (stub) — vulnerability/posture scoring across connected accounts. Not built yet; see `apps/web/src/app/security/page.tsx`.

Cost data from every source is normalized into [FOCUS](https://focus.finops.org/) (the FinOps Open Cost and Usage Specification) so the cost dashboard, budgets, and alerts are provider-agnostic. Adding a new cost source is a matter of writing one connector, not redesigning the schema. Repo/package names still say `cost-reporting-*` internally — that's the original module and hasn't been renamed to avoid unnecessary churn.

**Status:** early scaffold. AWS, Datadog, Grafana Cloud, Claude Enterprise, and ChatGPT Enterprise (CSV import) connectors are implemented; Azure, GCP, Snowflake, and Databricks follow the same `CostConnector` interface and are natural next additions. See [Setting up connectors](#setting-up-connectors) for what each one needs.

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
    claude-enterprise/  Claude Enterprise Analytics API (per-user cost, teams, activity, seats)
    chatgpt-enterprise/ ChatGPT admin console export (CSV import)
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
  // Optional: team costs, per-user activity, seat count, and file import
  // for connectors fed by uploaded exports (see packages/connectors/core).
}
```

Per-user AI tools record who each charge belongs to in FOCUS `x_` extension columns (`x_UserId`, `x_UserEmail`, `x_UserName`).

Budgets are scoped with a simple filter (e.g. `{ "providerName": "AWS" }`) and evaluated against normalized `CostRecord`s; alert rules fire through the notification channel abstraction (Slack webhook, email/SMTP, or a generic webhook) when a threshold is crossed.

There's no auth yet — every API route takes an `organizationId` explicitly. That's the seam a future auth middleware (OIDC/SSO) plugs into; the web app currently just remembers the selected org in `localStorage`.

## Getting started

### 1. Install & configure

```bash
npm install
cp .env.example .env
# generate a real key: openssl rand -base64 32
```

Set `DATABASE_URL` and `ENCRYPTION_KEY` in `.env`. Provider credentials don't go here; each connector's credentials are entered in the UI (see [Setting up connectors](#setting-up-connectors)).

### 2. Postgres

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres
```

`--env-file .env` matters: Compose otherwise looks for `.env` next to the compose file, in `infra/`.

### 3. Database

```bash
npm run db:migrate -w @cost-reporting/db
```

### 4. Run

```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000
```

Open `http://localhost:3000`, create an organization, add a connector (see [Setting up connectors](#setting-up-connectors)), sync or import it, and set a budget with an alert rule.

### Full self-hosted stack

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d
```

## Setting up connectors

Add connectors on the **Connectors** page: pick a provider, give the connector a name, and paste its config as JSON. Credentials are checked when you add the connector, and stored encrypted with `ENCRYPTION_KEY` (see [SECURITY.md](SECURITY.md)). Use read-only credentials for every provider.

| Provider                                                       | What you need                                                                            | How data gets in             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------- |
| [Claude Enterprise](#claude-enterprise)                        | Analytics API key                                                                        | **Sync**                     |
| [ChatGPT Enterprise / Business](#chatgpt-enterprise--business) | Workspace Admin key (Enterprise analytics API: Read), or the admin console's CSV exports | **Sync**, or **Import CSVs** |
| [AWS](#aws)                                                    | Read-only IAM role (or SSO profile / access keys) with Cost Explorer access              | **Sync**                     |
| [Datadog](#datadog)                                            | API key + Application key                                                                | **Sync**                     |
| [Grafana Cloud](#grafana-cloud)                                | Access policy token with `invoices:read`                                                 | **Sync**                     |

### Sync vs. CSV import

- **Sync** connectors pull from the provider's API on demand. Pick a **Sync range** (last 7 days, 30 days or 3 months) above the connector table, then click **Sync** on the connector. The dashboard can show up to 3 months, so sync 3 months to fill its "Last 3 months" view. Re-syncing a range replaces that range's data; it never duplicates it.
- **CSV import** connectors (ChatGPT without an admin key) have no API to pull from. Click **Import CSVs** and choose the export files. Each replaces only its own report's stored data for the dates it covers, so re-importing is safe.

Syncs are manual for now (see [Roadmap](#roadmap)).

### Seat plans (Claude, ChatGPT)

Neither Anthropic nor OpenAI reports seat fees per person, so seat costs come from your contract. Click **Seats** on a connector and enter:

- **Price per seat per month (USD)**: your contracted seat price.
- **Seats**: the number of paid seats. For Claude, leave it blank to use the `assigned_seat_count` the Analytics API reports.

The fee is spread evenly over each month's days, so every date range shows the right share, and monthly budgets add up to the full fee. Seat fees appear in the dashboard's **Seats** tile and in totals and budgets. They're left out of **Top 10 people**, since every seat costs the same. A seat plan applies from the next sync or import. Clear the price to stop booking seat fees.

### Claude Enterprise

For Claude Enterprise (claude.ai) organizations. Pulls daily cost per person, product and model, cost per team, per-person activity, and the seat count.

1. Sign in to claude.ai as the organization's **primary owner**. No other role can create this key.
2. Go to **Organization settings → API** (`claude.ai/admin-settings/api-access`), enable API access, and create an **Analytics API key**. Keys carry the read-only `read:analytics` scope.
3. Copy the key; it's shown once.
4. Add a **Claude Enterprise** connector:

```json
{
  "apiKey": "<Analytics API key>",
  "organizationName": "Acme"
}
```

`organizationName` is optional; it's the label used in reports. An Admin API key from the Claude Console (`sk-ant-admin01-…`) won't work here: Claude Enterprise and the Claude Console use different key types.

What to expect:

- **Per-person dollars depend on your plan.** On usage-based Enterprise plans, cost is reported per person. On seat-based plans the API covers usage credits only, so set a [seat plan](#seat-plans-claude-chatgpt) for seat fees. If no per-person cost is reported, **Top 10 people** ranks people by activity (messages and sessions) and says so.
- **Teams overlap.** Anthropic counts someone in several teams in full toward each team, so **By group** can add up to more than the total. Totals and per-person figures are never double counted.
- **Data delay.** Cost data usually arrives within 4 hours, and can be revised until about 7 days after the month ends; re-sync the previous month after that if you need final numbers. Activity data lags about a day. Data starts on 2026-01-01 and goes back at most 365 days.
- **Rate limit.** The analytics API allows 60 requests per minute per organization, and activity is fetched one day at a time, so a 3-month sync can take a minute or two.

Docs: [Analytics APIs](https://platform.claude.com/docs/en/manage-claude/analytics-api), [Usage and Cost Analytics API](https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api).

### ChatGPT Enterprise / Business

The connector works in one of two modes, picked by its config: **API sync** with a workspace Admin key (Enterprise), or **CSV import** of the admin console's exports when you don't have a key.

#### API sync (recommended)

Pulls each person's daily cost and activity from the [ChatGPT Admin API](https://chatgpt.com/public/admin/api-reference)'s Daily Usage endpoint (`GET /v1/analytics/workspaces/{workspace_id}/usage`).

1. In the [OpenAI Admin Console](https://admin.openai.com/credentials?tab=admin-keys), select your workspace, open **Credentials → Admin keys**, and create an admin key with **Custom** permissions:
   - **Enterprise analytics API: Read** (required): cost, messages and chats per person per day, spend by model, activity by client.
   - **Users: Read** (optional): the seat count, so a [seat plan](#seat-plans-claude-chatgpt) can leave **Seats** blank.
   - **Directory: Read** (optional): cost by group.

   Leave everything else at **None**. The secret is shown once.

2. Add a **ChatGPT Enterprise / Business** connector:

```json
{
  "adminKey": "sk-admin-...",
  "workspaceId": "<workspace UUID>",
  "workspaceName": "Acme",
  "creditPriceUsd": 0.04
}
```

`workspaceId` is your ChatGPT workspace's ID (a UUID). `creditPriceUsd` is your contract's dollars per credit. It's optional here: without it, credits are valued at OpenAI's `estimated_cost_usd`, which uses the overage rate, so it can run higher than committed-credit pricing. Usage OpenAI prices in dollars is taken as is.

3. Pick a sync range and click **Sync**.

What to expect:

- **Cost per person, per day, per client** (ChatGPT web, Codex, …). Usage by people no longer in the workspace is booked unattributed, so totals match the workspace's.
- **Groups use today's membership.** The API filters group usage by current members, so someone who moved groups counts toward the new one, and someone in several groups counts toward each.
- **Data delay.** OpenAI refreshes usage within hours and corrects recent days as late data arrives, so re-sync the last 7 days to pick that up.
- An API-sync connector doesn't accept CSV imports, since a sync replaces everything in its range. To load history from before the API's data, add a separate CSV connector for those dates only.

#### CSV import (no admin key)

1. In the ChatGPT admin console, export the analytics and leaderboard reports as CSV. **Keep the file names the console gives them**: the importer tells several reports apart, and reads the leaderboards' dates, from the name.
2. Add a **ChatGPT Enterprise / Business** connector with no `adminKey`:

```json
{
  "workspaceName": "Acme",
  "creditPriceUsd": 0.04
}
```

`workspaceName` is optional (a label for reports). `creditPriceUsd` is your contract's dollars per credit, needed because the analytics reports count credits, not dollars. (The leaderboards' "Estimated costs" divided by "Credits" gives it.) Config can't be edited after the connector is created yet, so to change it, remove the connector and add it again.

3. Click **Import CSVs** on the connector and select all the files at once. Each file is imported on its own and the result lists how each went.

Each report is stored as its own dataset, and importing a report replaces only that report's earlier data for the dates it covers, so re-importing is safe and the reports don't overwrite each other:

| Export file name starts with                                      | Shown as                                  |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `analytics-credits-by-product` (or `analytics-overview-credits`)  | **Spend**: total, daily trend, by product |
| `analytics-credits-by-model`, `analytics-credits-by-metered-item` | By model, by metered item (in dollars)    |
| `analytics-overview-messages`, `-tokens`, `-active-users`         | Activity by product                       |
| `leaderboard-users`                                               | Top 10 people                             |
| `leaderboard-groups`                                              | By group                                  |

Only credits by product counts toward spend and budgets. The other reports break the same spend down differently (credits by model, by person, …), so adding them in would count it several times. Groups overlap (one person can be in several) and leave out people in no group, so they don't add up to the total. Leaderboards cover a whole period, so import them for the same periods each time (e.g. weekly), since a monthly leaderboard replaces the weekly ones it overlaps.

The connector also still accepts a per-user usage export with a date on every row. Don't import it alongside credits by product, since both count the same spend.

For that per-user usage export, OpenAI doesn't publish the column names, so the importer matches common ones (case and spacing don't matter):

| Data                                                   | Accepted column names                                              | Required        |
| ------------------------------------------------------ | ------------------------------------------------------------------ | --------------- |
| User email                                             | `email`, `user_email`, `email_address`, `user`                     | Yes             |
| Date (`YYYY-MM-DD` = that day, `YYYY-MM` = that month) | `date`, `day`, `usage_date`, `period_start`, `start_date`, `month` | Yes             |
| Last day covered                                       | `period_end`, `end_date`                                           | No              |
| Cost in USD                                            | `cost_usd`, `cost`, `usd`, `amount_usd`, `spend_usd`, `spend`      | One of these    |
| Credits (× `creditPriceUsd`)                           | `credits`, `credits_used`, `credit_usage`, `credits_consumed`      | or one of these |
| Name                                                   | `name`, `user_name`, `full_name`, `display_name`                   | No              |
| Product (e.g. ChatGPT, Codex)                          | `product`, `feature`, `surface`                                    | No              |
| Model                                                  | `model`, `model_name`                                              | No              |
| Group                                                  | `group`, `group_name`, `team`                                      | No              |
| Messages (for activity ranking)                        | `messages`, `message_count`, `messages_sent`                       | No              |

A file missing a required column is rejected with the list of names it accepts. If your export uses different names, rename the header row, or add the names to `COLUMNS` in [`packages/connectors/chatgpt-enterprise/src/index.ts`](packages/connectors/chatgpt-enterprise/src/index.ts).

ChatGPT Business has less usage data than Enterprise; if your workspace has no per-user export, only the seat plan applies. ChatGPT usage billed through the OpenAI API platform is a separate account and isn't covered here.

### AWS

Uses Cost Explorer: daily cost per service and linked account. Connect the **management (payer) account** to see every linked account.

1. Make sure Cost Explorer is enabled in the account (Billing and Cost Management → Cost Explorer).
2. Create an IAM policy that allows only what the connector calls:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage", "ce:GetDimensionValues"],
      "Resource": "*"
    }
  ]
}
```

3. Attach it to one of these, in order of preference:
   - **An IAM role** the server assumes: give the role this policy, and a trust policy that lets the server's own AWS identity (instance/task role or user) call `sts:AssumeRole`, ideally with an external ID.
   - **An SSO profile** on the machine running the API (after `aws sso login`).
   - **Access keys** for a dedicated IAM user with only this policy.
4. Add an **AWS** connector with one of these configs:

```json
{
  "billingAccountId": "123456789012",
  "roleArn": "arn:aws:iam::123456789012:role/cost-reporting-read-only",
  "externalId": "optional-external-id"
}
```

```json
{ "billingAccountId": "123456789012", "profile": "my-sso-profile" }
```

```json
{ "billingAccountId": "123456789012", "accessKeyId": "AKIA…", "secretAccessKey": "…" }
```

With no role, profile or keys, the connector falls back to the API server's default AWS credential chain (environment variables, default profile, instance role). Only rely on that if the server's own identity is meant to be read here (see [SECURITY.md](SECURITY.md)).

AWS charges $0.01 per Cost Explorer API request, so each sync costs a few cents.

### Datadog

Uses Datadog's monthly cost-by-org endpoint: cost per product, per month.

1. In Datadog, go to **Organization Settings → API Keys** and create (or copy) an **API key**.
2. Go to **Organization Settings → Application Keys** and create an **Application key** for a user who can read usage and billing. If you scope the key, give it usage read access (`usage_read`; confirm the scope name in Datadog's key settings).
3. Add a **Datadog** connector:

```json
{
  "apiKey": "<API key>",
  "appKey": "<Application key>",
  "site": "datadoghq.com"
}
```

`site` is your Datadog site: `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com`, and so on. The app URL (`app.datadoghq.com`) works too.

Notes: the usage metering API is available on Pro and Enterprise plans, and data can be up to 72 hours behind. The cost-by-org endpoint is marked deprecated in Datadog's API docs, so this connector may need to move to the historical/estimated cost endpoints.

### Grafana Cloud

Reads invoices: cost per invoice line, per billing period.

1. In the Grafana Cloud Portal (grafana.com), as an org **Admin**, open **Access Policies** and create a policy for your organization (org realm) with the **`invoices:read`** scope.
2. Create a token for that policy and copy it.
3. Add a **Grafana Cloud** connector:

```json
{
  "orgSlug": "my-org",
  "accessToken": "<access policy token>"
}
```

`orgSlug` is the org name in your Grafana Cloud URL (`grafana.com/orgs/<orgSlug>`).

Grafana's invoice API is less formally documented than the others and its response shape can vary by plan. If a sync fails or looks wrong, compare your org's response with `mapInvoiceToRecords` in [`packages/connectors/grafana-cloud/src/index.ts`](packages/connectors/grafana-cloud/src/index.ts).

## Adding a new provider

1. Create `packages/connectors/<provider>/` implementing `CostConnector`, mapping that provider's billing API/export into `FocusRecord`s (see `packages/connectors/aws` for a full example).
2. Register it in `apps/api/src/lib/connectorRegistry.ts`.
3. Add it to the `PROVIDERS` list (plus a label and config placeholder) in `apps/web/src/app/connectors/page.tsx`.
4. Document what it needs under [Setting up connectors](#setting-up-connectors).

No schema or dashboard changes required — everything downstream already speaks FOCUS.

## Roadmap

- Azure, GCP, Snowflake, Databricks connectors
- Editing a connector's config after it's created (currently remove and re-add)
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
