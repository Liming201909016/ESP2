import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { prepareHackathonDemo } from "./prepare-hackathon-demo.mjs";
import { readReviewEvidence, reviewCases, securityReviewSchema } from "../src/lib/esp/security-review";

it("prepares all exact synthetic cases without network, human decisions or overwriting evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "esp-demo-pack-"));
  const destination = join(temporary, "pack");
  const network = vi.fn(() => {
    throw new Error("NETWORK_NOT_ALLOWED");
  });
  vi.stubGlobal("fetch", network);
  try {
    const manifest = await prepareHackathonDemo(destination);
    expect(manifest).toMatchObject({
      mode: "offline-rehearsal",
      auditPersisted: false,
      cloudRecordsCreated: false,
      humanDecisionsCreated: false,
      modelInvoked: false,
    });
    expect(manifest.cases).toHaveLength(4);
    for (const scenario of reviewCases) {
      const { record: input } = JSON.parse(await readFile(join(destination, `${scenario.id}.json`), "utf8"));
      const record = securityReviewSchema.parse(input);
      expect(manifest.cases).toContainEqual(expect.objectContaining({ caseId: scenario.id, recordId: record.id }));
      expect(record.evidence).toEqual(readReviewEvidence(record.caseId));
      expect(record.status).toBe("awaiting_decision");
      expect(record.history).toHaveLength(1);
      expect(record.evaluation.humanDecisionRequired).toBe(true);
      expect(record.evaluation.controlsPassed).toBe(record.caseId === "complete");
      for (const locale of ["en-US", "zh-CN"]) {
        const html = await readFile(join(destination, `${scenario.id}.${locale}.html`), "utf8");
        expect(html).toContain("OFFLINE REHEARSAL");
        expect(html).not.toContain("/api/");
        expect(html).toContain(`${scenario.id}.json`);
        for (const evidence of record.evidence) expect(html).toContain(evidence.excerpt);
      }
    }
    for (const [name, hash] of Object.entries(manifest.files)) {
      expect(
        createHash("sha256")
          .update(await readFile(join(destination, name)))
          .digest("hex"),
      ).toBe(hash);
    }
    await expect(prepareHackathonDemo(destination)).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"))).toEqual(manifest);
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    await rm(temporary, { recursive: true, force: true });
  }
});
