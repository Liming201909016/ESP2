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
5. Promote a finding into a test, lint rule, contract, or instruction only after at least two distinct occurrences.
6. Risk acceptance requires an owner, reason, and expiration after the most recent occurrence.

IDs use `ESP-AF-NNNN`. `nextSequence` must exceed every assigned ID. Fingerprints and evidence digests are lowercase
SHA-256 values; they establish stable identity and integrity, not correctness. Run `npm run agent-findings:check` before
submitting changes.

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
