<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ESP Project Guidelines

## Architecture

- Treat `src/app` as transport and presentation; keep permission, confirmation, evidence, audit, and persistence rules in `src/lib/esp`.
- Preserve stable IDs, exact source excerpts, Zod contract validation, audit-before-mutation, and explicit confirmation or approval boundaries.
- Use synthetic data only. Cloud, identity, infrastructure, migration, deployment, and live-model operations require explicit authorization.
- See `docs/architecture.md` and `CONTRIBUTING.md` for boundaries and validation.

## Validation

- Add or update a discriminating test beside the owning module or route.
- Run the narrowest relevant test first, then `npm run data:check`, `npm run docs:check`, `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` before declaring a repository-wide change complete.
- Do not weaken factual, permission, audit, confirmation, or idempotency checks to make tests pass.
