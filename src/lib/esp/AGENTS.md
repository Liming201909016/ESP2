# ESP Domain Guidance

- This directory owns contracts, identity and permission checks, routing, execution, evidence validation, audit ordering, and persistence adapters.
- Add cross-boundary, side-effect-free exports through `index.ts`; keep internal adapters and persistence details on focused imports.
- Parse external values with the shared Zod contracts. Return bounded public error codes; do not expose provider messages, credentials, source bodies, or unreviewed model drafts.
- Mutations require a persisted audit start. Preserve unknown-outcome semantics and do not add automatic write retries.
- Keep model output untrusted until exact citations, deterministic checks, and the configured semantic review pass.
- Place focused tests beside the owning module and cover a meaningful rejection or failure path.
