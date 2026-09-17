// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecurityReview, decideSecurityReview } from "../lib/esp/security-review";
import { translate } from "../lib/esp/locale";
import { LocaleProvider } from "./locale-provider";
import { SecurityReviewPanel } from "./security-review-panel";

const records = ["a", "b", "c"].map((suffix) => ({
  record: createSecurityReview({ id: `sr-${suffix.repeat(32)}`, submissionId: "11111111-1111-4111-8111-111111111111", caseId: "complete", query: "Security review of Docker Desktop" }, "owner", "22222222-2222-4222-8222-222222222222", new Date("2026-09-15T00:00:00.000Z")),
  etag: `etag-${suffix}`,
}));
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => { resolve = complete; });
  return { promise, resolve };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function panel(initialId?: string) { return <LocaleProvider initialLocale="en-US"><SecurityReviewPanel initialId={initialId} onOpenAudit={() => undefined} /></LocaleProvider>; }
function historyIds() { return screen.queryAllByRole("button", { name: /sr-[abc]{32}/ }).map((button) => button.textContent?.match(/sr-[abc]{32}/)?.[0]); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("security review request isolation", () => {
  it("focuses linked follow-up materials without submitting a new review", async () => {
    const prior = { ...records[0], record: decideSecurityReview(records[0].record, "request_information", "Please provide scope evidence.", "owner", "22222222-2222-4222-8222-222222222222") };
    const fetchMock = vi.fn(async (path: string) => path.includes("catalog=true") ? json({ backend: "blob" }) : path.includes("?id=") ? json(prior) : json({ records: [prior], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(panel(prior.record.id));
    const prepare = await screen.findByRole("button", { name: translate("en-US", "reviewResubmit") });
    const form = view.container.querySelector("form")!;
    const scroll = vi.fn();
    form.scrollIntoView = scroll;
    const count = fetchMock.mock.calls.length;
    fireEvent.click(prepare);
    const materials = screen.getByRole("combobox", { name: translate("en-US", "reviewCase") });
    expect(document.activeElement).toBe(materials);
    expect((materials as HTMLSelectElement).value).toBe("complete");
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(form.textContent).toContain(prior.record.id);
    expect(screen.getByRole("button", { name: translate("en-US", "reviewCreate") })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
  it("ignores a late initial detail and binds decision input to the selected record", async () => {
    const late = deferredResponse();
    const commands: Record<string, unknown>[] = [];
    let initialReads = 0;
    const fetchMock = vi.fn(async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") { commands.push(JSON.parse(options.body as string)); return json({ error: "REVIEW_CONFLICT" }, 409); }
      if (path.includes("catalog=true")) return json({ backend: "blob" });
      if (path.includes(`id=${records[0].record.id}`)) { initialReads += 1; return initialReads === 1 ? late.promise : json(records[0]); }
      if (path.includes(`id=${records[1].record.id}`)) return json(records[1]);
      return json({ records: records.slice(0, 2), nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(panel(records[0].record.id));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`id=${records[0].record.id}`), expect.any(Object)));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(records[1].record.id) }));
    const reason = await screen.findByRole("textbox", { name: translate("en-US", "reviewReason") });
    fireEvent.change(reason, { target: { value: "Reason for the selected B review" } });
    await act(async () => { late.resolve(json(records[0])); await late.promise; });
    expect(view.container.querySelector(".security-review-detail .section-title p")?.textContent).toBe(records[1].record.id);
    expect((reason as HTMLTextAreaElement).value).toBe("Reason for the selected B review");
    fireEvent.click(screen.getByRole("button", { name: translate("en-US", "reviewApprove") }));
    await waitFor(() => expect(commands).toEqual([{ action: "approve", id: records[1].record.id, etag: records[1].etag, reason: "Reason for the selected B review" }]));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(records[0].record.id) }));
    await waitFor(() => expect(view.container.querySelector(".security-review-detail .section-title p")?.textContent).toBe(records[0].record.id));
    expect((screen.getByRole("textbox", { name: translate("en-US", "reviewReason") }) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("button", { name: translate("en-US", "reviewApprove") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("serializes pagination, deduplicates IDs and allows a clean refresh", async () => {
    const nextPage = deferredResponse();
    let firstPageReads = 0;
    let pageReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path.includes("catalog=true")) return json({ backend: "blob" });
      if (path.includes("cursor=")) { pageReads += 1; return nextPage.promise; }
      firstPageReads += 1;
      return json({ records: firstPageReads === 1 ? [records[0]] : [records[2]], nextCursor: firstPageReads === 1 ? "page-1" : null });
    }));
    render(panel());
    const more = await screen.findByRole("button", { name: translate("en-US", "reviewMore") });
    await waitFor(() => expect((more as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(more); fireEvent.click(more);
    const refresh = screen.getByRole("button", { name: translate("en-US", "reviewRefresh") });
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect(pageReads).toBe(1);
    await act(async () => { nextPage.resolve(json({ records: records.slice(0, 2), nextCursor: null })); await nextPage.promise; });
    expect(historyIds()).toEqual(records.slice(0, 2).map((entry) => entry.record.id));
    fireEvent.click(refresh);
    await waitFor(() => expect(historyIds()).toEqual([records[2].record.id]));
    expect(firstPageReads).toBe(2);
  });

  it("discards old pagination after a new initial target reloads the list", async () => {
    const nextPage = deferredResponse();
    let firstPageReads = 0;
    let oldSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
      if (path.includes("catalog=true")) return json({ backend: "blob" });
      if (path.includes("cursor=")) { oldSignal = options?.signal; return nextPage.promise; }
      if (path.includes("?id=")) return json(records[2]);
      firstPageReads += 1;
      return json({ records: [records[firstPageReads === 1 ? 0 : 2]], nextCursor: firstPageReads === 1 ? "page-1" : null });
    }));
    const view = render(panel());
    const more = await screen.findByRole("button", { name: translate("en-US", "reviewMore") });
    await waitFor(() => expect((more as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(more);
    view.rerender(panel(records[2].record.id));
    await waitFor(() => expect(view.container.querySelector(".security-review-detail .section-title p")?.textContent).toBe(records[2].record.id));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { nextPage.resolve(json({ records: [records[1]], nextCursor: "obsolete-page" })); await nextPage.promise; });
    expect(historyIds()).toEqual([records[2].record.id]);
    expect(screen.queryByRole("button", { name: translate("en-US", "reviewMore") })).toBeNull();
  });
});