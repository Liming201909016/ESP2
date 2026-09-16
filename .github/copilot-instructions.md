# ESP Copilot Instructions

Follow [AGENTS.md](../AGENTS.md) for repository-wide architecture, safety, editing, and validation rules.

- Keep transport and presentation in `src/app`; keep permission, confirmation, evidence, audit, and persistence rules in `src/lib/esp`.
- Preserve exact evidence excerpts, stable identifiers, Zod validation, audit-before-mutation, and explicit human confirmation or approval.
- Use synthetic data only. Do not deploy, migrate, change cloud or identity configuration, or invoke live models without explicit authorization.
- Add a discriminating test beside the owning module. Run the narrowest relevant check first, then the documented repository validation sequence for broad changes.
