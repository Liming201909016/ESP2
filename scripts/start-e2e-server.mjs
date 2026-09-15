import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const standalone = resolve(root, ".next/standalone");
const staticSource = resolve(root, ".next/static");

assert.ok(existsSync(resolve(standalone, "server.js")), "Run npm run build before npm run test:e2e");
assert.ok(existsSync(staticSource), "Next.js static assets are missing");

mkdirSync(resolve(standalone, ".next"), { recursive: true });
cpSync(staticSource, resolve(standalone, ".next/static"), { recursive: true, force: true });

const publicSource = resolve(root, "public");
if (existsSync(publicSource)) cpSync(publicSource, resolve(standalone, "public"), { recursive: true, force: true });

await import("../.next/standalone/server.js");
