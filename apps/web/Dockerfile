# Run `docker build -f apps/web/Dockerfile .` from the repo root (this is how
# infra/docker-compose.yml invokes it) since the workspace needs the full monorepo.
FROM node:20-alpine
WORKDIR /app

COPY . .
RUN npm install
RUN npm run build -w @cost-reporting/web

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@cost-reporting/web"]
