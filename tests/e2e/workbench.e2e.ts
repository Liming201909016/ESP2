import { expect, test } from "@playwright/test";
import { governanceSkills } from "../../src/lib/esp/governance-contracts";
import { createSecurityReview, decideSecurityReview } from "../../src/lib/esp/security-review";
import { getSkillCatalog } from "../../src/lib/esp/skill-catalog";

test("persists locale and opens the security review workspace", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Capability Workbench" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open software review", exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Example request" })
    .selectOption({ label: "Company leave and attendance policy" });
  await expect(page.getByRole("textbox", { name: "Enterprise request" })).toHaveValue(
    "Company leave and attendance policy",
  );
  expect(posts).toEqual([]);
  await expect(page.getByRole("button", { name: "Process request", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption("zh-CN");
  await expect(page.getByRole("heading", { level: 1, name: "技能编排工作台" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("combobox", { name: "语言" })).toHaveValue("zh-CN");
  await page.getByRole("button", { name: "软件引入审查", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "软件引入安全审查" })).toBeVisible();
  expect(posts).toEqual([]);
});

test("synthetic governance results fit desktop and mobile without replaying calls", async ({ page }, testInfo) => {
  const provenance = {
    repositoryId: "esp",
    mode: "packaged_snapshot",
    sourceCommit: "a".repeat(40),
    dirtyWorktree: true,
    collectedAt: "2026-09-16T00:00:00.000Z",
    inputDigest: "b".repeat(64),
  };
  let calls = 0;
  await page.route("**/api/governance", async (route) => {
    if (route.request().method() === "POST") {
      calls += 1;
      await route.fulfill({
        json: {
          repositoryId: "esp",
          skillId: "get-repository-validation-plan",
          tool: "esp_validation_plan",
          provenance,
          result: {
            schemaVersion: 1,
            mutatesRepository: false,
            commands: ["npm run data:check", "npm test -- --maxWorkers=2", "npm run format:check"],
          },
          audit: {
            id: `aud-8210000000000-${"a".repeat(32)}`,
            requestId: "11111111-1111-4111-8111-111111111111",
            traceId: "22222222-2222-4222-8222-222222222222",
            status: "recorded",
          },
        },
      });
    } else
      await route.fulfill({
        json: {
          skills: governanceSkills.map(({ id, version }) => ({
            id,
            version,
            permission: "governance.read",
            effect: "read",
            mode: "packaged_snapshot",
          })),
          packageStatus: "manifest_verified",
          provenance,
        },
      });
  });
  await page.route("**/api/audit**", (route) =>
    route.fulfill({ status: 503, json: { error: "SYNTHETIC_AUDIT_UNAVAILABLE" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Skill Catalog", exact: true }).first().click();
  await page.getByRole("tab", { name: "Repository governance (2)" }).click();
  await page.getByRole("button", { name: "Run Skill: Get repository validation plan" }).click();
  await expect(page.getByRole("heading", { name: "Validation plan · Commands not executed" })).toBeVisible();
  await page.getByRole("button", { name: "View audit", exact: true }).click();
  await page.getByRole("button", { name: "Return to · Skill Catalog", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Repository governance (2)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Validation plan · Commands not executed" })).toBeVisible();
  for (const locale of ["en-US", "zh-CN"]) {
    await page.locator(".locale-selector select").selectOption(locale);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".governance-result")).toContainText("npm test -- --maxWorkers=2");
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.right > innerWidth + 1 && getComputedStyle(element).visibility !== "hidden";
          })
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            right: element.getBoundingClientRect().right,
          })),
      );
      await page.screenshot({ path: testInfo.outputPath(`governance-${locale}-${width}.png`), fullPage: true });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        JSON.stringify({ width, locale, overflow }),
      ).toBe(true);
      for (const button of await page.locator(".governance-tools button").all()) {
        const box = await button.boundingBox();
        expect(box?.width).toBe(36);
        expect(box?.height).toBe(36);
      }
    }
  }
  expect(calls).toBe(1);
});

