# Run `docker build -f apps/api/Dockerfile .` from the repo root (this is how
# infra/docker-compose.yml invokes it) since the workspace needs the full monorepo.
FROM node:20-alpine
WORKDIR /app

COPY . .
RUN npm install
RUN npm run db:generate -w @cost-reporting/db
RUN npm run build \
  -w @cost-reporting/focus-schema \
  -w @cost-reporting/connector-core \
  -w @cost-reporting/connector-aws \
  -w @cost-reporting/connector-datadog \
  -w @cost-reporting/connector-grafana-cloud \
  -w @cost-reporting/db \
  -w @cost-reporting/notifications \
  -w @cost-reporting/api

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
