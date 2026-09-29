# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](../../security/advisories/new) for this repository ("Security" tab → "Report a vulnerability"). If that isn't available, open a regular issue asking a maintainer to open a private channel — without details of the vulnerability itself.

Include:

- A description of the issue and its impact
- Steps to reproduce (a minimal repro is ideal)
- The affected version/commit

We'll acknowledge reports within a few days and aim to ship a fix or mitigation before any public disclosure.

## Supported versions

This project is pre-1.0 and does not yet maintain long-term-support branches. Security fixes land on `main`; please run the latest commit.

## Scope and trust model

Worth understanding before you self-host this:

- **Connector credentials are encrypted at rest** (AES-256-GCM, see [`packages/db/src/crypto.ts`](packages/db/src/crypto.ts)) using `ENCRYPTION_KEY`. That key is as sensitive as the credentials it protects — treat it like a production secret (never commit it, rotate it via your own process, back it up separately from the database since losing it makes existing encrypted rows unrecoverable).
- **There is no authentication yet.** Every API route takes an `organizationId` explicitly rather than deriving it from a session — see the note in [`apps/api/src/routes/organizations.ts`](apps/api/src/routes/organizations.ts). Do not expose the API or web app to an untrusted network without putting your own auth/reverse-proxy in front of it.
- **Connector credentials should be read-only.** Every built-in connector only calls read-only provider APIs (Cost Explorer `Get*`, Datadog usage endpoints, etc.), but nothing in this codebase enforces that the credentials _you_ provide are scoped that way. Use least-privilege IAM roles/policies (see the AWS example in the README) rather than broad admin credentials.
- **Notification channel configs (Slack webhook URLs, SMTP credentials, generic webhook URLs) are also encrypted at rest**, same mechanism as connector credentials.
- **CORS is currently wide open** (`origin: true` in [`apps/api/src/index.ts`](apps/api/src/index.ts)) to make local development frictionless. Tighten this to your actual frontend origin before deploying anywhere reachable by untrusted clients.

## Dependencies

Dependency vulnerabilities are tracked via Dependabot (see `.github/dependabot.yml`) and `npm audit` in CI. If `npm audit` reports a vulnerability with no available fix, it'll be noted here or in an issue rather than silently ignored.
