// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GovernanceSkills } from "./governance-skills";
import { LocaleProvider, LanguageSelector } from "./locale-provider";
import { governanceSkills } from "../lib/esp/governance-contracts";
import { governanceText } from "../lib/esp/governance-locale";
import { SkillCatalogView } from "./skill-catalog";
import { getSkillCatalog } from "../lib/esp/skill-catalog";

const provenance = {
  repositoryId: "esp",
  mode: "packaged_snapshot",
  sourceCommit: "a".repeat(40),
  dirtyWorktree: false,
  collectedAt: "2026-09-16T00:00:00.000Z",
  inputDigest: "b".repeat(64),
};
const catalog = {
  skills: governanceSkills.map(({ id, version }) => ({
    id,
    version,
    permission: "governance.read",
    effect: "read",
    mode: "packaged_snapshot",
  })),
  packageStatus: "manifest_verified",
  provenance,
};
const audit = {
  id: `aud-8210559834539-${"a".repeat(32)}`,
  requestId: "11111111-1111-4111-8111-111111111111",
  traceId: "22222222-2222-4222-8222-222222222222",
  status: "recorded",
};
const result = {
  repositoryId: "esp",
  skillId: "get-repository-validation-plan",
  tool: "esp_validation_plan",
  provenance,
  audit,
  result: { schemaVersion: 1, mutatesRepository: false, commands: ["npm test"] },
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("governance Skill catalog", () => {
  it("counts both authorized catalogs and preserves results across group and locale changes", async () => {
    let governanceStatus = 200;
    const business = {
      skills: getSkillCatalog(["knowledge.read", "tickets.read", "tickets.create"]),
      generatedAt: provenance.collectedAt,
    };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/skills") return json(business);
      if (options?.method === "POST") return json(result);
      return governanceStatus === 200 ? json(catalog) : json({ error: "UNAVAILABLE" }, governanceStatus);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <LocaleProvider initialLocale="en-US">
        <LanguageSelector />
        <SkillCatalogView
          selectedId={null}
          onSelect={() => undefined}
          onTry={() => undefined}
          onOpenCase={() => undefined}
          executionPending={false}
        />
      </LocaleProvider>,
    );
    const counts = () =>
      [...view.container.querySelectorAll(".catalog-summary > span > strong")].map((element) => element.textContent);
    await waitFor(() => expect(counts()).toEqual(["9", "7", "2"]));
    expect(screen.getAllByText("Implementation bound").length).toBeGreaterThan(0);
    expect(screen.queryByText("Connected")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("tab", { name: "Repository governance (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Skill: Get repository validation plan" }));
    await screen.findByText(governanceText("en-US", "commands"));
    const original = view.container.querySelector(".governance-panel pre")!.textContent;
    fireEvent.click(screen.getByRole("tab", { name: "Business Skills (7)" }));
    fireEvent.click(screen.getByRole("tab", { name: "Repository governance (2)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-CN" } });
    expect(counts()).toEqual(["9", "7", "2"]);
    expect(view.container.querySelector(".governance-panel pre")!.textContent).toBe(original);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    governanceStatus = 403;
    fireEvent.click(screen.getByRole("button", { name: governanceText("zh-CN", "refresh") }));
    await waitFor(() => expect(counts()).toEqual(["7", "7", "0"]));
    expect(screen.queryByRole("button", { name: /^运行技能:/ })).toBeNull();
    governanceStatus = 503;
    fireEvent.click(screen.getByRole("button", { name: governanceText("zh-CN", "refresh") }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(governanceText("zh-CN", "unavailable")));
    expect(counts()).toEqual(["--", "7", "--"]);
  });
  it("runs explicitly once, preserves original data across locales and opens audit", async () => {
    let resolve!: (response: Response) => void;
    const delayed = new Promise<Response>((complete) => {
      resolve = complete;
    });
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST" ? delayed : json(catalog),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenAudit = vi.fn();
    const view = render(
      <LocaleProvider initialLocale="en-US">
        <LanguageSelector />
        <GovernanceSkills onOpenAudit={onOpenAudit} />
      </LocaleProvider>,
    );
    const run = await screen.findByRole("button", { name: "Run Skill: Get repository validation plan" });
    expect(screen.getByRole("complementary", { name: "Source evidence" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Governance result" }).textContent).toContain("No execution result yet");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(run);
    fireEvent.click(run);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({
      repositoryId: "esp",
      skillId: result.skillId,
    });
    await act(async () => {
      resolve(json(result));
      await delayed;
    });
    expect(await screen.findByText(governanceText("en-US", "commands"))).toBeTruthy();
    expect(screen.queryByText(/Tool not probed/)).toBeNull();
    expect(screen.queryByText("No execution result yet")).toBeNull();
    const original = view.container.querySelector("pre")!.textContent;
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zh-CN" } });
    expect(screen.getByText(governanceText("zh-CN", "snapshot"))).toBeTruthy();
    expect(view.container.querySelector("pre")!.textContent).toBe(original);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const auditButton = view.container.querySelector<HTMLButtonElement>(".audit-feedback button");
    expect(auditButton).not.toBeNull();
    fireEvent.click(auditButton!);
    expect(onOpenAudit).toHaveBeenCalledWith(audit.id);
  });
  it("does not expose runnable tools without permission or a configured package", async () => {
    const fetchMock = vi.fn(async () => json({ error: "PRIVATE_PERMISSION_MESSAGE" }, 403));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LocaleProvider initialLocale="en-US">
        <GovernanceSkills />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", governanceText("en-US", "denied"));
    expect(screen.queryByRole("button", { name: /^Run Skill:/ })).toBeNull();
    fetchMock.mockImplementation(async () => json({ ...catalog, packageStatus: "not_configured", provenance: null }));
    fireEvent.click(screen.getByRole("button", { name: governanceText("en-US", "refresh") }));
    await screen.findByText(governanceText("en-US", "not_configured"));
    for (const button of screen.getAllByRole("button", { name: /^Run Skill:/ }))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("shows audit-start failure without a result or an automatic retry", async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? json({ error: "AUDIT_START_FAILED", audit: { ...audit, status: "unavailable" } }, 503)
        : json(catalog),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LocaleProvider initialLocale="en-US">
        <GovernanceSkills />
      </LocaleProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Run Skill: Get repository validation plan" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(governanceText("en-US", "auditFailed")));
    expect(screen.queryByText(governanceText("en-US", "commands"))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
