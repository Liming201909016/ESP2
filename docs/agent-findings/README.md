# Agent Findings Ledger

The ledger records human-reviewed findings from read-only Agent Review artifacts. A model report is advisory and never
changes this file automatically.

## Lifecycle

1. Run the manual Agent Review workflow for an exact commit SHA or same-repository pull request.
2. Download its JSON and Markdown artifacts and verify the target, diff, prompt, agent configuration, model, and CLI
   digests.
3. A human rejects the candidate, accepts it with an owner, or adds a new occurrence to an existing fingerprint through
   a pull request.
4. Resolve an accepted finding only with a commit, named checks, and existing regression-test paths.
5. Promote a recurring risk class into a test, lint rule, contract, or instruction only from multiple resolved findings
   with existing proof tests.
6. Risk acceptance requires an owner, reason, and expiration after the most recent occurrence.

IDs use `ESP-AF-NNNN`. `nextSequence` must exceed every assigned ID. Fingerprints and evidence digests are lowercase
SHA-256 values; they establish stable identity and integrity, not correctness. Run `npm run agent-findings:check` before
submitting changes.

## Learned Controls

[`learned-rules.json`](learned-rules.json) is the governed learned-rule corpus. Rules move through explicit `candidate`,
`active`, and `retired` states. Activation requires at least two distinct resolved source findings, an owner, a
semantic control version, an existing control path, existing regression-test paths, and promotion/verification
timestamps after the source evidence. Retirement records its timestamp and optional successor; source findings cannot
be assigned to more than one learned rule.

The current corpus contains one candidate, three active controls, and one retired control with an active successor. Its
29 covered findings include least-privilege agentic workflows, immutable isolated SDK provenance, findings claims bound
to current proof, and the superseded terminal-action control. The deterministic
[`candidate-active-retired-proof-pairs.json`](../../dashboards/candidate-active-retired-proof-pairs.json) dashboard
reports lifecycle counts, verified finding-to-control proof pairs, source coverage, and every uncovered finding.
The current learned-rule corpus and dashboard use **schemaVersion 2**. The validator also accepts the original v1 corpus
with `promotedAt` and its v1 dashboard without proof-pair fields, preserving its historical validation semantics without
rewriting it. V1 and v2 inputs cannot be mixed or relabelled; new lifecycle records use `proposedAt` and `activatedAt`.
No persisted historical ledger is migrated. The v2 dashboard lists each structural proof binding: finding ID, rule ID,
control path/version, shared regression-test path and recorded proof commit. The test must be named by both the finding
and the rule and directly import that control. Merely being resolved does not count as a proof pair. The current fixture
has 29 covered findings, **26 structurally bound pairs and 2 fully bound active rules**; remaining coverage is not claimed
as verified. Import/path checks establish traceable structure, not test execution or semantic correctness. Historical v1
dashboards retain their old meaning and must not be described as v2 proof verification.
`npm run agent-improvement:check` recomputes these metrics and blocks pull requests when
promotion evidence, controls, tests, lifecycle ordering, or dashboard values drift.

The weekly `Agent Findings Audit` consumes the ledger, learned rules, dashboard, source findings, and referenced proof.
It emits a read-only discrepancy report; a human still decides every corpus or ledger change. This forms a governed
finding-to-proof-to-control feedback loop without granting an agent repository write permission.

The ledger contains no source bodies, model prompts, credentials, or raw provider errors. It is engineering evidence,
not an authorization record or production vulnerability database.

## Review Workflow

`Agent Review` is manually dispatched with either a full commit SHA or a same-repository pull request number. It checks
out the reviewer contract from the trusted default branch separately from the target. Target code is never executed, its
instructions are disabled, and Copilot can use only the `view`, `rg`, and `glob` tools. Commit reviews compare the exact
commit with its first parent; pull request reviews compare the recorded base and head SHAs.

The workflow rejects empty, oversized, or greater-than-100-file diffs. Its validated artifact records the target, changed
files, diff digest, prompt digest, reviewer configuration digest, fixed model and CLI versions, model event-stream and
usage digests, findings, open questions, and residual risks. Raw event streams and diffs are not uploaded. Every artifact
requires human review before a ledger PR.
