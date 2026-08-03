# SEO GOD AI

AI-powered SEO Operating System that safely automates SEO for Shopify stores.

> **Status: Milestone 1** — Connecting to Shopify, crawling, auditing, and displaying results in a dashboard. AI agents come after the core engine works.

## Mission

Create the world's most advanced AI-powered SEO Operating System that safely automates SEO for Shopify stores.

Full vision and principles: [docs/VISION.md](docs/VISION.md)

## Architecture

Monorepo (npm workspaces):

```
apps/
  dashboard/     User interface
  api/           Backend services
packages/
  agents/        Specialized AI workers (CEO, Planner, Technical SEO, On-Page, ...)
  ai/            AI orchestration
  crawler/       Crawl and analyze the site
  seo-engine/    SEO scoring and recommendations
  reports/       PDF and dashboard reporting
  safety/        Validation before changes
  shopify/       Shopify integration
  shared/        Shared types and utilities
  ui/            Shared UI components
docs/            Vision and architecture documents
infrastructure/  Deployment and infrastructure-as-code
scripts/         Automation scripts
tests/           Cross-package integration tests
```

## Prerequisites

- Node.js >= 20
- npm >= 10
- Docker (optional, for local Postgres/Redis)

## Getting Started

```bash
npm install
cp .env.example .env
docker compose up -d   # optional: local Postgres + Redis
```

## Development

| Command             | Purpose                  |
| ------------------- | ------------------------ |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run lint`      | Lint all workspaces      |
| `npm run test`      | Test all workspaces      |
| `npm run build`     | Build all workspaces     |

## Safety

This project is built around a simple rule: **no spammy SEO, ever.** Every AI
action is explainable, and high-impact changes require human approval before
they touch a live store. See `docs/` for the full safety model.

## Documentation

- [Architecture](docs/architecture.md) — packages, dependency rules, quality gates
- [Configuration](docs/configuration.md) — environment schema and validation
- [Crawler](docs/crawler.md) — crawl engine, robots/rate-limit safety, SEO checks
- [SEO Engine](docs/seo-engine.md) — deterministic, evidence-backed recommendations
- [Knowledge Graph](docs/knowledge-graph.md) — canonical relationship layer and queries
- [Database](docs/database.md) — Prisma schema, repositories, migration workflow
- [Events](docs/events.md) — transactional outbox event bus
- [Logging](docs/logging.md) — structured pino logging and error serialization
- [Security](docs/security.md) — encryption, sanitization, auditability
