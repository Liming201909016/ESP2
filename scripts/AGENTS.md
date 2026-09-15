# ESP Script Guidance

- Evaluators are bounded evidence tools: default to read-only behavior and require explicit flags for writes or live model calls.
- Reserve report paths before external effects and write reports create-only. Never retry an ambiguous external operation because an output file is absent.
- Packaging and deployment must preserve provenance, verify immutable artifacts, and fail closed on unknown deployment outcomes.
- Do not add automatic cloud activation, schedules, migrations, seeds, or deployment flags without explicit authorization.
