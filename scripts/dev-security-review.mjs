import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], {
  stdio: "inherit",
  env: { ...process.env, ESP_ENVIRONMENT: "dev", ESP_DEV_AUTH_BYPASS: "true", ESP_DEV_PERMISSIONS: "knowledge.read,tickets.read,tickets.create", ESP_SECURITY_REVIEW_STORE: "memory", ESP_STATE_BACKEND: "blob", ESP_STATE_WRITES_PAUSED: "false", ESP_KNOWLEDGE_SEED: "", ESP_STATE_MIGRATE: "", ESP_FINANCE_KNOWLEDGE_BOOTSTRAP: "" },
});
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });