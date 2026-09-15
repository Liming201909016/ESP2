import { NextResponse } from "next/server";
import { z } from "zod";
import { knowledgeIdentity, knowledgeJson } from "../../../lib/esp/knowledge-api";
import { discoverSecurityReview, reviewCapabilities, reviewCases, reviewControls, reviewPlugins, reviewIdSchema, renderSecurityReport, SecurityReviewError } from "../../../lib/esp/security-review";
import { securityReviewStore, readMemoryReviewAudit, reviewAuditWriter, memoryReviewEnabled } from "../../../lib/esp/security-review-store";
import { securityReviewCommandSchema, executeSecurityReviewCommand } from "../../../lib/esp/security-review-service";
import { auditedResponse } from "../../../lib/esp/audit-http";
import { StateMaintenanceError } from "../../../lib/esp/state-config";
import { renderSecurityReportHtml } from "../../../lib/esp/security-review-report";
import { resolveLocale } from "../../../lib/esp/locale";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  let identity;
  try { identity = knowledgeIdentity(request, true); }
  catch { return NextResponse.json({ error: "REVIEW_ACCESS_DENIED" }, { status: 403, headers }); }
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("auditId")) {
      const detail = readMemoryReviewAudit(params.get("auditId")!, identity.subject!);
      return NextResponse.json(detail ?? { error: "REVIEW_NOT_FOUND" }, { status: detail ? 200 : 404, headers });
    }
    if (params.get("catalog") === "true") return NextResponse.json({ capabilities: reviewCapabilities, plugins: reviewPlugins, cases: reviewCases, controls: reviewControls, backend: process.env.ESP_SECURITY_REVIEW_STORE === "memory" ? "memory" : "blob", sharedReviewer: true }, { headers });
    const store = securityReviewStore(); const id = params.get("id");
    if (id) {
      if (!reviewIdSchema.safeParse(id).success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
      const entry = await store.get(identity.subject!, id);
      if (!entry) return NextResponse.json({ error: "REVIEW_NOT_FOUND" }, { status: 404, headers });
      if (params.get("format") === "html") {
        const locale = resolveLocale(params.get("locale"));
        return new NextResponse(renderSecurityReportHtml(entry.record, locale, memoryReviewEnabled() ? "memory" : "blob"), { headers: {
          ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Language": locale,
          "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          ...(params.get("download") === "true" ? { "Content-Disposition": `attachment; filename="${id}-${locale}.html"` } : {}),
        } });
      }
      if (params.get("download") === "true") return new NextResponse(JSON.stringify(renderSecurityReport(entry.record), null, 2), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${id}.json"` } });
      return NextResponse.json({ ...entry, report: renderSecurityReport(entry.record) }, { headers });
    }
    return NextResponse.json(await store.list(identity.subject!, params.get("cursor") ?? undefined), { headers });
  } catch { return NextResponse.json({ error: "REVIEW_READ_UNAVAILABLE" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  let identity;
  try { identity = knowledgeIdentity(request, true); }
  catch { return NextResponse.json({ error: "REVIEW_ACCESS_DENIED" }, { status: 403, headers }); }
  let command;
  try { command = z.union([securityReviewCommandSchema, z.object({ action: z.literal("discover"), query: z.string().trim().min(3).max(2000) }).strict()]).parse(await knowledgeJson(request)); }
  catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers }); }
  if (memoryReviewEnabled() && request.headers.has("x-esp-parent-audit-id")) return NextResponse.json({ error: "LOCAL_AUDIT_PARENT_UNSUPPORTED" }, { status: 400, headers });
  return auditedResponse(request, { identity, kind: "skill_request", action: `security.review.${command.action}`, mutation: command.action !== "discover", requiredPermissions: ["knowledge.read"], references: [...reviewCapabilities.map((skill) => ({ type: "skill" as const, id: skill.id, version: skill.version })), ...reviewPlugins.map((plugin) => ({ type: "plugin" as const, id: plugin.id, version: "1.0.0" })), { type: "policy", id: "sim-software-security-controls", version: "1.0.0" }] }, async (context) => {
    let target: { id: string; policyVersion: string } | undefined;
    try {
      if (command.action === "discover") {
        const discovery = discoverSecurityReview(command.query);
        return NextResponse.json({ discovery, executionStatus: discovery ? "waiting_confirmation" : "not_routed" }, { headers });
      }
      const store = securityReviewStore();
      if (command.action !== "start") {
        const current = await store.get(identity.subject!, command.id);
        if (!current) throw new SecurityReviewError("REVIEW_NOT_FOUND", 404);
        target = { id: current.record.id, policyVersion: current.record.policyVersion };
      }
      const entry = await executeSecurityReviewCommand(command, identity.subject!, context.requestId, store);
      return NextResponse.json({ reviewRecord: entry.record, etag: entry.etag, report: renderSecurityReport(entry.record), executionStatus: "completed", trace: [{ step: `security.review.${entry.record.status}`, at: new Date().toISOString() }] }, { headers });
    } catch (error) {
      return NextResponse.json({ error: error instanceof SecurityReviewError || error instanceof StateMaintenanceError ? error.code : "REVIEW_WRITE_UNCONFIRMED", executionStatus: "failed", ...(target ? { reviewRecord: target } : {}) }, { status: error instanceof SecurityReviewError ? error.status : 503, headers });
    }
  }, reviewAuditWriter());
}