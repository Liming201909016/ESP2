import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deployWithRollback, releaseMarkerSchema, ReleaseError, requireRelease } from "./release-contract.mjs";
import { verifyReleaseBundle } from "./release-package.mjs";

export const devTarget = Object.freeze({
  subscription: "1a55f4f7-6677-4773-8ba8-2cc1c46cb083",
  resourceGroup: "ESP",
  name: "app-esp-dev-ygxkqw7r",
  origin: "https://app-esp-dev-ygxkqw7r.azurewebsites.net",
});

export function assertRuntime(snapshot, expected) {
  const marker = releaseMarkerSchema.parse(snapshot.release);
  requireRelease(
    JSON.stringify(marker) === JSON.stringify(releaseMarkerSchema.parse(expected)),
    "RUNNING_RELEASE_MISMATCH",
  );
  requireRelease(snapshot.health?.status === "healthy" && snapshot.health.ready === true, "APPLICATION_NOT_HEALTHY");
  requireRelease(
    snapshot.health.state?.backend === "postgres" && snapshot.health.state.writesPaused === false,
    "APPLICATION_STATE_MODE_CHANGED",
  );
  requireRelease(
    snapshot.readiness?.status === "ready" &&
      ["blob", "search", "state"].every((name) => snapshot.readiness.checks?.[name]?.status === "healthy"),
    "DEPENDENCIES_NOT_READY",
  );
  requireRelease(
    snapshot.state?.backend === "postgres" &&
      snapshot.state.writesPaused === false &&
      snapshot.state.postgres?.prepared === true &&
      snapshot.state.postgres.schemaVersion === expected.stateSchemaVersion,
    "DATABASE_NOT_PREPARED",
  );
  const sources = snapshot.catalog?.skills?.flatMap((skill) => skill.sources ?? []);
  requireRelease(
    Array.isArray(sources) &&
      sources.length > 0 &&
      sources.every((source) => source.version === expected.knowledgeVersion),
    "RUNNING_KNOWLEDGE_VERSION_MISMATCH",
  );
}

