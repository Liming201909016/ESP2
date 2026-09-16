"use client";

import { useEffect, useRef, useState } from "react";
import { Play, RefreshCw, ShieldCheck } from "lucide-react";
import {
  governanceCatalogSchema,
  governanceResponseSchema,
  type GovernanceCatalog,
  type GovernanceResponse,
} from "../lib/esp/governance-contracts";
import { governanceText, type GovernanceTextKey } from "../lib/esp/governance-locale";
import { AuditFeedback, readAuditReceipt } from "./audit-feedback";
import type { AuditReceipt } from "../lib/esp/audit-contracts";
import { useLocale } from "./locale-provider";

export function GovernanceSkills({
  onOpenAudit,
  executionPending = false,
  onCountChange,
}: {
  onOpenAudit?: (id: string) => void;
  executionPending?: boolean;
  onCountChange?: (count: number | null) => void;
}) {
  const { locale } = useLocale();
  const text = (key: GovernanceTextKey) => governanceText(locale, key);
  const [catalog, setCatalog] = useState<GovernanceCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<GovernanceTextKey | null>(null);
  const [result, setResult] = useState<GovernanceResponse | null>(null);
  const [audit, setAudit] = useState<AuditReceipt | null>(null);
  const inFlight = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  useEffect(() => () => actionController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/governance", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setError(response.status === 401 || response.status === 403 ? "denied" : "unavailable");
            onCountChange?.(response.status === 401 || response.status === 403 ? 0 : null);
          }
          return;
        }
        const value = governanceCatalogSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setCatalog(value);
          onCountChange?.(value.skills.length);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("unavailable");
          onCountChange?.(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision, onCountChange]);
  async function run(skillId: GovernanceResponse["skillId"]) {
    if (inFlight.current || executionPending || loading || catalog?.packageStatus !== "manifest_verified") return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setResult(null);
    setAudit(null);
    const controller = new AbortController();
    actionController.current = controller;
    try {
      const response = await fetch("/api/governance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: "esp", skillId }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      setAudit(readAuditReceipt(body));
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "denied"
            : body.error === "AUDIT_START_FAILED"
              ? "auditFailed"
              : "unavailable",
        );
        return;
      }
      const parsed = governanceResponseSchema.parse(body);
      if (parsed.skillId !== skillId) throw new Error("RESULT_MISMATCH");
      setResult(parsed);
    } catch {
      if (!controller.signal.aborted) setError("uncertain");
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  const provenance = result?.provenance ?? catalog?.provenance;
  const blocked = loading || pending || executionPending;
  return (
    <section className="governance-panel" aria-label={text("title")}>
      <div className="section-title">
        <h2>
          <ShieldCheck size={18} /> {text("title")}
        </h2>
        <button
          className="icon-button"
          type="button"
          title={text("refresh")}
          aria-label={text("refresh")}
          disabled={blocked}
          onClick={() => {
            setLoading(true);
            setCatalog(null);
            onCountChange?.(null);
            setError(null);
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {text(error)}
        </p>
      )}
      {(loading || pending) && <p role="status">{text(pending ? "running" : "loading")}</p>}
      {catalog && (
        <>
          <p className="catalog-updated">
            {text(catalog.packageStatus === "unavailable" ? "packageUnavailable" : catalog.packageStatus)}
          </p>
          <table className="catalog-table">
            <caption className="sr-only">{text("title")}</caption>
            <thead>
              <tr>
                <th>{text("skill")}</th>
                <th>{text("permission")}</th>
                <th>{text("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.skills.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <strong>{text(skill.id === "inspect-repository-governance" ? "inspect" : "plan")}</strong>
                    <code>
                      {skill.id} · {skill.version}
                    </code>
                  </td>
                  <td>
                    <code>{skill.permission}</code>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={blocked || catalog.packageStatus !== "manifest_verified"}
                      onClick={() => void run(skill.id)}
                      aria-label={`${text("run")}: ${text(skill.id === "inspect-repository-governance" ? "inspect" : "plan")}`}
                      title={`${text("run")}: ${text(skill.id === "inspect-repository-governance" ? "inspect" : "plan")}`}
                    >
                      <Play size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {provenance && (
        <>
          <p>{text("snapshot")}</p>
          <dl className="catalog-metadata">
            <div>
              <dt>{text("commit")}</dt>
              <dd>
                <code>{provenance.sourceCommit}</code>
              </dd>
            </div>
            <div>
              <dt>{text("collected")}</dt>
              <dd>
                <time dateTime={provenance.collectedAt}>{new Date(provenance.collectedAt).toLocaleString(locale)}</time>
              </dd>
            </div>
            <div>
              <dt>{text("digest")}</dt>
              <dd>
                <code>{provenance.inputDigest}</code>
              </dd>
            </div>
          </dl>
          <p className="catalog-updated">{text(provenance.dirtyWorktree ? "dirty" : "clean")}</p>
        </>
      )}
      <AuditFeedback receipt={audit} onOpen={onOpenAudit} />
      {result && (
        <div aria-label={text("result")}>
          {result.skillId === "get-repository-validation-plan" ? (
            <>
              <h3>{text("commands")}</h3>
              <ol>
                {result.result.commands.map((command, index) => (
                  <li key={`${index}-${command}`}>
                    <code>{command}</code>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <dl className="catalog-metadata">
              <div>
                <dt>{text("recovery")}</dt>
                <dd>{result.result.recovery.mode}</dd>
              </div>
              <div>
                <dt>{text("review")}</dt>
                <dd>{result.result.codeReview.mode}</dd>
              </div>
              <div>
                <dt>{text("contracts")}</dt>
                <dd>{result.result.documentationDrift.contractCount}</dd>
              </div>
            </dl>
          )}
          <details className="catalog-schema">
            <summary>{text("json")}</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
