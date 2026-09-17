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
npm run docs:drift
npm run agent-findings:check
npm run agent-improvement:check
npm run remediation:check
npm test
npm run lint
npm run format:check
npm run build
npm run test:e2e
```

The end-to-end test runs against the production build. Install Chromium once with
`npx playwright install chromium`, and run `npm run build` before `npm run test:e2e` locally.

The ordered command list is maintained in [the documentation contract](scripts/repository-docs-contract.mjs) and
checked against this guide, the architecture guide and the engineering contract. Workflow changes additionally require
`npm run agentic-workflows:check` and the pinned strict gh-aw compilation used by CI; infrastructure validation follows
[Validate](.github/workflows/validate.yml) without deploying resources.

`npm run docs:check` discovers all Git-tracked and non-ignored untracked Markdown/MDX files, including new directories,
agent entrypoints and workflow descriptions. It parses local Markdown links and images, including reference-style links,
and checks their targets, npm script names, required entrypoints
and the ordered validation guides. Deleted optional documents are excluded, but references to them still fail. Ignored
local artifact links are counted separately and are not evidence of fresh-checkout or public availability. External URLs
and heading fragments are not fetched or verified by this check.

`npm run docs:drift` checks explicit source-to-documentation behavior contracts, including current-section boundaries
for capability and API guarantees so historical prose cannot satisfy them. These deterministic checks block PRs
when covered claims drift; they are not a semantic review of every sentence or proof of current cloud configuration.
Describe current code, last verified deployment and dated evaluation results separately. Retain historical failures,
source revisions, dirty-worktree disclosures and model-panel qualifications instead of rewriting old results.

The formatter gate currently covers shared configuration, governance documents, and workflows. Existing application and
script formatting debt should be normalized in focused changes before those paths are added to the gate.

Tests should demonstrate the changed behavior and a meaningful failure case. Do not weaken factual, permission, audit, or confirmation checks to make a test pass.

`npm run setup` installs the Lefthook pre-commit hook, which runs `npm run check:fast` to check lint and the bounded
formatter scope without modifying files. To install or reinstall the hook separately, run `npm run hooks:install`.

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
expiry, justification, compensating controls, and rollback proof. The read-only audit marks well-formed requests with
verified approval `active` only before expiry; these classifications neither grant nor revoke runtime authorization.
Exceptions never authorize deployment, identity, migration, cloud, or production data changes.

Exception approval requires both the `exception-approved` label and an unedited comment from an individual default
CODEOWNER: `/approve-agent-exception sha256:<approvalDigest>`. The collector computes `approvalDigest` over the issue
number, URL and exact body. The maintainer must review that body before posting the command; agents must not approve
on their behalf. Any body change invalidates the old approval. A later matching `/revoke-agent-exception sha256:<approvalDigest>`
comment or removal of the label makes the request pending again. Labels alone never prove approval. Comments from bots,
non-CODEOWNERS, edited comments and future-dated comments are rejected. The current collector supports explicit individual
default `*` owners; team ownership fails closed until supported. Expired and malformed requests require new human review.
The default-branch workflow collects all issue pages and comment pages, including requests with the issue-form title but
missing labels. It is read-only and does not provision labels or activate exceptions in any execution engine.

Cloud deployments, infrastructure changes, identity changes, data migrations, and live model evaluations require explicit approval. A merged source change does not by itself authorize those operations.
