# Contributing to ESP

## Development setup

ESP uses Node.js 24 and npm. The required major version is recorded in `.nvmrc` and `package.json`. Install the locked
dependencies before running the application:

```powershell
npm run setup
npm run dev
```

VS Code users may instead reopen the repository in the provided Node 24 devcontainer; its post-create command runs
`setup.sh`, which delegates to the same Node setup implementation. The container does not provision cloud services or
credentials.

Copy `.env.example` to a local environment file only when a task needs runtime integrations. Never commit credentials or local environment files.

## Validation

Run the repository checks that apply to the change. The complete local gate is:

```powershell
npm run data:check
npm run docs:check
npm test
npm run lint
npm run format:check
npm run build
npm run test:e2e
```

The end-to-end test runs against the production build. Install Chromium once with
`npx playwright install chromium`, and run `npm run build` before `npm run test:e2e` locally.

The formatter gate currently covers shared configuration, governance documents, and workflows. Existing application and
script formatting debt should be normalized in focused changes before those paths are added to the gate.

Tests should demonstrate the changed behavior and a meaningful failure case. Do not weaken factual, permission, audit, or confirmation checks to make a test pass.

The optional Lefthook pre-commit hook runs `npm run check:fast`. It checks lint and the bounded formatter scope without
modifying files. Run `npm run hooks:install` once per clone to enable it.

## Pull requests

- Keep changes focused and describe their user-visible or operational effect.
- Record the commands run and any skipped checks in the pull request.
- Identify security, data, permission, migration, and rollback implications.
- Disclose AI-agent contributions and review their changes and evidence before approval.
- Record the maintainer's self-review of the exact head commit before merging; do not present it as independent approval.

`.github/branch-protection.yml` records the active default-branch contract. Ruleset `23527101` requires pull requests,
resolved review threads, validation, security, and closed-loop remediation proof checks. The public repository
exposes server-side enforcement to API verification; no configured actor can bypass the active ruleset.

### Single-maintainer Hackathon mode

On September 16, 2026, the project owner explicitly authorized **single-maintainer Hackathon governance** because
`Liming201909016` is the only maintainer. Required approving reviews are **0** and required CODEOWNER approval is
**disabled**. `CODEOWNERS` remains an ownership record, not an independent-review guarantee. This is a standing,
documented project mode, not a temporary bypass to merge a particular PR. It weakens independent review and may affect
external readiness assessments; no unchanged evaluation score or production suitability is claimed.

GitHub continues to enforce PR-based changes, resolution of review discussions, all six required status checks,
up-to-date branch checks, prevention of force pushes and branch deletion, and an empty bypass list. Copilot review
remains enabled but does not replace a human's judgment. An author may merge their own PR only once the applicable
server-side gates are satisfied; closing a discussion without addressing the issue is not an acceptable substitute.

Before merging, the maintainer must leave a self-review record naming the reviewed head SHA, validation and security
results, disposition of review findings, and rollback or residual risks. This is a process obligation, not a new
GitHub-enforced approval check. AI assistance must be disclosed and must not submit an approval or self-review on the
maintainer's behalf. Pending PRs still need this review; the policy change does not approve, merge or resolve them.

Review this mode after the hackathon, when another qualified maintainer joins, or before production adoption. Restoring
independent review requires a separately reviewed policy update: add eligible ownership, restore at least one approval
and required CODEOWNER review, and verify the live ruleset. There is no automatic expiry or silent toggle-back.

Agent policy exceptions use the `Agent policy exception` issue form. A request must name an owner, exact scope, UTC
expiry, justification, compensating controls, and rollback proof. It remains inactive until a CODEOWNER approves it and
fails closed at expiry; exceptions never authorize deployment, identity, migration, cloud, or production data changes.

Cloud deployments, infrastructure changes, identity changes, data migrations, and live model evaluations require explicit approval. A merged source change does not by itself authorize those operations.
