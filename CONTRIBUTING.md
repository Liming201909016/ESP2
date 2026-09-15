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
- Obtain the review requested by `CODEOWNERS`.

Cloud deployments, infrastructure changes, identity changes, data migrations, and live model evaluations require explicit approval. A merged source change does not by itself authorize those operations.
