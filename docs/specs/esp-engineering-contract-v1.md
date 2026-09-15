# ESP Engineering Contract v1

**Status:** Active for the current internal hackathon prototype.

This versioned contract defines engineering invariants shared across ESP capabilities. It is not an external product
API or a promise of production support.

## Stable invariants

1. External inputs and persisted records are validated by strict Zod contracts before use.
2. Permissions are checked before an adapter, model, or persistence mutation is invoked.
3. Mutations require a durable audit start. Audit finalization failure must not rewrite the observed business outcome.
4. Write operations preserve explicit confirmation, approval, idempotency, ETag, and unknown-outcome boundaries.
5. Source excerpts remain exact and versioned. Model output is untrusted until citation, deterministic, and configured
   semantic checks pass.
6. Public failures use bounded codes and metadata. Provider messages, credentials, source bodies, and unreviewed drafts
   are not returned or logged.
7. Repository fixtures and evaluations use synthetic data. Cloud and live-model effects require explicit authorization.

## Change protocol

- Contract changes update the owning schema, producer, consumer, and discriminating tests together.
- Persisted schema changes require compatibility and rollback analysis before migration is authorized.
- A new write path documents confirmation, idempotency, audit ordering, retry policy, and uncertain-commit behavior.
- Evidence changes preserve canonical source identity and add rejection tests for unsupported claims.
- Breaking changes require a new contract version and an explicit migration or coexistence plan; do not silently redefine
  v1 behavior.

## Validation contract

Repository-wide changes run:

```powershell
npm run data:check
npm run docs:check
npm test
npm run lint
npm run format:check
npm run build
npm run test:e2e
```

Passing checks are necessary but do not authorize deployment, infrastructure changes, data migration, or live-model
evaluation.
