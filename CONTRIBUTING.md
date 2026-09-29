# Contributing

Thanks for considering a contribution. This project is early — expect rough edges, and feel free to open an issue before a large PR to check the direction makes sense.

## Getting set up

Prerequisites: Node.js >= 20, a local Postgres instance.

```bash
npm install
cp .env.example .env
# set DATABASE_URL and ENCRYPTION_KEY (openssl rand -base64 32) in .env
npm run db:migrate -w @cost-reporting/db
npm run dev:api   # terminal 1
npm run dev:web   # terminal 2
```

See the [README](README.md) for the full walkthrough, including how to set up a real cloud connector.

## Before opening a PR

```bash
npm run typecheck --workspaces --if-present
npm run lint --workspaces --if-present
npm run build --workspaces --if-present
```

All three run in CI (`.github/workflows/ci.yml`); a PR won't merge if they fail. There's no automated test suite yet (see "Testing" below) — until there is, a clear description of how you manually verified the change is expected in the PR.

## Code style

- TypeScript, strict mode, no `any` unless there's genuinely no better option.
- No comments explaining _what_ code does — name things well instead. Comments are for non-obvious _why_ (a workaround, a constraint from an external API, a subtle invariant).
- Don't add abstraction, config options, or error handling for cases that can't happen yet. Match the existing code's level of directness.
- Formatting is enforced by Prettier (`npm run format`) and linting by ESLint (`npm run lint`) — both run in CI.

## Adding a new cost connector

This is the most common kind of contribution. See the "Adding a new provider" section in the [README](README.md#adding-a-new-provider) — implement the `CostConnector` interface from `packages/connectors/core`, mapping the provider's billing data into `FocusRecord`s (the [FOCUS spec](https://focus.finops.org/)). [`packages/connectors/aws`](packages/connectors/aws) is the fullest reference implementation.

## Testing

There isn't an automated test suite yet — this is one of the more valuable things to contribute. If you're adding tests, [Vitest](https://vitest.dev/) is a reasonable default for the TypeScript/Node packages here; open an issue first if you want to propose a different setup so we don't end up with two testing stacks.

## Commit messages / PRs

- Keep PRs focused — one logical change per PR is easier to review than a bundle of unrelated fixes.
- Write commit messages and PR descriptions around _why_, not just _what_ (the diff already shows what changed).
- Link the issue you're addressing, if there is one.

## Reporting bugs / requesting features

Use the issue templates (`.github/ISSUE_TEMPLATE/`). For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.