test("retains review drafts and linked materials across navigation without submitting", async ({ page }) => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const pending = createSecurityReview(
    {
      id: `sr-${"a".repeat(32)}`,
      submissionId: requestId,
      caseId: "missing",
      query: "Security review of Docker Desktop",
    },
    "synthetic:demo",
    requestId,
  );
  const prior = decideSecurityReview(
    { ...pending, id: `sr-${"b".repeat(32)}` },
    "request_information",
    "Please provide data scope evidence.",
    "synthetic:demo",
    requestId,
  );
  const entries = [pending, prior].map((record) => ({ record, etag: `etag-${record.id}` }));
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.route("**/api/security-reviews**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fulfill({ status: 409, json: { error: "REVIEW_CONFLICT" } });
    return route.fulfill({
      json: url.searchParams.has("catalog")
        ? { backend: "blob" }
        : url.searchParams.has("id")
          ? entries.find((entry) => entry.record.id === url.searchParams.get("id"))
          : { records: entries, nextCursor: null },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open software review", exact: true }).click();
  await page.locator(".security-review-list button").filter({ hasText: pending.id }).click();
  const reason = page.locator("#security-reason");
  await reason.fill("Synthetic reason retained across menus");
  const navigate = (name: string) =>
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
  await navigate("Workbench");
  await expect(page.getByRole("heading", { name: "Software Security Review", exact: true })).toBeHidden();
  await navigate("Software Review");
  await expect(reason).toHaveValue("Synthetic reason retained across menus");
  await expect(page.getByRole("button", { name: "Approve synthetic review", exact: true })).toBeDisabled();
  await page.locator(".security-review-list button").filter({ hasText: prior.id }).click();
  await page.getByRole("button", { name: "Prepare linked follow-up review", exact: true }).click();
  await expect(page.locator("#security-case")).toBeFocused();
  await expect(page.locator("#security-case")).toBeInViewport();
  await expect(page.locator("#security-case")).toHaveValue("complete");
  await expect(page.locator(".security-review-request")).toContainText(prior.id);
  await navigate("Workbench");
  await navigate("Software Review");
  await expect(page.locator("#security-case")).toHaveValue("complete");
  await expect(page.locator(".security-review-request")).toContainText(prior.id);
  await expect(page.getByRole("button", { name: "Confirm synthetic review", exact: true })).toBeVisible();
  expect(posts).toEqual([]);
  await navigate("Workbench");
  await page.getByRole("button", { name: "Open software review", exact: true }).click();
  await expect(page.locator("#security-case")).toHaveValue("missing");
  await expect(page.locator(".security-review-request")).not.toContainText(prior.id);
  await expect(page.getByRole("button", { name: "Confirm synthetic review", exact: true })).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("demo entry and bound Skill labels remain clear in both languages", async ({ page }, testInfo) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.route("**/api/skills", (route) =>
    route.fulfill({
      json: {
        skills: getSkillCatalog(["knowledge.read", "tickets.read", "tickets.create"]),
        generatedAt: "2026-09-17T00:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/governance", (route) =>
    route.fulfill({ status: 403, json: { error: "PERMISSION_REQUIRED" } }),
  );
  await page.route("**/api/security-reviews**", (route) =>
    route.fulfill({
      json: route.request().url().includes("catalog=true") ? { backend: "memory" } : { records: [], nextCursor: null },
    }),
  );
  await page.goto("/");
  for (const [locale, demoName, openName, catalogName, boundLabel] of [
    ["en-US", "Demo Center", "Open software review", "Skill Catalog", "Implementation bound"],
    ["zh-CN", "演示中心", "进入软件审查", "技能目录", "实现已绑定"],
  ]) {
    await page.locator(".locale-selector select").selectOption(locale);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator(".workspace-menu").evaluate((element) => {
        (element as HTMLDetailsElement).open = true;
      });
      await page.locator(".sidebar nav").getByRole("button", { name: demoName, exact: true }).click();
      await expect(page.locator(".featured-review")).toContainText("SIM-SW-202609-0031");
      await expect(page.locator(".review-milestones li")).toHaveCount(5);
      const caseList = page.locator(".case-table-wrap");
      await caseList.focus();
      await caseList.press("End");
      await expect.poll(() => caseList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await caseList.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(560);
      await caseList.press("Home");
      await expect.poll(() => caseList.evaluate((element) => element.scrollTop)).toBe(0);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`demo-${locale}-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: openName, exact: true }).click();
      await expect(page.locator("#security-case")).toHaveValue("missing");
      await page.locator(".sidebar nav").getByRole("button", { name: catalogName, exact: true }).click();
      await expect(page.locator(".catalog-table-wrap")).toContainText(boundLabel);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`catalog-${locale}-${width}.png`), fullPage: true });
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll("main *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.right > innerWidth + 1;
          })
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            right: element.getBoundingClientRect().right,
          })),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        JSON.stringify({ locale, width, overflow }),
      ).toBe(true);
    }
  }
  expect(posts).toEqual([]);
});