async function azure(args) {
  try {
    const { stdout } = await promisify(execFile)(
      "az",
      [...args, "--subscription", devTarget.subscription, "--only-show-errors", "--output", "json"],
      { timeout: 900_000, maxBuffer: 2_000_000 },
    );
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch {
    throw new ReleaseError("AZURE_COMMAND_FAILED");
  }
}

async function api(path, timeoutMs = 45_000, body) {
  try {
    const response = await fetch(`${devTarget.origin}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    requireRelease(
      response.status === 200,
      path.startsWith("/api/release") ? "CURRENT_RELEASE_UNTRACKED" : "RUNTIME_CHECK_FAILED",
    );
    return await response.json();
  } catch (failure) {
    throw failure instanceof ReleaseError ? failure : new ReleaseError("RUNTIME_REQUEST_FAILED");
  }
}

async function runtimeSnapshot() {
  const health = await api("/api/health", 180_000);
  const release = await api(`/api/release?check=${Date.now()}`);
  const readiness = await api("/api/readiness");
  const state = await api("/api/state");
  const catalog = await api("/api/skills");
  return { release, health, readiness, state, catalog };
}

export function createAzureReleaseDriver(bundles) {
  requireRelease(
    process.platform === "linux" &&
      process.env.GITHUB_ACTIONS === "true" &&
      process.env.ESP_DEV_DEPLOY_ENABLED === "true",
    "LIVE_DEPLOYMENT_NOT_ENABLED",
  );
  const argumentsForApp = ["--resource-group", devTarget.resourceGroup, "--name", devTarget.name];
  return {
    async inspect() {
      const site = await azure([
        "webapp",
        "show",
        ...argumentsForApp,
        "--query",
        "{name:name,state:state,host:defaultHostName,httpsOnly:httpsOnly}",
      ]);
      requireRelease(
        site.name === devTarget.name &&
          site.host === `${devTarget.name}.azurewebsites.net` &&
          site.state === "Running" &&
          site.httpsOnly === true,
        "UNEXPECTED_DEPLOYMENT_TARGET_STATE",
      );
      const settings = await azure([
        "webapp",
        "config",
        "appsettings",
        "list",
        ...argumentsForApp,
        "--query",
        "[?name=='ESP_ENVIRONMENT' || name=='ESP_DEV_AUTH_BYPASS' || name=='ESP_STATE_BACKEND' || name=='ESP_STATE_WRITES_PAUSED' || name=='ESP_STATE_MIGRATE' || name=='ESP_KNOWLEDGE_SEED'].{name:name,value:value}",
      ]);
      const configuration = Object.fromEntries(settings.map((setting) => [setting.name, setting.value]));
      requireRelease(
        configuration.ESP_ENVIRONMENT === "dev" &&
          configuration.ESP_DEV_AUTH_BYPASS === "true" &&
          configuration.ESP_STATE_BACKEND === "postgres",
        "UNEXPECTED_DEV_CONFIGURATION",
      );
      const snapshot = await runtimeSnapshot();
      assertRuntime(snapshot, snapshot.release);
      return {
        release: snapshot.release,
        state: {
          backend: snapshot.state.backend,
          prepared: snapshot.state.postgres.prepared,
          schemaVersion: snapshot.state.postgres.schemaVersion,
          writesPaused: snapshot.state.writesPaused || configuration.ESP_STATE_WRITES_PAUSED === "true",
          migrationEnabled: Boolean(configuration.ESP_STATE_MIGRATE),
          knowledgeSeedEnabled: configuration.ESP_KNOWLEDGE_SEED === "true",
        },
      };
    },
    async stop() {
      await azure(["webapp", "stop", ...argumentsForApp]);
      const state = await azure(["webapp", "show", ...argumentsForApp, "--query", "state"]);
      requireRelease(state === "Stopped", "APPLICATION_STOP_NOT_CONFIRMED");
    },
    async deploy(release) {
      const directory = bundles.get(release.releaseId);
      requireRelease(Boolean(directory), "RELEASE_BUNDLE_MISSING");
      const manifest = await verifyReleaseBundle(directory);
      requireRelease(JSON.stringify(manifest.release) === JSON.stringify(release), "RELEASE_BUNDLE_CHANGED");
      let result;
      try {
        result = await azure([
          "webapp",
          "deploy",
          ...argumentsForApp,
          "--src-path",
          join(directory, "release.zip"),
          "--type",
          "zip",
          "--clean",
          "false",
          "--restart",
          "false",
          "--track-status",
          "false",
          "--async",
          "false",
          "--timeout",
          "600000",
          "--query",
          "{id:id,status:status,active:active,complete:complete}",
        ]);
      } catch {
        throw new ReleaseError("DEPLOYMENT_RESULT_UNKNOWN");
      }
      if (result?.status === 3 && result.complete === true) throw new ReleaseError("DEPLOYMENT_FAILED");
      requireRelease(
        result?.status === 4 && result.complete === true && result.active === true,
        "DEPLOYMENT_RESULT_UNKNOWN",
      );
    },
    async start() {
      await azure(["webapp", "start", ...argumentsForApp]);
    },
    async verify(release) {
      assertRuntime(await runtimeSnapshot(), release);
      const trial = await api("/api/plugins/tickets/trial", 65_000, {
        operationId: "tickets.get",
        skillId: "get-ticket-status",
        input: { query: "Deployment verification: ticket status without an identifier" },
      });
      requireRelease(
        trial.mode === "live_read" &&
          trial.status === "needs_input" &&
          trial.execution?.type === "input_required" &&
          trial.audit?.status === "recorded",
        "OPERATIONAL_CHECK_FAILED",
      );
    },
  };
}

export function simulatedDriver(baseline, scenario = "success") {
  requireRelease(
    ["success", "candidate-unhealthy", "candidate-start-failure", "rollback-unhealthy", "deployment-unknown"].includes(
      scenario,
    ),
    "UNKNOWN_SIMULATION_SCENARIO",
  );
  let running = baseline;
  return {
    async inspect() {
      return {
        release: running,
        state: {
          backend: "postgres",
          prepared: true,
          schemaVersion: baseline.stateSchemaVersion,
          writesPaused: false,
          migrationEnabled: false,
          knowledgeSeedEnabled: false,
        },
      };
    },
    async stop() {},
    async deploy(release) {
      if (scenario === "deployment-unknown" && release.releaseId !== baseline.releaseId)
        throw new ReleaseError("DEPLOYMENT_RESULT_UNKNOWN");
      running = release;
    },
    async start() {
      if (scenario === "candidate-start-failure" && running.releaseId !== baseline.releaseId)
        throw new ReleaseError("SIMULATED_START_FAILURE");
    },
    async verify(release) {
      requireRelease(release.releaseId === running.releaseId, "SIMULATED_MARKER_MISMATCH");
      if (
        scenario === "rollback-unhealthy" ||
        (scenario === "candidate-unhealthy" && release.releaseId !== baseline.releaseId)
      )
        throw new ReleaseError("SIMULATED_UNHEALTHY_RELEASE");
    },
  };
}

async function main(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    requireRelease(
      ["--candidate", "--baseline", "--mode", "--scenario", "--report"].includes(args[index]) &&
        Boolean(args[index + 1]) &&
        !values.has(args[index]),
      "INVALID_RELEASE_ARGUMENTS",
    );
    values.set(args[index], args[index + 1]);
  }
  requireRelease(values.has("--candidate") && values.has("--baseline"), "RELEASE_BUNDLES_REQUIRED");
  const mode = values.get("--mode") ?? "simulate";
  requireRelease(["simulate", "execute"].includes(mode), "INVALID_RELEASE_MODE");
  requireRelease(mode !== "execute" || !values.has("--scenario"), "SIMULATION_FLAG_IN_LIVE_RELEASE");
  const candidateDirectory = resolve(values.get("--candidate"));
  const baselineDirectory = resolve(values.get("--baseline"));
  const candidate = await verifyReleaseBundle(candidateDirectory);
  const baseline = await verifyReleaseBundle(baselineDirectory);
  if (mode === "execute") {
    for (const [name, release] of [
      ["CANDIDATE", candidate.release],
      ["BASELINE", baseline.release],
    ]) {
      requireRelease(
        release.sourceCommit === process.env[`ESP_${name}_COMMIT`] &&
          release.buildRunId === process.env[`ESP_${name}_RUN_ID`],
        "ARTIFACT_PROVENANCE_MISMATCH",
      );
    }
  }
  const bundles = new Map([
    [candidate.release.releaseId, candidateDirectory],
    [baseline.release.releaseId, baselineDirectory],
  ]);
  const driver =
    mode === "simulate"
      ? simulatedDriver(baseline.release, values.get("--scenario"))
      : createAzureReleaseDriver(bundles);
  const result = await deployWithRollback({
    candidate: candidate.release,
    baseline: baseline.release,
    driver,
    simulation: mode === "simulate",
  });
  if (values.has("--report")) {
    const destination = resolve(values.get("--report"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  }
  console.log(JSON.stringify(result, null, 2));
  if (!["deployed", "unchanged"].includes(result.outcome)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((failure) => {
    console.error(
      JSON.stringify({ error: failure instanceof ReleaseError ? failure.code : "RELEASE_VALIDATION_FAILED" }),
    );
    process.exitCode = 1;
  });
}
