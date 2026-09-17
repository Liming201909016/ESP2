import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";

export async function prepareHackathonDemo(directory) {
  const destination = resolve(directory);
  await mkdir(destination, { recursive: false });
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      contents:
        'export { createSecurityReview, reviewCases } from "./src/lib/esp/security-review.ts"; export { renderSecurityReportHtml } from "./src/lib/esp/security-review-report.ts";',
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const domain = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  const generatedAt = new Date();
  const manifest = {
    schemaVersion: 1,
    mode: "offline-rehearsal",
    generatedAt: generatedAt.toISOString(),
    cloudRecordsCreated: false,
    auditPersisted: false,
    humanDecisionsCreated: false,
    modelInvoked: false,
    cases: [],
    files: {},
  };
  async function save(name, content) {
    await writeFile(resolve(destination, name), content, { flag: "wx" });
    manifest.files[name] = createHash("sha256").update(content).digest("hex");
  }
  for (const scenario of domain.reviewCases) {
    const requestId = randomUUID();
    const record = domain.createSecurityReview(
      {
        id: `sr-${randomUUID().replaceAll("-", "")}`,
        submissionId: requestId,
        caseId: scenario.id,
        query: "Security review of Docker Desktop",
      },
      "synthetic:offline-rehearsal",
      requestId,
      generatedAt,
    );
    await save(
      `${scenario.id}.json`,
      `${JSON.stringify({ mode: manifest.mode, auditPersisted: false, record }, null, 2)}\n`,
    );
    for (const locale of ["en-US", "zh-CN"]) {
      const window = new Window();
      try {
        const document = new window.DOMParser().parseFromString(
          domain.renderSecurityReportHtml(record, locale, "memory"),
          "text/html",
        );
        const notice = document.createElement("p");
        notice.className = "warning";
        notice.textContent =
          locale === "en-US"
            ? "OFFLINE REHEARSAL ONLY. Synthetic records; no server storage, audit receipt or human approval. This is not a live run."
            : "OFFLINE REHEARSAL · 仅离线预演。合成记录，未写入服务器，无持久化审计回执或人工批准，不是现场执行结果。";
        document.querySelector("header").prepend(notice);
        const navigation = document.querySelector("nav");
        navigation.replaceChildren();
        for (const [label, href] of [
          ["English", `${scenario.id}.en-US.html`],
          ["中文", `${scenario.id}.zh-CN.html`],
          ["JSON", `${scenario.id}.json`],
        ]) {
          const link = document.createElement("a");
          link.textContent = label;
          link.href = href;
          navigation.append(link);
        }
        await save(`${scenario.id}.${locale}.html`, `<!doctype html>\n${document.documentElement.outerHTML}\n`);
      } finally {
        await window.happyDOM.close();
      }
    }
    manifest.cases.push({
      caseId: scenario.id,
      recordId: record.id,
      status: record.status,
      controlsPassed: record.evaluation.controlsPassed,
      findings: record.findings.map(({ controlId, status }) => ({ controlId, status })),
    });
  }
  await save(
    "README.md",
    "# ESP Offline Rehearsal\n\nSynthetic materials only. No cloud records, persisted audit or human decisions were created. These files are not live acceptance evidence.\n\n" +
      manifest.cases
        .map(
          ({ caseId }) =>
            `- ${caseId}: [English](${caseId}.en-US.html) | [Chinese](${caseId}.zh-CN.html) | [JSON](${caseId}.json)`,
        )
        .join("\n") +
      "\n\nUse Security Review in the app to select the matching fixed material case. Do not import these local record IDs as server IDs. Follow HACKATHON-DEMO.md for the talk and operator checklist.\n",
  );
  await writeFile(resolve(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error("Usage: node scripts/prepare-hackathon-demo.mjs <new-output-directory>");
  const manifest = await prepareHackathonDemo(process.argv[2]);
  console.log(
    JSON.stringify({
      directory: resolve(process.argv[2]),
      mode: manifest.mode,
      cases: manifest.cases.length,
      files: Object.keys(manifest.files).length,
    }),
  );
}
